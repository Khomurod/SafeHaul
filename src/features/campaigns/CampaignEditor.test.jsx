import React, { act } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fs = vi.hoisted(() => ({
    doc: vi.fn((_db, ...segments) => segments.join('/')),
    onSnapshot: vi.fn(),
}));
const draft = vi.hoisted(() => ({ saveDraft: vi.fn(), isSaving: false }));
const e2e = vi.hoisted(() => ({ enabled: false, param: '' }));
const captured = vi.hoisted(() => ({ audience: null, content: null, launch: null }));

vi.mock('firebase/firestore', () => fs);
vi.mock('@lib/firebase', () => ({ db: {} }));
vi.mock('./hooks/useCampaignDraft', () => ({ useCampaignDraft: () => draft }));
vi.mock('@lib/runtime/e2eMode', () => ({
    get isE2ETestMode() { return e2e.enabled; },
    getE2EQueryParam: () => e2e.param,
}));
vi.mock('./components/AudienceBuilder', () => ({
    AudienceBuilder: (props) => {
        captured.audience = props;
        return (
            <div data-testid="audience" data-scope={props.campaignScopeKey} data-company={props.companyId} data-filters={JSON.stringify(props.filters)}>
                <button type="button" onClick={() => props.onChange({ mode: 'all', rawData: [1, 2, 3] }, 7)}>emit-audience</button>
            </div>
        );
    },
}));
vi.mock('./components/ContentComposer', () => ({
    ContentComposer: (props) => {
        captured.content = props;
        return (
            <div data-testid="content">
                <button type="button" onClick={() => props.onChange({ method: 'sms', message: 'Hi there' })}>emit-content</button>
            </div>
        );
    },
}));
vi.mock('./components/LaunchPad', () => ({
    LaunchPad: (props) => {
        captured.launch = props;
        return <div data-testid="launch" data-company={props.companyId} data-name={props.campaign?.name} />;
    },
}));

import { CampaignEditor } from './CampaignEditor';

let snapCb;
let unsubSpy;

beforeEach(() => {
    vi.clearAllMocks();
    e2e.enabled = false;
    e2e.param = '';
    captured.audience = captured.content = captured.launch = null;
    draft.isSaving = false;
    unsubSpy = vi.fn();
    snapCb = undefined;
    fs.onSnapshot.mockImplementation((ref, cb) => { snapCb = cb; return unsubSpy; });
});

afterEach(() => {
    vi.useRealTimers();
});

function snapshot(data) {
    return { exists: () => true, data: () => data };
}

async function renderEditor(props = {}) {
    const onClose = props.onClose ?? vi.fn();
    let utils;
    await act(async () => {
        utils = render(<CampaignEditor companyId="c1" campaignId="camp1" onClose={onClose} {...props} />);
    });
    // Flush the React.lazy microtask so the active section's child renders.
    await act(async () => {});
    return { onClose, ...utils };
}

// This must run FIRST: React.lazy memoizes the resolved child at module scope,
// so the Suspense fallback is only observable before any other test resolves it.
describe('CampaignEditor — Suspense loading (runs first)', () => {
    it('announces the Suspense loading fallback', async () => {
        const utils = render(<CampaignEditor companyId="c1" campaignId="camp1" onClose={vi.fn()} />);
        expect(utils.getByText('Loading Module...')).toBeInTheDocument();
        await act(async () => {});
        expect(await utils.findByTestId('audience')).toBeInTheDocument();
        utils.unmount();
    });
});

