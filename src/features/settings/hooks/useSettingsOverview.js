import { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '@lib/firebase';
import { companyDetailsOf } from '@features/companies/services/companyDetails';
import { listApiKeys } from '../components/api-keys/apiKeysService';

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const AUTOMATED_FIELDS = ['templateContactAttempt1', 'templateContactAttempt2', 'templateContactAttempt3'];

/** What the company profile itself says, with no request. */
function profileStatuses(profile) {
    const details = companyDetailsOf(profile);
    // The fields Company profile shows: its Company Name is `companyName` alone.
    const complete = !!profile?.companyName && !!details.phone && !!details.email;
    return {
        company: complete ? { label: 'Complete', tone: 'success' } : { label: 'Incomplete', tone: 'warning' },
        application: { label: plural((profile?.customQuestions || []).length, 'custom question', 'custom questions'), tone: 'neutral' },
        billing: profile?.planType === 'paid' ? { label: 'Pro plan', tone: 'success' } : { label: 'Free plan', tone: 'neutral' },
    };
}

/** The sections whose state needs a read, each settled on its own. */
const REMOTE = {
    team: async (companyId) => {
        const { data } = await httpsCallable(functions, 'listCompanyTeam')({ companyId });
        const count = (data?.members || []).length;
        return { label: plural(count, 'person', 'people'), tone: 'neutral' };
    },
    api_keys: async (companyId) => {
        const { keys } = await listApiKeys(companyId);
        const on = keys.filter((key) => !key.revokedAt).length;
        return { label: plural(on, 'key on', 'keys on'), tone: 'neutral' };
    },
    sms: async (companyId) => {
        const snap = await getDoc(doc(db, 'companies', companyId, 'integrations', 'sms_provider'));
        const data = snap.exists() ? snap.data() : null;
        const lines = data?.inventory?.length || 0;
        return data?.isActive && lines > 0
            ? { label: plural(lines, 'line', 'lines'), tone: 'success' }
            : { label: 'Not set up', tone: 'warning' };
    },
    automated_sms: async (companyId) => {
        const snap = await getDoc(doc(db, 'companies', companyId, 'settings', 'automated_sms'));
        const data = snap.exists() ? snap.data() : {};
        return AUTOMATED_FIELDS.some((field) => String(data[field] || '').trim())
            ? { label: 'Set up', tone: 'success' }
            : { label: 'No messages', tone: 'neutral' };
    },
};

/**
 * Where each Settings section stands, for the badges on Overview:
 * `{ [sectionId]: { label, tone } }`. Company profile, Application form and
 * Plan come from the profile; Team, API keys, SMS and Automated texts from one
 * read each, made when Overview opens. A read that fails leaves its section without a badge:
 * Overview never guesses.
 */
export function useSettingsOverview(profile) {
    const companyId = profile?.id;
    const [remote, setRemote] = useState({});

    useEffect(() => {
        if (!companyId) return undefined;
        let cancelled = false;
        setRemote({});
        Object.entries(REMOTE).forEach(([section, read]) => {
            read(companyId).then(
                (status) => { if (!cancelled) setRemote((prev) => ({ ...prev, [section]: status })); },
                (error) => console.warn(`[Settings overview] ${section} status unavailable:`, error?.message || error),
            );
        });
        return () => { cancelled = true; };
    }, [companyId]);

    return { ...profileStatuses(profile), ...remote };
}
