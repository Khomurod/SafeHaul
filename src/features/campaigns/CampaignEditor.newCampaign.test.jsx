// A campaign "Create campaign" opened has no draft until its first save. This
// suite drives the editor with the real draft hook and the real Launch step;
// Firestore and the callable are doubles, so nothing reaches Firebase. All
// names and messages are artificial.
import React, { act } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fs = vi.hoisted(() => ({
    doc: vi.fn(),
    onSnapshot: vi.fn(),
    setDoc: vi.fn(),
    Timestamp: { now: vi.fn() },
}));
const launch = vi.hoisted(() => ({ initBulkSession: vi.fn(), httpsCallable: vi.fn() }));
const toast = vi.hoisted(() => ({ showSuccess: vi.fn(), showError: vi.fn() }));

vi.mock('firebase/firestore', () => fs);
vi.mock('firebase/functions', () => ({ httpsCallable: launch.httpsCallable }));
vi.mock('@lib/firebase', () => ({ db: {}, functions: {} }));
vi.mock('@shared/components/feedback/ToastProvider', () => ({ useToast: () => toast }));
vi.mock('@lib/runtime/e2eMode', () => ({ isE2ETestMode: false, getE2EQueryParam: () => '' }));
// Like the real step, the audience double reports as soon as it opens; its
// button is the recruiter choosing an audience of 7.
vi.mock('./components/AudienceBuilder', () => ({
    AudienceBuilder: ({ filters, onChange }) => {
        React.useEffect(() => { onChange(filters, 0); }, []); // eslint-disable-line react-hooks/exhaustive-deps
        return <button type="button" onClick={() => onChange({ mode: 'all' }, 7)}>choose audience</button>;
    },
}));
vi.mock('./components/ContentComposer', () => ({
    ContentComposer: ({ onChange }) => (
        <button type="button" onClick={() => onChange({ method: 'sms', message: 'Artificial outreach message.' })}>write message</button>
    ),
}));

import { CampaignEditor } from './CampaignEditor';
// Loaded up front, so the editor's lazy import of it settles without real I/O
// under the fake clock.
import './components/LaunchPad';

const DRAFT_PATH = 'companies/co-1/campaign_drafts/camp_new';

beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    fs.doc.mockImplementation((_db, ...segments) => ({ path: segments.join('/') }));
    fs.onSnapshot.mockImplementation(() => () => {});
    fs.setDoc.mockImplementation(async () => {});
    fs.Timestamp.now.mockImplementation(() => '__now__');
    launch.initBulkSession.mockImplementation(async () => ({ data: { success: true, targetCount: 7, sessionId: 'session-new-1' } }));
    launch.httpsCallable.mockImplementation(() => launch.initBulkSession);
});

afterEach(() => {
    vi.useRealTimers();
});

/** Lets the save's promises (the hook's lazy Firestore import included) settle. */
const settle = () => act(async () => {
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
});

async function openNewCampaign(onClose = vi.fn()) {
    await act(async () => {
        render(<CampaignEditor companyId="co-1" campaignId="camp_new" isNew onClose={onClose} />);
    });
    await settle();
    return onClose;
}

const sectionButton = (name) => within(screen.getByRole('navigation', { name: 'Campaign sections' }))
    .getByRole('button', { name });

const rename = (name) => fireEvent.change(screen.getByRole('textbox', { name: 'Campaign Name' }), { target: { value: name } });

async function autosave() {
    act(() => { vi.advanceTimersByTime(2000); });
    await settle();
}

async function openSection(name) {
    fireEvent.click(sectionButton(name));
    await settle();
}