describe('CampaignEditor — listener & cleanup', () => {
    it('subscribes to the exact draft doc and unsubscribes on unmount', async () => {
        const { unmount } = await renderEditor();
        expect(fs.doc).toHaveBeenCalledWith({}, 'companies', 'c1', 'campaign_drafts', 'camp1');
        expect(fs.onSnapshot).toHaveBeenCalledTimes(1);
        unmount();
        expect(unsubSpy).toHaveBeenCalledTimes(1);
    });

    it('does not subscribe when companyId or campaignId is missing', async () => {
        await renderEditor({ campaignId: undefined });
        expect(fs.onSnapshot).not.toHaveBeenCalled();
    });

    it('deep-merges incoming filters while preserving in-memory rawData', async () => {
        await renderEditor();
        // Put rawData into React state via the audience child.
        fireEvent.click(screen.getByText('emit-audience'));
        // Incoming snapshot has filters without rawData.
        await act(async () => { snapCb(snapshot({ name: 'From Firestore', filters: { mode: 'recruiter' } })); });

        const filters = JSON.parse(screen.getByTestId('audience').getAttribute('data-filters'));
        expect(filters.mode).toBe('recruiter'); // incoming wins on overlapping keys
        expect(filters.rawData).toEqual([1, 2, 3]); // preserved from state
        expect(screen.getByRole('textbox', { name: 'Campaign Name' })).toHaveValue('From Firestore');
    });
});

describe('CampaignEditor — autosave', () => {
    it('does not autosave on mount (defaults, not dirty)', async () => {
        vi.useFakeTimers();
        // render without the async helper (fake timers); flush lazy via microtask.
        await act(async () => {
            render(<CampaignEditor companyId="c1" campaignId="camp1" onClose={vi.fn()} />);
        });
        await act(async () => { await Promise.resolve(); });
        act(() => { vi.advanceTimersByTime(2500); });
        expect(draft.saveDraft).not.toHaveBeenCalled();
    });

    it('debounces the save by 2 seconds and strips rawData from the payload', async () => {
        vi.useFakeTimers();
        await act(async () => {
            render(<CampaignEditor companyId="c1" campaignId="camp1" onClose={vi.fn()} />);
        });
        await act(async () => { await Promise.resolve(); });
        // Initialize via the first snapshot, then make a dirty change carrying rawData.
        act(() => { snapCb(snapshot({ name: 'Doc Name', filters: {} })); });
        act(() => { fireEvent.click(screen.getByText('emit-audience')); });

        // Before 2s: not saved yet.
        act(() => { vi.advanceTimersByTime(1500); });
        expect(draft.saveDraft).not.toHaveBeenCalled();

        // At 2s: saved once, with rawData stripped from filters.
        act(() => { vi.advanceTimersByTime(500); });
        expect(draft.saveDraft).toHaveBeenCalledTimes(1);
        const [savedId, payload] = draft.saveDraft.mock.calls[0];
        expect(savedId).toBe('camp1');
        expect(payload.filters).toEqual({ mode: 'all' });
        expect(payload.filters.rawData).toBeUndefined();
        expect(payload.matchCount).toBe(7);
    });
});

describe('CampaignEditor — navigation & completion', () => {
    it('switches sections and passes the exact child props', async () => {
        const { onClose } = await renderEditor();
        // Audience (default) props.
        const audience = screen.getByTestId('audience');
        expect(audience).toHaveAttribute('data-company', 'c1');
        expect(audience).toHaveAttribute('data-scope', 'c1:camp1');
        expect(captured.audience.onChange).toBeTypeOf('function');

        // Content section (lazy — wait for it to load).
        fireEvent.click(screen.getByRole('button', { name: /Content/ }));
        expect(await screen.findByTestId('content')).toBeInTheDocument();
        expect(captured.content.messageConfig).toEqual({ method: 'sms', message: '' });

        // Launch section.
        fireEvent.click(screen.getByRole('button', { name: /Launch/ }));
        expect(await screen.findByTestId('launch')).toHaveAttribute('data-company', 'c1');
        expect(captured.launch.onLaunchSuccess).toBeTypeOf('function');
        expect(captured.launch.campaign.name).toBe('Untitled Campaign');
        expect(onClose).not.toHaveBeenCalled();
    });

    it('marks audience complete when matchCount > 0 and content complete when a message exists', async () => {
        await renderEditor();
        const audienceNav = screen.getByRole('button', { name: /Audience/ });
        expect(audienceNav).toHaveTextContent('(incomplete)');

        fireEvent.click(screen.getByText('emit-audience')); // count 7
        expect(screen.getByRole('button', { name: /Audience/ })).toHaveTextContent('(completed)');

        // Content completion.
        fireEvent.click(screen.getByRole('button', { name: /Content/ }));
        await act(async () => {});
        fireEvent.click(screen.getByText('emit-content'));
        expect(screen.getByRole('button', { name: /Content/ })).toHaveTextContent('(completed)');
    });

    it('marks the active section with aria-current', async () => {
        await renderEditor();
        expect(screen.getByRole('button', { name: /Audience/ })).toHaveAttribute('aria-current', 'step');
        fireEvent.click(screen.getByRole('button', { name: /Content/ }));
        expect(screen.getByRole('button', { name: /Content/ })).toHaveAttribute('aria-current', 'step');
        expect(screen.getByRole('button', { name: /Audience/ })).not.toHaveAttribute('aria-current');
    });
});

