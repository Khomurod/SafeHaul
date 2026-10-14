/**
 * The workspace learns that its company was deactivated from the company
 * document as it changes, not from the sign-in token, which keeps the role for
 * up to an hour. A super admin is never shut out. All ids are artificial.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

const fx = vi.hoisted(() => ({ data: {}, listeners: [], unsubscribed: [], tokenObservers: [] }));

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

import { useCompanyDeactivated } from './useCompanyDeactivated';

const snapshot = (data) => ({ exists: () => data !== undefined, data: () => data });
const emit = (data) => act(() => { fx.listeners.at(-1).next(snapshot(data)); });

afterEach(() => {
    fx.data = {};
    fx.listeners.length = 0;
    fx.unsubscribed.length = 0;
    fx.tokenObservers.length = 0;
});

describe('useCompanyDeactivated', () => {
    it('turns true the moment the company document says so, and back on re-activation', () => {
        fx.data = { currentCompanyProfile: { id: 'co-1', isActive: true }, userRole: 'recruiter' };
        const { result } = renderHook(() => useCompanyDeactivated());

        expect(fx.listeners.map((l) => l.path)).toEqual(['companies/co-1']);
        expect(result.current).toBe(false);

        emit({ isActive: false });
        expect(result.current).toBe(true);

        emit({ isActive: true });
        expect(result.current).toBe(false);
    });

    it('judges the company as the server does, by its status too', () => {
        fx.data = { currentCompanyProfile: { id: 'co-1' }, userRole: 'company_admin' };
        const { result } = renderHook(() => useCompanyDeactivated());

        emit({ status: 'Suspended' });
        expect(result.current).toBe(true);
    });

    it('starts from the profile already loaded, before the document answers', () => {
        fx.data = { currentCompanyProfile: { id: 'co-1', isActive: false }, userRole: 'hr_user' };
        const { result } = renderHook(() => useCompanyDeactivated());

        expect(result.current).toBe(true);
    });

    it('lets a missing document decide nothing, as the cache answers offline', () => {
        fx.data = { currentCompanyProfile: { id: 'co-1', isActive: false }, userRole: 'recruiter' };
        const { result } = renderHook(() => useCompanyDeactivated());

        emit(undefined);
        expect(result.current).toBe(true);
    });

    it('lets a refused read decide nothing', () => {
        fx.data = { currentCompanyProfile: { id: 'co-1', isActive: true }, userRole: 'recruiter' };
        const { result } = renderHook(() => useCompanyDeactivated());

        act(() => { fx.listeners[0].error(Object.assign(new Error('denied'), { code: 'permission-denied' })); });
        expect(result.current).toBe(false);
    });

    it('watches again with the next token after the rules refused the read, so a re-activation reopens', () => {
        fx.data = { currentCompanyProfile: { id: 'co-1', isActive: true }, userRole: 'recruiter' };
        const { result } = renderHook(() => useCompanyDeactivated());
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

    it('never shuts out a super admin, who is not watched', () => {
        fx.data = { currentCompanyProfile: { id: 'co-1', isActive: false }, userRole: 'super_admin' };
        const { result } = renderHook(() => useCompanyDeactivated());

        expect(result.current).toBe(false);
        expect(fx.listeners).toEqual([]);
    });

    it("watches the next company when the user switches, without carrying the last one's answer", () => {
        fx.data = { currentCompanyProfile: { id: 'co-1', isActive: true }, userRole: 'recruiter' };
        const { result, rerender } = renderHook(() => useCompanyDeactivated());
        emit({ isActive: false });
        expect(result.current).toBe(true);

        fx.data = { currentCompanyProfile: { id: 'co-2', isActive: true }, userRole: 'recruiter' };
        rerender();

        expect(result.current).toBe(false);
        expect(fx.unsubscribed.map((l) => l.path)).toEqual(['companies/co-1']);
        expect(fx.listeners.at(-1).path).toBe('companies/co-2');
    });
});
