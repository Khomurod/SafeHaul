/**
 * How the end of a queued guest submission reaches the application's page.
 *
 * The offline queue replays a submission from whichever page of the site is
 * open on the device, often long after the page that queued it stopped waiting.
 * When one ends (sent, refused, or out of attempts) the queue announces it here,
 * and an open application page for that slug takes it up: the confirmation
 * number, or the reason and the page to fix. An entry nobody was there to hear
 * keeps its end in the queue, for the page to read when it is next opened.
 */
import { dequeueSubmission, getAllEntries, isSupported } from '@lib/submissionQueue';
import { readDiscardMark } from './applicationDraftStorage';
import { savePostApplySession } from './postApplyDocsStorage';

export const QUEUED_APPLICATION_EVENT = 'safehaul:queued-application';

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
 * Tells an open page, and keeps a sent one's confirmation for this tab's next
 * visit to the page (the success screen restores from it, as after the signing
 * room).
 */
export function announceQueuedApplication(detail) {
  if (!detail?.slug) return;
  if (detail.outcome === 'sent' && detail.companyId && detail.applicationId) {
    savePostApplySession(detail.companyId, {
      applicationId: detail.applicationId,
      confirmationNumber: detail.confirmationNumber || '',
      slug: detail.slug,
      docs: {},
    });
  }
  window.dispatchEvent(new CustomEvent(QUEUED_APPLICATION_EVENT, { detail }));
}

/**
 * The entries for `slug` that ended while no page was open to hear (refused, or
 * out of attempts), newest first. Each is taken out of the queue: told once is
 * enough. One whose application was discarded since is dropped unannounced.
 */
export async function takeEndedEntries(slug) {
  if (!slug || !isSupported()) return [];
  const entries = (await getAllEntries())
    .filter((entry) => entry.applySlug === slug && (entry.status === 'refused' || entry.status === 'failed'))
    .sort((a, b) => b.createdAt - a.createdAt);
  await Promise.all(entries.map((entry) => dequeueSubmission(entry.id).catch(() => false)));
  return entries
    .filter((entry) => entry.applyDiscardMark === undefined || readDiscardMark(slug) === entry.applyDiscardMark)
    .map((entry) => queuedOutcome(entry, entry.status));
}
