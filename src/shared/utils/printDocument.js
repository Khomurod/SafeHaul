/**
 * Print helpers for **application-generated** documents.
 *
 * ── WHY THIS EXISTS, AND WHY IT IS NOT `sanitizeUserContent` ────────────────
 *
 * `sanitizeUserContent` is the strict policy for *user-authored* rich text
 * (`NotesTab`, global question labels). Its DOMPurify allowlist permits only
 * `b/strong/i/em/u/br/p/ul/ol/li/span/a/code/pre` and the attributes
 * `href/target/rel`. Applied to a rendered legal document it does exactly what
 * it is designed to do and destroys it: every `<div>` collapses to a bare text
 * node, every `class` attribute disappears, and `<img>` is on its forbidden
 * list — so the applicant's signature, the legally operative part of a
 * 49 CFR §391.23 release, is deleted. That utility is correct and must not be
 * loosened; it is simply the wrong tool for trusted structure.
 *
 * A rendered React document is a different kind of input. Every dynamic value
 * in it — applicant names, employer names, phone numbers, IP addresses — is a
 * React **text node**, so React has already escaped it during render: a name of
 * `<img src=x onerror=alert(1)>` is serialised as `&lt;img src=x
 * onerror=alert(1)&gt;` and is text, not markup. The structure around those
 * values is authored by us, in JSX, and is not attacker-reachable.
 *
 * "React escapes it" is a good argument but not a proof, and it is not
 * something a future edit is obliged to preserve. So instead of trusting the
 * markup wholesale, `scrubTrustedPrintTree` walks the cloned tree and enforces
 * an explicit, testable policy:
 *
 *   - executable and document-hijacking elements are deleted outright,
 *   - every `on*` handler attribute is deleted,
 *   - every URL-bearing attribute is checked against a scheme allowlist, so an
 *     applicant-supplied `signature` of `javascript:…` or
 *     `data:text/html;…` cannot become a live `src`,
 *   - `style` values carrying `javascript:` or `expression(` are dropped.
 *
 * Structure, `class` attributes, `<img>`, `<svg>` and the document's own
 * headings all survive, so the printed page is the document.
 *
 * The clone is scrubbed as a **DOM tree**, never as an HTML string. Nothing is
 * re-parsed, so there is no serialise/re-parse round trip to smuggle anything
 * through, and the behaviour is identical in happy-dom and in a real browser —
 * unlike `createDOMPurify(window)`, which is inert under happy-dom and
 * therefore cannot be unit-tested at all.
 */

/**
 * Elements that can execute code, load a nested browsing context, redirect the
 * document, or accept input. None of these appear in a generated SafeHaul
 * document; if one is ever present it is an injection, not a regression.
 */
const FORBIDDEN_ELEMENTS = new Set([
  'SCRIPT', 'NOSCRIPT', 'TEMPLATE', 'STYLE', 'LINK', 'META', 'BASE', 'TITLE',
  'IFRAME', 'FRAME', 'FRAMESET', 'OBJECT', 'EMBED', 'APPLET', 'PORTAL',
  'FORM', 'INPUT', 'BUTTON', 'TEXTAREA', 'SELECT',
  'AUDIO', 'VIDEO', 'SOURCE', 'TRACK', 'CANVAS', 'SLOT',
]);

/** Attributes whose value is resolved as a URL. */
const URL_ATTRIBUTES = new Set([
  'src', 'href', 'xlink:href', 'action', 'formaction', 'poster', 'background',
  'data', 'srcset', 'ping', 'longdesc', 'cite', 'usemap', 'profile', 'manifest',
]);

/** Attributes that are dangerous regardless of their value. */
const FORBIDDEN_ATTRIBUTES = new Set(['srcdoc', 'contenteditable', 'autofocus']);

/** Raster image data URLs only — never `data:text/html`, never `data:image/svg+xml`. */
const SAFE_IMAGE_DATA_URL = /^data:image\/(png|jpe?g|gif|webp|avif|bmp);base64,[a-z0-9+/=\s]*$/i;

/** Schemes acceptable on a link. */
const SAFE_LINK_SCHEME = /^(https?:|mailto:|tel:)/i;

/** A value with no scheme at all — a relative path, a fragment or a query. */
const SCHEMELESS = /^(?![a-z][a-z0-9+.-]*:)/i;

function isSafeUrlValue(attributeName, value) {
  const trimmed = String(value).trim();
  if (trimmed === '') return true;

  // Control characters and embedded whitespace are the classic way to hide a
  // scheme from a naive check, so drop everything at or below U+0020 first.
  const normalised = Array.from(trimmed).filter((ch) => ch.charCodeAt(0) > 0x20).join('');

  if (attributeName === 'src' || attributeName === 'poster' || attributeName === 'background') {
    if (SAFE_IMAGE_DATA_URL.test(trimmed)) return true;
    return /^https?:/i.test(normalised) || SCHEMELESS.test(normalised);
  }

  if (normalised.startsWith('#')) return true;
  return SAFE_LINK_SCHEME.test(normalised) || SCHEMELESS.test(normalised);
}

function isSafeStyleValue(value) {
  const normalised = String(value).toLowerCase().replace(/\s+/g, '');
  return !normalised.includes('javascript:') && !normalised.includes('expression(');
}

/**
 * Enforce the trusted-document policy on a **cloned** element tree, in place.
 *
 * Pass a clone. This mutates what it is given and must never be pointed at a
 * node that is still in the live document.
 *
 * @param {Element} root
 * @returns {{ removedElements: string[], removedAttributes: string[] }}
 *   What the policy took out. Empty arrays are the expected result for a
 *   SafeHaul-generated document; anything else is worth failing a test over.
 */
