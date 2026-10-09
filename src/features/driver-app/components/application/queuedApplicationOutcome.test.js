/**
 * How the end of a queued application reaches its page, and which ends a page
 * takes when it opens.
 *
 * The queue runs in whichever tab of the site is open, so the page that shows
 * the application may be in another; and one device can hold more than one
 * application for a company, each owed its own end.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const queue = vi.hoisted(() => ({ entries: [], dequeued: [] }));

vi.mock('@lib/submissionQueue', () => ({
  getAllEntries: async () => queue.entries,
  dequeueSubmission: async (id) => {
    queue.dequeued.push(id);
    return true;
  },
  isSupported: () => true,
}));

import {
  announceQueuedApplication,
  QUEUED_APPLICATION_EVENT,
  subscribeToQueuedApplications,
  takeEndedEntries,
} from './queuedApplicationOutcome';
import { writeDiscardMark } from './applicationDraftStorage';

const ended = (id, applyDraftId, over = {}) => ({
  id,
  applySlug: 'acme',
  applyDraftId,
  applyDiscardMark: null,
  status: 'refused',
  createdAt: 1,
  data: {},
  refusal: { message: `Refused ${id}.`, issues: [] },
  ...over,
});

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  queue.entries = [];
  queue.dequeued = [];
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the ends a page takes when it opens', () => {
  it('are its own application\'s only: another\'s waits for that one\'s page', async () => {
    queue.entries = [ended('q-a', 'draft-a'), ended('q-b', 'draft-b', { status: 'failed' })];

    const taken = await takeEndedEntries('acme', 'draft-b');

    expect(taken).toEqual([expect.objectContaining({ entryId: 'q-b', applyDraftId: 'draft-b', outcome: 'failed' })]);
    expect(queue.dequeued).toEqual(['q-b']);
  });

  it('newest first, each taken out of the queue', async () => {
    queue.entries = [ended('q-1', 'draft-a', { createdAt: 1 }), ended('q-2', 'draft-a', { createdAt: 2 })];

    const taken = await takeEndedEntries('acme', 'draft-a');

    expect(taken.map((detail) => detail.entryId)).toEqual(['q-2', 'q-1']);
    expect(queue.dequeued.sort()).toEqual(['q-1', 'q-2']);
  });

  it('drop, unannounced, one discarded since and one that names no application, as nobody\'s', async () => {
    queue.entries = [ended('q-discarded', 'draft-a'), ended('q-unnamed', null)];
    writeDiscardMark('acme');

    const taken = await takeEndedEntries('acme', 'draft-b');

    expect(taken).toEqual([]);
    expect(queue.dequeued.sort()).toEqual(['q-discarded', 'q-unnamed']);
  });

  it('leave another company\'s, and anything still waiting to be sent', async () => {
    queue.entries = [ended('q-other', 'draft-a', { applySlug: 'globex' }), ended('q-waiting', 'draft-a', { status: 'pending' })];

    expect(await takeEndedEntries('acme', 'draft-a')).toEqual([]);
    expect(queue.dequeued).toEqual([]);
  });
});

describe('an end the queue announces', () => {
  const SENT = {
    slug: 'acme',
    companyId: 'co-1',
    entryId: 'q-1',
    applyDraftId: 'draft-a',
    outcome: 'sent',
    applicationId: 'app-9',
    confirmationNumber: 'CONF-9',
  };

  it('reaches the site\'s other tabs through storage, and leaves nothing there', () => {
    const setItem = vi.spyOn(localStorage, 'setItem');

    announceQueuedApplication(SENT);

    expect(setItem).toHaveBeenCalledWith('safehaul:queued-application', JSON.stringify(SENT));
    expect(localStorage.getItem('safehaul:queued-application')).toBeNull();
  });

  it('is heard from this tab and from another, until the page stops listening', () => {
    const heard = [];
    const stop = subscribeToQueuedApplications((detail) => heard.push(detail.outcome));

    window.dispatchEvent(new CustomEvent(QUEUED_APPLICATION_EVENT, { detail: SENT }));
    window.dispatchEvent(new StorageEvent('storage', {
      key: 'safehaul:queued-application',
      newValue: JSON.stringify({ ...SENT, outcome: 'refused' }),
    }));
    // The removal after each write, another key and a value not ours are no news.
    window.dispatchEvent(new StorageEvent('storage', { key: 'safehaul:queued-application', newValue: null }));
    window.dispatchEvent(new StorageEvent('storage', { key: 'draft_acme', newValue: '{}' }));
    window.dispatchEvent(new StorageEvent('storage', { key: 'safehaul:queued-application', newValue: 'not json' }));
    stop();
    window.dispatchEvent(new CustomEvent(QUEUED_APPLICATION_EVENT, { detail: { ...SENT, outcome: 'failed' } }));

    expect(heard).toEqual(['sent', 'refused']);
  });
});