async function launchNow() {
    fireEvent.click(screen.getByRole('button', { name: /Launch Immediately/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Launch' }));
    await settle();
}

describe('CampaignEditor — a new campaign', () => {
    it('writes nothing while it is only opened, recounted and left', async () => {
        const onClose = await openNewCampaign();

        expect(screen.getByText('Not saved yet')).toHaveAttribute('role', 'status');
        act(() => { vi.advanceTimersByTime(10_000); });
        await settle();
        fireEvent.click(screen.getByRole('button', { name: 'Exit' }));

        expect(onClose).toHaveBeenCalledTimes(1);
        expect(fs.setDoc).not.toHaveBeenCalled();
    });

    it('creates exactly one draft on its first save, and later saves update it', async () => {
        await openNewCampaign();

        rename('Spring drive');
        await autosave();

        expect(fs.setDoc).toHaveBeenCalledTimes(1);
        const [ref, created, options] = fs.setDoc.mock.calls[0];
        expect(ref.path).toBe(DRAFT_PATH);
        expect(created).toEqual({
            name: 'Spring drive',
            status: 'draft',
            filters: {},
            messageConfig: { method: 'sms', message: '' },
            createdAt: '__now__',
            updatedAt: '__now__',
        });
        expect(options).toEqual({ merge: true });
        expect(screen.getByText('Auto-Saved')).toBeInTheDocument();

        rename('Spring drive 2');
        await autosave();

        expect(fs.setDoc).toHaveBeenCalledTimes(2);
        const [sameRef, updated] = fs.setDoc.mock.calls[1];
        expect(sameRef.path).toBe(DRAFT_PATH);
        expect(updated.name).toBe('Spring drive 2');
        expect(updated).not.toHaveProperty('createdAt');
        expect(updated).not.toHaveProperty('updatedAt');
    });

    it('saves a never-saved campaign before Launch, then launches that draft', async () => {
        const onClose = await openNewCampaign();
        fireEvent.click(screen.getByRole('button', { name: 'choose audience' }));
        await openSection(/Content/);
        fireEvent.click(screen.getByRole('button', { name: 'write message' }));
        await openSection(/Launch/);

        // Within the 2 seconds before autosave: Launch's own save creates the draft.
        await launchNow();

        expect(fs.setDoc).toHaveBeenCalledTimes(1);
        const [ref, created] = fs.setDoc.mock.calls[0];
        expect(ref.path).toBe(DRAFT_PATH);
        expect(created).toMatchObject({ matchCount: 7, createdAt: '__now__', messageConfig: { message: 'Artificial outreach message.' } });
        expect(launch.httpsCallable).toHaveBeenCalledWith({}, 'initBulkSession');
        expect(launch.initBulkSession).toHaveBeenCalledTimes(1);
        expect(launch.initBulkSession.mock.calls[0][0]).toMatchObject({ companyId: 'co-1', campaignId: 'camp_new' });
        expect(fs.setDoc.mock.invocationCallOrder[0]).toBeLessThan(launch.initBulkSession.mock.invocationCallOrder[0]);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('does not launch when that first save fails, and creates the draft on the next save', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        fs.setDoc.mockImplementation(async () => { throw new Error('unavailable'); });
        await openNewCampaign();
        fireEvent.click(screen.getByRole('button', { name: 'choose audience' }));
        await openSection(/Content/);
        fireEvent.click(screen.getByRole('button', { name: 'write message' }));
        await openSection(/Launch/);

        await launchNow();

        expect(launch.initBulkSession).not.toHaveBeenCalled();
        expect(toast.showError).toHaveBeenCalledWith('We could not save the campaign. Check your connection and try again.');
        expect(screen.getByText('Not saved yet')).toBeInTheDocument();

        fs.setDoc.mockImplementation(async () => {});
        await autosave();

        expect(fs.setDoc).toHaveBeenCalledTimes(2);
        expect(fs.setDoc.mock.calls[1][0].path).toBe(DRAFT_PATH);
        expect(fs.setDoc.mock.calls[1][1]).toMatchObject({ createdAt: '__now__', updatedAt: '__now__' });
    });

    it('writes one draft when an autosave and the save before Launch overlap', async () => {
        let finishAutosave;
        fs.setDoc.mockImplementationOnce(() => new Promise((resolve) => { finishAutosave = resolve; }));
        await openNewCampaign();
        fireEvent.click(screen.getByRole('button', { name: 'choose audience' }));
        await openSection(/Content/);
        fireEvent.click(screen.getByRole('button', { name: 'write message' }));
        await openSection(/Launch/);
        await autosave();
        expect(fs.setDoc).toHaveBeenCalledTimes(1);

        await launchNow();
        await act(async () => { finishAutosave(); });
        await settle();

        expect(fs.setDoc).toHaveBeenCalledTimes(2);
        expect(fs.setDoc.mock.calls.map(([ref]) => ref.path)).toEqual([DRAFT_PATH, DRAFT_PATH]);
        expect(launch.initBulkSession.mock.calls[0][0].campaignId).toBe('camp_new');
    });
});
