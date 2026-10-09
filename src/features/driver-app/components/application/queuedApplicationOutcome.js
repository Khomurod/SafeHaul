/**
 * How the end of a queued guest submission reaches the application's page.
 *
 * The offline queue replays a submission from whichever page of the site is
 * open on the device, often long after the page that queued it stopped waiting.
 * When one ends (sent, refused, or out of attempts) the queue announces it here,
 * and an open application page for that slug takes it up, in this tab or another:
 * the confirmation number, or the reason and the page to fix. An entry nobody was
 * there to hear keeps its end in the queue, for the page to read when it is next
 * opened.
 */
import { dequeueSubmission, getAllEntries, isSupported } from '@lib/submissionQueue';
import { readDiscardMark } from './applicationDraftStorage';
import { savePostApplySession } from './postApplyDocsStorage';

export const QUEUED_APPLICATION_EVENT = 'safehaul:queued-application';
/**
 * The same news for the site's other tabs, as an event reaches only its own
 * window. Written and taken away at once: each write fires the `storage` event in
 * every other tab, and nothing is left behind.
 */
const OTHER_TABS_KEY = 'safehaul:queued-application';

/** What the page is told about an entry that ended. */
export function queuedOutcome(entry, outcome, { result, error } = {}) {
  const data = result?.data || {};
  return {
    slug: entry.applySlug,
    companyId: entry.companyId,
    entryId: entry.id,
    applyDraftId: entry.applyDraftId || null,
    outcome,
    applicationId: data.applicationId || entry.data?.applicationId || null,
    confirmationNumber: data.confirmationNumber || entry.data?.confirmationNumber || null,
    message: outcome === 'refused' ? (error?.message || entry.refusal?.message || null) : null,
    issues: error?.details?.issues || entry.refusal?.issues || [],
  };
}

/**
 * A sent one's confirmation, kept for this tab's next visit to the page (the
 * success screen restores from it, as after the signing room).
 */
export function keepConfirmation(detail) {
  if (detail?.outcome !== 'sent' || !detail.companyId || !detail.applicationId) return;
  savePostApplySession(detail.companyId, {
    applicationId: detail.applicationId,
    confirmationNumber: detail.confirmationNumber || '',
    slug: detail.slug,
    docs: {},
  });
}

/** Tells an open page, in this tab or another, and keeps a sent one's confirmation. */
export function announceQueuedApplication(detail) {
  if (!detail?.slug) return;
  keepConfirmation(detail);
  window.dispatchEvent(new CustomEvent(QUEUED_APPLICATION_EVENT, { detail }));
  try {
    localStorage.setItem(OTHER_TABS_KEY, JSON.stringify(detail));
    localStorage.removeItem(OTHER_TABS_KEY);
  } catch {
    // No storage to tell them through: this tab was told, and a refusal's end
    // stays in the queue for the page's next open.
  }
}

/** `listener(detail)` for each end announced in this tab or another; returns the unsubscribe. */
export function subscribeToQueuedApplications(listener) {
  const here = (event) => listener(event.detail);
  const elsewhere = (event) => {
    if (event.key !== OTHER_TABS_KEY || !event.newValue) return;
    let detail;
    try {
      detail = JSON.parse(event.newValue);
    } catch {
      return;
    }
    listener(detail);
  };
  window.addEventListener(QUEUED_APPLICATION_EVENT, here);
  window.addEventListener('storage', elsewhere);
  return () => {
    window.removeEventListener(QUEUED_APPLICATION_EVENT, here);
    window.removeEventListener('storage', elsewhere);
  };
}

/**
 * The ends of application `draftId` that came while no page was open to hear
 * (refused, or out of attempts), newest first. Each is taken out of the queue:
 * told once is enough. Another application's wait for its own page; one
 * discarded since, or naming no application, is nobody's and goes unannounced.
 */
export async function takeEndedEntries(slug, draftId) {
  if (!slug || !isSupported()) return [];
  const ended = (await getAllEntries())
    .filter((entry) => entry.applySlug === slug && (entry.status === 'refused' || entry.status === 'failed'));
  const current = (entry) => entry.applyDiscardMark === undefined || readDiscardMark(slug) === entry.applyDiscardMark;
  const mine = (entry) => Boolean(draftId) && entry.applyDraftId === draftId && current(entry);
  const taken = ended.filter((entry) => mine(entry) || !current(entry) || !entry.applyDraftId);
  await Promise.all(taken.map((entry) => dequeueSubmission(entry.id).catch(() => false)));
  return taken
    .filter(mine)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((entry) => queuedOutcome(entry, entry.status));
}
