/**
 * analyzeEdocFieldPlacement — AI Field Assistant backend.
 *
 * Takes rendered E-Doc page images from an authenticated company user and
 * returns *suggested* signer-field placements. It is deliberately a separate
 * callable from the public CDL parser (`parseCdlWithGroq`):
 *
 *  - the CDL callable is reachable by unauthenticated guests mid-application;
 *    this one requires a signed-in user with company access and E-Docs enabled;
 *  - the CDL callable has its own model pin (GROQ_VISION_MODEL) that must not
 *    move when document analysis changes (GROQ_DOCUMENT_VISION_MODEL);
 *  - the two have different payload ceilings and rate budgets.
 *
 * Security/privacy invariants enforced here:
 *  - authenticated caller, strict company access, E-Docs feature access;
 *  - per-company AND per-user rate limits;
 *  - page-count, per-image and total-payload ceilings;
 *  - the API key never leaves the server; the client sends images, not paths,
 *    so there is no arbitrary Storage-path read;
 *  - NO Firestore write of any kind (rate-limit counters aside);
 *  - no signing token is accepted or returned;
 *  - no document text, image bytes or provider response text is ever logged;
 *  - every suggestion is validated and clamped before it is returned.
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { db } = require('./firebaseAdmin');
const { checkRateLimit } = require('./shared/rateLimiter');
const { assertCompanyAccessForRequest } = require('./shared/companyAccess');
const {
  SEMANTIC_FIELD_MAP,
  MANUAL_REVIEW_KINDS,
} = require('./shared/edocFieldSemantics');
const {
  getDocumentVisionProvider,
  DocumentVisionError,
} = require('./shared/documentVisionProvider');

/** Ceilings. Kept modest: page images are large and the model is the slow part. */
const MAX_PAGES_PER_REQUEST = 5;
const MAX_IMAGE_CHARS = 2 * 1024 * 1024; // ~1.5MB of decoded image per page
const MAX_TOTAL_PAYLOAD_CHARS = 7 * 1024 * 1024;
const MAX_PAGE_NUMBER = 2000;
const MAX_SUGGESTIONS = 200;
const MAX_MANUAL_REVIEW = 50;
const MAX_LABEL_LENGTH = 60;

/** Smallest field that is actually usable once placed, in page percent. */
const MIN_FIELD_WIDTH_PCT = 1.5;
const MIN_FIELD_HEIGHT_PCT = 1;

const IMAGE_DATA_URL_PREFIX = /^data:image\/(png|jpeg|jpg|webp);base64,/;

const MANUAL_REVIEW_KIND_SET = new Set(MANUAL_REVIEW_KINDS);

function normalizeString(value) {
  if (value === null || value === undefined) return '';
  return String(value);
}

function clampPercent(value) {
  if (!Number.isFinite(value)) return null;
  if (value < 0) return 0;
  if (value > 100) return 100;
  return value;
}

/**
 * Validate + normalize one raw provider suggestion.
 * Returns null when the suggestion cannot be trusted; callers count drops.
 */
function normalizeSuggestion(raw, allowedPages) {
  if (!raw || typeof raw !== 'object') return null;

  const mapping = SEMANTIC_FIELD_MAP[normalizeString(raw.category).trim()];
  if (!mapping) return null;

  const page = Number(raw.page);
  if (!Number.isInteger(page) || page < 1 || page > MAX_PAGE_NUMBER) return null;
  if (allowedPages && !allowedPages.has(page)) return null;

  const x = clampPercent(Number(raw.x));
  const y = clampPercent(Number(raw.y));
  let width = clampPercent(Number(raw.width));
  let height = clampPercent(Number(raw.height));
  if (x === null || y === null || width === null || height === null) return null;

  // Zero/degenerate boxes are unusable; reject rather than silently inflate.
  if (width < MIN_FIELD_WIDTH_PCT || height < MIN_FIELD_HEIGHT_PCT) return null;

  // Keep the box inside the page instead of letting it hang off the edge.
  if (x + width > 100) width = 100 - x;
  if (y + height > 100) height = 100 - y;
  if (width < MIN_FIELD_WIDTH_PCT || height < MIN_FIELD_HEIGHT_PCT) return null;

  const rawConfidence = Number(raw.confidence);
  const confidence = Number.isFinite(rawConfidence)
    ? Math.min(1, Math.max(0, rawConfidence))
    : 0;

  const label = normalizeString(raw.label).trim().slice(0, MAX_LABEL_LENGTH) || mapping.label;

  return {
    category: normalizeString(raw.category).trim(),
    type: mapping.type,
    bindingKey: mapping.bindingKey,
    label,
    required: typeof raw.required === 'boolean' ? raw.required : mapping.required,
    confidence,
    page,
    x,
    y,
    width,
    height,
  };
}

