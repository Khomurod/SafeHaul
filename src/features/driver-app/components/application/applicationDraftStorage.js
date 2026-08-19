/**
 * Local draft persistence for the public application wizard.
 *
 * One responsibility: reading/writing the per-slug application draft in
 * localStorage. SEC-2: `ssn` and `signature` are NEVER persisted — they are
 * PII/biometric data accessible to any JavaScript on the page (XSS vector)
 * and would otherwise survive across sessions.
 *
 * ## Why the draft carries sync metadata
 *
 * There are two copies of an unfinished application: this one, written
 * synchronously on every forward step, and the server-side draft written in the
 * background. The local copy exists precisely to survive a failed or slow server
 * save — so when both exist, something has to know which one holds newer work.
 *
 * It used to store the answers and `lastStep` and nothing else, so nothing could
 * answer that question, and the server copy won unconditionally on restore. The
 * local backup was therefore destroyed by the exact failure it exists for: save
 * fails, driver refreshes, the older server values come back over their edits.
 *
 * `localSeq` counts local writes. `syncedSeq` is the highest `localSeq` the
 * server has confirmed storing. `localSeq > syncedSeq` means "this device holds
 * work the server has not acknowledged", which is the whole question, decided by
 * an integer comparison.
 *
 * **Deliberately not a timestamp.** A device clock and a Firestore
 * `serverTimestamp` are different clocks, and phone clocks are routinely wrong —
 * comparing them would make some drivers' local work permanently look stale and
 * others' permanently look newer. `savedAt` is recorded for diagnostics and is
 * never an input to a decision.
 */

const draftKey = (slug) => `draft_${slug}`;

/** Marks an enveloped draft, so the legacy flat shape is unambiguous. */
const ENVELOPE_VERSION = 1;

/** Fields never written to a local draft. See SEC-2 above. */
const NEVER_STORED = ['ssn', 'signature'];

function stripSensitive(formData) {
  const { ssn: _ssn, signature: _signature, ...rest } = formData || {};
  return rest;
}

/**
 * Read a saved draft.
 *
 * Stripping happens on write, which is where the guarantee belongs — see
 * `saveApplicationDraft`. This does not strip again: the App Brief documents
 * exactly three points where `ssn` and `signature` are removed (local write,
 * client payload, server arrival), and a fourth undocumented one here would only
 * defend against a key an attacker who can already read memory had planted.
 *
 * @returns {{ data: object, lastStep: number|null, meta: object|null }|null}
 *   `null` when absent or corrupt. `meta` is `null` for a **legacy** draft —
 *   one written before sync metadata existed. Those already sit in real drivers'
 *   browsers, so they must keep working: the caller cannot tell whether such a
 *   copy holds unsynced work, and `reconcileApplicationDraft` falls back to
 *   comparing progress instead of guessing.
 */
export function readApplicationDraft(slug) {
  if (!slug) return null;
  let parsed;
  try {
    const raw = localStorage.getItem(draftKey(slug));
    if (!raw) return null;
    parsed = JSON.parse(raw);
  } catch (draftErr) {
    console.warn('[applicationDraftStorage] Failed to load draft:', draftErr);
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;

  if (parsed.v === ENVELOPE_VERSION && parsed.data && typeof parsed.data === 'object') {
    return {
      data: parsed.data,
      lastStep: typeof parsed.lastStep === 'number' ? parsed.lastStep : null,
      meta: {
        localSeq: Number.isInteger(parsed.meta?.localSeq) ? parsed.meta.localSeq : 0,
        syncedSeq: Number.isInteger(parsed.meta?.syncedSeq) ? parsed.meta.syncedSeq : 0,
        savedAt: typeof parsed.meta?.savedAt === 'string' ? parsed.meta.savedAt : null,
      },
    };
  }

  // Legacy flat shape: the answers and `lastStep` in one object.
  const { lastStep, ...data } = parsed;
  return {
    data,
    lastStep: typeof lastStep === 'number' ? lastStep : null,
    meta: null,
  };
}

/**
 * Persist the draft (minus ssn/signature).
 *
 * @param {string} slug
 * @param {object} formData
 * @param {{ lastStep?: number, syncedSeq?: number, localSeq?: number, synced?: boolean }} [options]
 *   `localSeq`/`syncedSeq` write a copy at a *known* sync position rather than
 *   advancing it. `synced: true` marks whatever sequence this write lands on as
 *   already confirmed — used when applying a restored server draft, which *is*
 *   the server's copy, and which must be clean even when the server draft carries
 *   no sequence of its own (one written before `clientSeq` existed). Marking it
 *   dirty instead would make a later genuine server advance lose to it.
 * @returns {{ ok: boolean, localSeq: number|null }} `ok: false` on a
 *   QuotaExceededError (DL-1) so callers can inform the user instead of
 *   silently swallowing it. `localSeq` is what the caller must hand to the
 *   server save so a successful save can mark exactly this write synced.
 */
export function saveApplicationDraft(slug, formData, options = {}) {
  if (!slug) return { ok: false, localSeq: null };

  const previous = readApplicationDraft(slug);
  const localSeq = Number.isInteger(options.localSeq)
    ? options.localSeq
    : (previous?.meta?.localSeq || 0) + 1;
  let syncedSeq;
  if (options.synced) syncedSeq = localSeq;
  else if (Number.isInteger(options.syncedSeq)) syncedSeq = options.syncedSeq;
  // A new local write is unsynced by definition, so the previous synced position
  // carries over unchanged rather than being advanced with it.
  else syncedSeq = previous?.meta?.syncedSeq || 0;

  const envelope = {
    v: ENVELOPE_VERSION,
    // Out of `data` on purpose. It used to live among the answers, which meant a
    // wizard field called `lastStep` would collide with it and the restore
    // merged it into `formData` as though it were one.
    lastStep: typeof options.lastStep === 'number' ? options.lastStep : previous?.lastStep ?? null,
    meta: { localSeq, syncedSeq, savedAt: new Date().toISOString() },
    data: stripSensitive(formData),
  };

  try {
    localStorage.setItem(draftKey(slug), JSON.stringify(envelope));
    return { ok: true, localSeq };
  } catch (draftErr) {
    console.warn('[applicationDraftStorage] Draft save failed (quota or privacy policy):', draftErr);
    return { ok: false, localSeq: null };
  }
}

/**
 * Record that the server has confirmed storing a particular local write.
 *
 * **Refuses when the local copy has moved on.** A save that lands after two more
 * Next presses would otherwise mark the newest local work as synced, and the
 * next page load would hand the applicant the older server copy — reintroducing
 * the exact bug this metadata exists to prevent, through a slower door.
 *
 * @returns {boolean} whether the draft was marked synced at `seq`
 */
export function markDraftSynced(slug, seq) {
  if (!slug || !Number.isInteger(seq)) return false;
  const current = readApplicationDraft(slug);
  // A legacy draft has no sequence to compare, so there is nothing to
  // truthfully mark: leave it to be reconciled on progress instead.
  if (!current?.meta) return false;
  if (current.meta.localSeq !== seq) return false;
  if (current.meta.syncedSeq >= seq) return true;

  const { ok } = saveApplicationDraft(slug, current.data, {
    lastStep: current.lastStep ?? undefined,
    localSeq: seq,
    syncedSeq: seq,
  });
  return ok;
}

export function clearApplicationDraft(slug) {
  if (!slug) return;
  localStorage.removeItem(draftKey(slug));
}

export const __private = { ENVELOPE_VERSION, NEVER_STORED, draftKey };
