import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Artificial data only.
const fake = vi.hoisted(() => ({ docs: {}, callables: {} }));

vi.mock('@lib/firebase', () => ({ db: {}, functions: {} }));
vi.mock('firebase/firestore', () => ({
    doc: (_db, ...segs) => segs.join('/'),
    getDoc: async (ref) => {
        const value = fake.docs[ref];
        if (value instanceof Error) throw value;
        return value ? { exists: () => true, data: () => value } : { exists: () => false };
    },
}));
vi.mock('firebase/functions', () => ({
    httpsCallable: (_functions, name) => async () => {
        const value = fake.callables[name];
        if (value instanceof Error) throw value;
        return { data: value };
    },
}));

import { useSettingsOverview } from './useSettingsOverview';

const profile = (over = {}) => ({
    id: 'c1', companyName: 'Artificial Co', contact: { phone: '5550000001', email: 'hello@example.test' }, ...over,
});

beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    fake.docs = {
        'companies/c1/integrations/sms_provider': { isActive: true, inventory: [{ phoneNumber: '+15550000001' }, { phoneNumber: '+15550000002' }] },
        'companies/c1/settings/automated_sms': { templateContactAttempt1: 'Hi {firstName}' },
    };
    fake.callables = {
        listCompanyTeam: { members: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] },
        listCompanyApiKeys: { keys: [{ keyId: 'k1', revokedAt: null }, { keyId: 'k2', revokedAt: '2026-10-01' }], maxActiveKeys: 5 },
    };
});

describe('useSettingsOverview', () => {
    it('reads where every section stands', async () => {
        const { result } = renderHook(() => useSettingsOverview(profile({ planType: 'paid' })));
        await waitFor(() => expect(Object.keys(result.current)).toHaveLength(6));
        expect(result.current).toEqual({
            company: { label: 'Complete', tone: 'success' },
            billing: { label: 'Pro plan', tone: 'success' },
            team: { label: '3 people', tone: 'neutral' },
            api_keys: { label: '1 key on', tone: 'neutral' },
            sms: { label: '2 lines', tone: 'success' },
            automated_sms: { label: 'Set up', tone: 'success' },
        });
    });

    it('says what is missing', async () => {
        fake.docs = {};
        fake.callables.listCompanyTeam = { members: [{ id: 'a' }] };
        fake.callables.listCompanyApiKeys = { keys: [] };
        const { result } = renderHook(() => useSettingsOverview(profile({ contact: { phone: '', email: '' } })));
        await waitFor(() => expect(Object.keys(result.current)).toHaveLength(6));
        expect(result.current).toMatchObject({
            company: { label: 'Incomplete', tone: 'warning' },
            billing: { label: 'Free plan', tone: 'neutral' },
            team: { label: '1 person' },
            api_keys: { label: '0 keys on' },
            sms: { label: 'Not set up', tone: 'warning' },
            automated_sms: { label: 'No messages', tone: 'neutral' },
        });
    });

    it('calls a profile incomplete when Company profile would show no Company Name', () => {
        const { result } = renderHook(() => useSettingsOverview(profile({ companyName: '', name: 'Legacy Co' })));
        expect(result.current.company).toEqual({ label: 'Incomplete', tone: 'warning' });
    });

    it('leaves a section without a badge when its read fails', async () => {
        fake.callables.listCompanyTeam = new Error('permission-denied');
        fake.docs['companies/c1/integrations/sms_provider'] = new Error('offline');
        const { result } = renderHook(() => useSettingsOverview(profile()));
        await waitFor(() => expect(result.current.automated_sms).toBeDefined());
        await waitFor(() => expect(result.current.api_keys).toBeDefined());
        expect(result.current.team).toBeUndefined();
        expect(result.current.sms).toBeUndefined();
    });

    it('reads nothing without a company', () => {
        const { result } = renderHook(() => useSettingsOverview(null));
        expect(result.current).toEqual({
            company: { label: 'Incomplete', tone: 'warning' },
            billing: { label: 'Free plan', tone: 'neutral' },
        });
    });
});