/** Drop near-identical boxes of the same category on the same page. */
function dedupeSuggestions(suggestions) {
  const kept = [];
  for (const candidate of suggestions) {
    const duplicate = kept.find(
      (existing) =>
        existing.page === candidate.page &&
        existing.category === candidate.category &&
        Math.abs(existing.x - candidate.x) < 1.5 &&
        Math.abs(existing.y - candidate.y) < 1.5
    );
    if (duplicate) {
      // Keep whichever the model was more sure about.
      if (candidate.confidence > duplicate.confidence) {
        kept[kept.indexOf(duplicate)] = candidate;
      }
      continue;
    }
    kept.push(candidate);
  }
  return kept;
}

function normalizeManualReview(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const kind = normalizeString(raw.kind).trim();
  if (!MANUAL_REVIEW_KIND_SET.has(kind)) return null;
  const page = Number(raw.page);
  return {
    kind,
    page: Number.isInteger(page) && page >= 1 && page <= MAX_PAGE_NUMBER ? page : null,
    detail: normalizeString(raw.detail).trim().slice(0, 160),
  };
}

/** Validate the caller-supplied page payload. Throws HttpsError on any breach. */
function validatePagesInput(pages) {
  if (!Array.isArray(pages) || pages.length === 0) {
    throw new HttpsError('invalid-argument', 'At least one page image is required.');
  }
  if (pages.length > MAX_PAGES_PER_REQUEST) {
    throw new HttpsError(
      'invalid-argument',
      `A scan may include at most ${MAX_PAGES_PER_REQUEST} pages per request.`
    );
  }

  let totalChars = 0;
  const normalized = [];
  const seenPages = new Set();

  for (const page of pages) {
    const pageNumber = Number(page?.pageNumber);
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > MAX_PAGE_NUMBER) {
      throw new HttpsError('invalid-argument', 'Each page needs a valid pageNumber.');
    }
    if (seenPages.has(pageNumber)) {
      throw new HttpsError('invalid-argument', 'Duplicate pageNumber in request.');
    }
    seenPages.add(pageNumber);

    const imageDataUrl = normalizeString(page?.imageDataUrl);
    if (!IMAGE_DATA_URL_PREFIX.test(imageDataUrl)) {
      throw new HttpsError(
        'invalid-argument',
        'Each page must be a data:image/(png|jpeg|webp);base64 URL.'
      );
    }
    if (imageDataUrl.length > MAX_IMAGE_CHARS) {
      throw new HttpsError('invalid-argument', 'A rendered page image is too large.');
    }

    totalChars += imageDataUrl.length;
    if (totalChars > MAX_TOTAL_PAYLOAD_CHARS) {
      throw new HttpsError('invalid-argument', 'The scan payload is too large. Scan fewer pages.');
    }

    normalized.push({ pageNumber, imageDataUrl });
  }

  return normalized;
}

/**
 * E-Docs must be enabled for the tenant. `features.eDocs === false` is the
 * repo-wide opt-out convention (see DocumentsManager); absence means enabled.
 */
async function assertEdocsFeatureEnabled(companyId) {
  const snap = await db.collection('companies').doc(companyId).get();
  if (!snap.exists) {
    throw new HttpsError('not-found', 'Company not found.');
  }
  const data = snap.data() || {};
  if (data.features?.eDocs === false) {
    throw new HttpsError('permission-denied', 'E-Docs is not enabled for this company.');
  }
}

