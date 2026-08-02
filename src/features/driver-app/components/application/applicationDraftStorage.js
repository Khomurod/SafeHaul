/**
 * Local draft persistence for the public application wizard.
 *
 * One responsibility: reading/writing the per-slug application draft in
 * localStorage. SEC-2: `ssn` and `signature` are NEVER persisted — they are
 * PII/biometric data accessible to any JavaScript on the page (XSS vector)
 * and would otherwise survive across sessions.
 */

const draftKey = (slug) => `draft_${slug}`;

/**
 * Read a saved draft. Returns the parsed object, or null when absent/corrupt.
 */
export function readApplicationDraft(slug) {
  if (!slug) return null;
  try {
    const raw = localStorage.getItem(draftKey(slug));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (draftErr) {
    console.warn('[applicationDraftStorage] Failed to load draft:', draftErr);
    return null;
  }
}

/**
 * Persist the draft (minus ssn/signature). Returns true when the write
 * succeeded — a QuotaExceededError (DL-1) yields false so callers can inform
 * the user instead of silently swallowing it.
 *
 * @param {string} slug
 * @param {object} formData
 * @param {{ lastStep?: number }} [options]
 */
export function saveApplicationDraft(slug, formData, options = {}) {
  if (!slug) return false;
  const { ssn: _ssn, signature: _sig, ...draftPayload } = formData;
  const payload = typeof options.lastStep === 'number'
    ? { ...draftPayload, lastStep: options.lastStep }
    : draftPayload;
  try {
    localStorage.setItem(draftKey(slug), JSON.stringify(payload));
    return true;
  } catch (draftErr) {
    console.warn('[applicationDraftStorage] Draft save failed (quota or privacy policy):', draftErr);
    return false;
  }
}

export function clearApplicationDraft(slug) {
  if (!slug) return;
  localStorage.removeItem(draftKey(slug));
}