describe('CampaignEditor — E2E mock, shell & a11y', () => {
    it('uses the E2E mock data and skips the Firestore listener', async () => {
        e2e.enabled = true;
        e2e.param = 'mock';
        await renderEditor();
        expect(fs.onSnapshot).not.toHaveBeenCalled();
        expect(screen.getByRole('textbox', { name: 'Campaign Name' })).toHaveValue('E2E Mock Campaign');
        // matchCount 12 → audience complete.
        expect(screen.getByRole('button', { name: /Audience/ })).toHaveTextContent('(completed)');
    });

    it('labels the campaign name, announces save status, and exits via onClose', async () => {
        const { onClose } = await renderEditor();
        expect(screen.getByRole('textbox', { name: 'Campaign Name' })).toHaveValue('Untitled Campaign');
        expect(screen.getByRole('status')).toHaveTextContent('Auto-Saved');
        fireEvent.click(screen.getByRole('button', { name: 'Exit' }));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('has no accessibility violations', async () => {
        const { container } = await renderEditor();
        expect((await axe(container)).violations).toEqual([]);
    });
});

// A launched campaign is a record, not a draft: its document is kept and marked
// (`launchedAt`, `sessionId`), and the editor no longer offers Launch.
describe('CampaignEditor — a launched campaign', () => {
    const LAUNCHED = { name: 'Spring drive', launchedAt: { seconds: 1767225600 }, sessionId: 'session-1' };

    async function openLaunch(props) {
        const utils = await renderEditor(props);
        fireEvent.click(screen.getByRole('button', { name: /Launch/ }));
        await screen.findByTestId('launch');
        return utils;
    }

    // The server claims the draft and marks it launched (`initBulkSession`), so
    // Launch names the draft and the editor writes no mark of its own.
    it('names its draft to Launch, and closes after a launch without writing the draft', async () => {
        const { onClose } = await openLaunch();

        expect(captured.launch.campaignId).toBe('camp1');
        act(() => { captured.launch.onLaunchSuccess({ sessionId: 'session-1' }); });

        expect(onClose).toHaveBeenCalledTimes(1);
        expect(draft.saveDraft).not.toHaveBeenCalled();
    });

    // Launch sends what the editor shows: an edit the 2-second autosave has not
    // written yet is saved first, so the draft the server claims (and keeps as
    // the record) holds the same, and the claim's update brings nothing older.
    it('saves what it shows before Launch asks the server, without the launch claim', async () => {
        await openLaunch();
        act(() => { snapCb(snapshot({ name: 'Doc Name', filters: {}, launchClaim: { sessionId: 'x' } })); });
        fireEvent.click(screen.getByRole('button', { name: /Audience/ }));
        act(() => { fireEvent.click(screen.getByText('emit-audience')); });
        fireEvent.click(screen.getByRole('button', { name: /Launch/ }));

        await act(async () => { await captured.launch.onBeforeLaunch(); });

        expect(draft.saveDraft).toHaveBeenCalledTimes(1);
        const [id, saved] = draft.saveDraft.mock.calls[0];
        expect(id).toBe('camp1');
        expect(saved).toMatchObject({ name: 'Doc Name', matchCount: 7, filters: { mode: 'all' } });
        expect(saved).not.toHaveProperty('launchClaim');
        expect(saved.filters).not.toHaveProperty('rawData');
    });

    it('saves nothing before Launch when nothing was edited', async () => {
        await openLaunch();
        act(() => { snapCb(snapshot({ name: 'Doc Name', filters: {} })); });

        await act(async () => { await captured.launch.onBeforeLaunch(); });

        expect(draft.saveDraft).not.toHaveBeenCalled();
    });

    it('never writes the server’s launch claim back when it autosaves', async () => {
        vi.useFakeTimers();
        await act(async () => {
            render(<CampaignEditor companyId="c1" campaignId="camp1" onClose={vi.fn()} />);
        });
        await act(async () => { await Promise.resolve(); });
        const claim = { by: 'admin-2', sessionId: 'session-2', at: { seconds: 1 } };
        act(() => { snapCb(snapshot({ name: 'Doc Name', filters: {}, launchClaim: claim })); });
        act(() => { fireEvent.click(screen.getByText('emit-audience')); });

        act(() => { vi.advanceTimersByTime(2500); });

        expect(draft.saveDraft).toHaveBeenCalledTimes(1);
        expect(draft.saveDraft.mock.calls[0][0]).toBe('camp1');
        expect(draft.saveDraft.mock.calls[0][1]).not.toHaveProperty('launchClaim');
        expect(draft.saveDraft.mock.calls[0][1].name).toBe('Doc Name');
    });

    it('says it was launched, links its report and offers no Launch, even with Launch open in a stale tab', async () => {
        const onViewReport = vi.fn();
        const { onClose } = await openLaunch({ onViewReport });

        await act(async () => { snapCb(snapshot(LAUNCHED)); });

        expect(screen.getByText('This campaign was already launched')).toBeInTheDocument();
        expect(screen.queryByTestId('launch')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Launch/ })).not.toBeInTheDocument();
        expect(screen.queryByRole('textbox', { name: 'Campaign Name' })).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'View report' }));
        expect(onViewReport).toHaveBeenCalledWith('session-1');
        fireEvent.click(screen.getByRole('button', { name: 'Exit' }));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('counts a launch whose server time is still pending as launched', async () => {
        await renderEditor({ onViewReport: vi.fn() });

        await act(async () => { snapCb(snapshot({ ...LAUNCHED, launchedAt: null })); });

        expect(screen.getByText('This campaign was already launched')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Launch/ })).not.toBeInTheDocument();
    });

    it('offers no report link when the launch returned no session', async () => {
        await renderEditor({ onViewReport: vi.fn() });

        await act(async () => { snapCb(snapshot({ ...LAUNCHED, sessionId: null })); });

        expect(screen.getByText('This campaign was already launched')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'View report' })).not.toBeInTheDocument();
    });

    it('stops autosaving once the draft is launched, so a stale tab does not rewrite the record', async () => {
        vi.useFakeTimers();
        await act(async () => {
            render(<CampaignEditor companyId="c1" campaignId="camp1" onClose={vi.fn()} />);
        });
        await act(async () => { await Promise.resolve(); });
        act(() => { snapCb(snapshot({ name: 'Doc Name', filters: {} })); });
        act(() => { fireEvent.click(screen.getByText('emit-audience')); });

        act(() => { snapCb(snapshot(LAUNCHED)); });
        act(() => { vi.advanceTimersByTime(2500); });

        expect(draft.saveDraft).not.toHaveBeenCalled();
    });

    it('has no accessibility violations in the launched notice', async () => {
        const { container } = await renderEditor({ onViewReport: vi.fn() });
        await act(async () => { snapCb(snapshot(LAUNCHED)); });

        expect((await axe(container)).violations).toEqual([]);
    });
});