exports.analyzeEdocFieldPlacement = onCall(
  { cors: true, memory: '1GiB', timeoutSeconds: 120 },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'You must be signed in.');
    }

    const { companyId, scanId, pages } = request.data || {};

    if (!companyId || typeof companyId !== 'string') {
      throw new HttpsError('invalid-argument', 'companyId is required.');
    }
    // Opaque client correlation id, echoed back so the client can discard the
    // answer to a scan it already cancelled. Never a signing token.
    const safeScanId = normalizeString(scanId).trim().slice(0, 64);
    if (!safeScanId) {
      throw new HttpsError('invalid-argument', 'scanId is required.');
    }

    await assertCompanyAccessForRequest(request, companyId, 'analyzeEdocFieldPlacement');
    await assertEdocsFeatureEnabled(companyId);

    const normalizedPages = validatePagesInput(pages);

    // Two independent budgets: one user cannot exhaust the tenant's, and the
    // tenant ceiling still caps a coordinated burst. Fail closed — this path
    // spends money at a third-party provider.
    const userAllowed = await checkRateLimit(
      `edoc_field_ai_user_${request.auth.uid}`,
      12,
      60,
      'closed'
    );
    if (!userAllowed) {
      throw new HttpsError(
        'resource-exhausted',
        'Too many scans. Please wait a minute and try again.'
      );
    }
    const companyAllowed = await checkRateLimit(
      `edoc_field_ai_company_${companyId}`,
      60,
      300,
      'closed'
    );
    if (!companyAllowed) {
      throw new HttpsError(
        'resource-exhausted',
        'Your company has reached its scan limit. Please try again shortly.'
      );
    }

    const provider = getDocumentVisionProvider();

    let result;
    try {
      result = await provider.analyzeDocumentPages({ pages: normalizedPages });
    } catch (err) {
      if (err instanceof DocumentVisionError) {
        if (err.kind === 'not-configured') {
          throw new HttpsError('failed-precondition', err.message);
        }
        if (err.kind === 'unavailable') {
          throw new HttpsError('unavailable', 'Could not reach the AI service. Please retry.');
        }
        throw new HttpsError('internal', 'The AI service could not analyze this document.');
      }
      // Message only — never the payload.
      console.error('[analyzeEdocFieldPlacement] unexpected provider failure:', err?.message || 'unknown');
      throw new HttpsError('internal', 'The AI service could not analyze this document.');
    }

    const allowedPages = new Set(normalizedPages.map((p) => p.pageNumber));

    const rawSuggestions = Array.isArray(result.suggestions)
      ? result.suggestions.slice(0, MAX_SUGGESTIONS)
      : [];
    const normalizedSuggestions = [];
    let rejectedCount = 0;
    for (const raw of rawSuggestions) {
      const normalized = normalizeSuggestion(raw, allowedPages);
      if (normalized) normalizedSuggestions.push(normalized);
      else rejectedCount += 1;
    }
    const suggestions = dedupeSuggestions(normalizedSuggestions);

    const manualReview = (Array.isArray(result.manualReview) ? result.manualReview : [])
      .slice(0, MAX_MANUAL_REVIEW)
      .map(normalizeManualReview)
      .filter(Boolean);

    // Counts and ids only: no labels, no coordinates-with-content, no page text.
    console.log(
      `[analyzeEdocFieldPlacement] companyId=${companyId} pages=${normalizedPages.length} ` +
        `kept=${suggestions.length} rejected=${rejectedCount} manualReview=${manualReview.length}`
    );

    return {
      success: true,
      scanId: safeScanId,
      model: result.model || provider.model,
      provider: provider.name,
      pagesAnalyzed: normalizedPages.map((p) => p.pageNumber),
      suggestions,
      manualReview,
    };
  }
);

exports.__private = {
  MAX_PAGES_PER_REQUEST,
  MAX_IMAGE_CHARS,
  MAX_TOTAL_PAYLOAD_CHARS,
  MIN_FIELD_WIDTH_PCT,
  MIN_FIELD_HEIGHT_PCT,
  normalizeSuggestion,
  dedupeSuggestions,
  normalizeManualReview,
  validatePagesInput,
};