export function scrubTrustedPrintTree(root) {
  const removedElements = [];
  const removedAttributes = [];

  if (!root || typeof root.querySelectorAll !== 'function') {
    return { removedElements, removedAttributes };
  }

  const visit = (element) => {
    const tagName = (element.tagName || '').toUpperCase();

    if (FORBIDDEN_ELEMENTS.has(tagName)) {
      removedElements.push(tagName.toLowerCase());
      element.remove();
      return;
    }

    // Snapshot: removing attributes mutates the live `attributes` collection.
    const attributes = Array.from(element.attributes || []);
    for (const { name, value } of attributes) {
      const lower = name.toLowerCase();

      if (lower.startsWith('on') || FORBIDDEN_ATTRIBUTES.has(lower)) {
        removedAttributes.push(`${tagName.toLowerCase()}@${lower}`);
        element.removeAttribute(name);
        continue;
      }

      if (URL_ATTRIBUTES.has(lower) && !isSafeUrlValue(lower, value)) {
        removedAttributes.push(`${tagName.toLowerCase()}@${lower}`);
        element.removeAttribute(name);
        continue;
      }

      if (lower === 'style' && !isSafeStyleValue(value)) {
        removedAttributes.push(`${tagName.toLowerCase()}@style`);
        element.removeAttribute(name);
      }
    }

    // Children are re-read after the visit because a removal reshapes the list.
    Array.from(element.children || []).forEach(visit);
  };

  visit(root);
  return { removedElements, removedAttributes };
}

/**
 * Collect the application's own CSS so a print window can be styled without a
 * network round trip.
 *
 * The previous implementation loaded `https://cdn.tailwindcss.com` into the
 * print window and hoped it had compiled before a one-second timer fired. That
 * is a network dependency and a race, and the CDN build is not the build the
 * app ships. The app's real stylesheet is same-origin and already parsed, so it
 * can be read out of `document.styleSheets` and inlined verbatim.
 *
 * A stylesheet whose rules are unreadable (cross-origin, no CORS) cannot be
 * inlined; its URL is returned instead so the caller can `<link>` it and wait
 * for it to load.
 *
 * @param {Document} [sourceDocument]
 * @returns {{ cssText: string, hrefs: string[], readableSheets: number, unreadableSheets: number }}
 */
export function collectPrintStyles(sourceDocument = document) {
  const chunks = [];
  const hrefs = [];
  let unreadableSheets = 0;

  const sheets = Array.from(sourceDocument?.styleSheets || []);
  for (const sheet of sheets) {
    let rules = null;
    try {
      rules = sheet.cssRules;
    } catch {
      rules = null; // Cross-origin: readable only as a URL.
    }

    if (rules) {
      const text = Array.from(rules).map((rule) => rule.cssText).join('\n');
      if (text.trim()) chunks.push(text);
      continue;
    }

    unreadableSheets += 1;
    if (sheet.href) hrefs.push(sheet.href);
  }

  return {
    cssText: chunks.join('\n'),
    hrefs,
    readableSheets: chunks.length,
    unreadableSheets,
  };
}

/**
 * Print-only rules layered after the application CSS.
 *
 * `print-color-adjust: exact` is the load-bearing one: without it Chrome and
 * Safari drop background fills and lighten borders when printing, which on this
 * document means the signature box, the section rules and the questionnaire
 * checkboxes come out faint or missing.
 */
export const PRINT_DOCUMENT_STYLES = `
@page { margin: 0.5in; }
html, body {
  margin: 0;
  padding: 0;
  background: #ffffff;
}
body {
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
@media print {
  html, body { width: auto; }
}
`;

/**
 * Resolve once the print document has everything it needs to be rasterised:
 * linked stylesheets settled, images decoded, fonts ready.
 *
 * This replaces a flat `setTimeout(…, 1000)`. The timeout that remains is a
 * backstop against a resource that never settles, not the mechanism — on the
 * happy path this resolves as soon as the document is genuinely ready, and
 * `timedOut` tells the caller which of the two happened.
 *
 * @param {Window} printWindow
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<{ timedOut: boolean }>}
 */
export function waitForPrintDocumentReady(printWindow, { timeoutMs = 8000 } = {}) {
  const doc = printWindow?.document;
  if (!doc) return Promise.resolve({ timedOut: false });

  const settled = [];

  const links = Array.from(doc.querySelectorAll?.('link[rel="stylesheet"]') || []);
  for (const link of links) {
    if (link.sheet) continue;
    settled.push(new Promise((resolve) => {
      link.addEventListener('load', resolve, { once: true });
      link.addEventListener('error', resolve, { once: true });
    }));
  }

  const images = Array.from(doc.images || []);
  for (const image of images) {
    if (image.complete) continue;
    settled.push(new Promise((resolve) => {
      image.addEventListener('load', resolve, { once: true });
      image.addEventListener('error', resolve, { once: true });
    }));
  }

  if (doc.fonts?.ready) {
    settled.push(Promise.resolve(doc.fonts.ready).catch(() => {}));
  }

  if (settled.length === 0) return Promise.resolve({ timedOut: false });

  let timer;
  const backstop = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ timedOut: true }), timeoutMs);
  });

  return Promise.race([
    Promise.all(settled).then(() => ({ timedOut: false })),
    backstop,
  ]).finally(() => clearTimeout(timer));
}
