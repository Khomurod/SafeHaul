/**
 * The workspace follows its company's document as it changes, not the copy read
 * at sign-in: a feature a super admin switches reaches it without a reload, and
 * a deactivation closes it, which the sign-in token, keeping the role for up to
 * an hour, would not. A super admin is never shut out. All ids are artificial.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

const fx = vi.hoisted(() => ({ data: {}, listeners: [], unsubscribed: [], tokenObservers: [], applied: [] }));

vi.mock('@/context/DataContext', () => ({ useData: () => fx.data }));
vi.mock('@lib/firebase', () => ({ db: {}, auth: {} }));
vi.mock('firebase/auth', () => ({
    onIdTokenChanged: (_auth, observer) => {
        fx.tokenObservers.push(observer);
        return () => { fx.tokenObservers.splice(fx.tokenObservers.indexOf(observer), 1); };
    },
}));
vi.mock('firebase/firestore', () => ({
    doc: (_db, ...path) => ({ path: path.join('/') }),
    onSnapshot: (ref, next, error) => {
        const listener = { path: ref.path, next, error };
        fx.listeners.push(listener);
        return () => fx.unsubscribed.push(listener);
    },
}));

import { useLiveCompany } from './useLiveCompany';

const snapshot = (data) => ({ exists: () => data !== undefined, data: () => data });
const emit = (data) => act(() => { fx.listeners.at(-1).next(snapshot(data)); });
const applyCompanyChanges = (companyId, changes) => fx.applied.push({ companyId, changes });
const session = (profile, userRole = 'recruiter') => ({ currentCompanyProfile: profile, userRole, applyCompanyChanges });

// Before each test, not after: the last test's hook unmounts after its own
// `afterEach`, and its listener's unsubscribe would land in the next test.
beforeEach(() => {
    fx.data = {};
    fx.listeners.length = 0;
    fx.unsubscribed.length = 0;
    fx.tokenObservers.length = 0;
    fx.applied.length = 0;
});

describe('useLiveCompany: whether the company is deactivated', () => {
    it('turns true the moment the company document says so, and back on re-activation', () => {
        fx.data = session({ id: 'co-1', isActive: true });
        const { result } = renderHook(() => useLiveCompany());

        expect(fx.listeners.map((l) => l.path)).toEqual(['companies/co-1']);
        expect(result.current).toBe(false);

        emit({ isActive: false });
        expect(result.current).toBe(true);

        emit({ isActive: true });
        expect(result.current).toBe(false);
    });

    it('judges the company as the server does, by its status too', () => {
        fx.data = session({ id: 'co-1' }, 'company_admin');
        const { result } = renderHook(() => useLiveCompany());

        emit({ status: 'Suspended' });
        expect(result.current).toBe(true);
    });

    it('starts from the profile already loaded, before the document answers', () => {
        fx.data = session({ id: 'co-1', isActive: false }, 'hr_user');
        const { result } = renderHook(() => useLiveCompany());

        expect(result.current).toBe(true);
    });

    it('lets a missing document decide nothing, as the cache answers offline', () => {
        fx.data = session({ id: 'co-1', isActive: false, features: { eDocs: false } });
        const { result } = renderHook(() => useLiveCompany());

        emit(undefined);
        expect(result.current).toBe(true);
        expect(fx.applied).toEqual([]);
    });

    it('lets a refused read decide nothing', () => {
        fx.data = session({ id: 'co-1', isActive: true, features: { eDocs: false } });
        const { result } = renderHook(() => useLiveCompany());

        act(() => { fx.listeners[0].error(Object.assign(new Error('denied'), { code: 'permission-denied' })); });
        expect(result.current).toBe(false);
        expect(fx.applied).toEqual([]);
    });

    it('watches again with the next token after the rules refused the read, so a re-activation reopens', () => {
        fx.data = session({ id: 'co-1', isActive: true });
        const { result } = renderHook(() => useLiveCompany());
        emit({ isActive: false });
        expect(result.current).toBe(true);

        // The token loses the company's role: the listener is refused and stops.
        act(() => { fx.listeners[0].error(Object.assign(new Error('denied'), { code: 'permission-denied' })); });
        expect(result.current).toBe(true);
        expect(fx.tokenObservers).toHaveLength(1);

        // The first call reports the token in hand; a new one starts another listener.
        act(() => { fx.tokenObservers[0]({ uid: 'u-1' }); });
        expect(fx.listeners).toHaveLength(1);
        act(() => { fx.tokenObservers[0]({ uid: 'u-1' }); });
        expect(fx.listeners).toHaveLength(2);
        expect(fx.tokenObservers).toHaveLength(0);

        emit({ isActive: true });
        expect(result.current).toBe(false);
    });

    it('never shuts out a super admin', () => {
        fx.data = session({ id: 'co-1', isActive: false }, 'super_admin');
        const { result } = renderHook(() => useLiveCompany());
        expect(result.current).toBe(false);

        emit({ isActive: false });
        expect(result.current).toBe(false);
    });

    it("watches the next company when the user switches, without carrying the last one's answer", () => {
        fx.data = session({ id: 'co-1', isActive: true });
        const { result, rerender } = renderHook(() => useLiveCompany());
        emit({ isActive: false });
        expect(result.current).toBe(true);

        fx.data = session({ id: 'co-2', isActive: true });
        rerender();

        expect(result.current).toBe(false);
        expect(fx.unsubscribed.map((l) => l.path)).toEqual(['companies/co-1']);
        expect(fx.listeners.at(-1).path).toBe('companies/co-2');
    });
});

describe('useLiveCompany: the feature switches', () => {
    it('gives the company in use a feature a super admin switched, and only its switches', () => {
        fx.data = session({ id: 'co-1', companyName: 'Artificial Co', features: { eDocs: true } });
        renderHook(() => useLiveCompany());

        emit({ companyName: 'Renamed elsewhere', features: { eDocs: false }, featureSchedules: { pev: '2030-01-01T00:00:00.000Z' } });

        expect(fx.applied).toEqual([{
            companyId: 'co-1',
            changes: { features: { eDocs: false }, featureSchedules: { pev: '2030-01-01T00:00:00.000Z' } },
        }]);
    });

    it('changes nothing when the switches are as the company in use already holds them', () => {
        fx.data = session({ id: 'co-1', features: { eDocs: false, pev: true }, featureSchedules: { pev: null } });
        renderHook(() => useLiveCompany());

        // The first answer, and a later write to another field, carry the same switches.
        emit({ features: { pev: true, eDocs: false }, featureSchedules: { pev: null } });
        emit({ companyName: 'Renamed', features: { pev: true, eDocs: false }, featureSchedules: { pev: null } });

        expect(fx.applied).toEqual([]);
    });

    it('treats a company that never set a switch as one with none set', () => {
        fx.data = session({ id: 'co-1' });
        renderHook(() => useLiveCompany());

        emit({ companyName: 'Artificial Co' });
        emit({ features: {}, featureSchedules: {} });

        expect(fx.applied).toEqual([]);
    });

    it('takes a switch removed from the document as removed', () => {
        fx.data = session({ id: 'co-1', features: { callTracking: true } });
        renderHook(() => useLiveCompany());

        emit({ features: {} });

        expect(fx.applied).toEqual([{ companyId: 'co-1', changes: { features: {}, featureSchedules: undefined } }]);
    });

    it("measures the next answer against the company as it now is", () => {
        fx.data = session({ id: 'co-1', features: { eDocs: true } });
        const { rerender } = renderHook(() => useLiveCompany());

        emit({ features: { eDocs: false } });
        expect(fx.applied).toHaveLength(1);

        // The company in use took the switch; the same answer again changes nothing.
        fx.data = session({ id: 'co-1', features: { eDocs: false } });
        rerender();
        emit({ companyName: 'Renamed', features: { eDocs: false } });

        expect(fx.applied).toHaveLength(1);
        expect(fx.listeners).toHaveLength(1);
    });

    it("follows a super admin's switches in their workspace too", () => {
        fx.data = session({ id: 'co-1', features: { campaignsEnabled: true } }, 'super_admin');
        renderHook(() => useLiveCompany());

        expect(fx.listeners.map((l) => l.path)).toEqual(['companies/co-1']);
        emit({ features: { campaignsEnabled: false } });

        expect(fx.applied).toEqual([{ companyId: 'co-1', changes: { features: { campaignsEnabled: false }, featureSchedules: undefined } }]);
    });

    it('stops watching on sign-out and on leaving the workspace', () => {
        fx.data = session({ id: 'co-1' });
        const { rerender, unmount } = renderHook(() => useLiveCompany());

        // Signing out, or going back to the company chooser, leaves no company in use.
        fx.data = session(null);
        rerender();
        expect(fx.unsubscribed.map((l) => l.path)).toEqual(['companies/co-1']);
        expect(fx.listeners).toHaveLength(1);

        fx.data = session({ id: 'co-2' });
        rerender();
        unmount();
        expect(fx.unsubscribed.map((l) => l.path)).toEqual(['companies/co-1', 'companies/co-2']);
    });
});
