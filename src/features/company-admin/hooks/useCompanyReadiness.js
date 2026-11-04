/**
 * What the dashboard's "Company setup" card needs, read once when it opens and
 * never live (`companyReadiness.js` decides what each read means):
 *
 * - `getEmailSettingsMeta`, the company email's settings without its password
 *   (admin-strict, which is why the card is for admins only);
 * - `companies/{id}/integrations/sms_provider` (admin-readable);
 * - `companies/{id}`, read fresh: a save elsewhere in this session may not have
 *   reached the profile the app holds;
 * - the template of each enabled post-application form, one document each.
 *
 * Each read settles on its own, so one that fails is "not checked" and the rest
 * still show. `enabled` false reads nothing. E2E test mode never reads: it
 * shows a company with everything set up.
 */
import { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '@lib/firebase';
import { isE2ETestMode } from '@lib/runtime/e2eMode';
import { normalizePostApplicationTemplates } from '@features/driver-app/components/application/publicApplyHelpers';
import { companyReadiness } from '../utils/companyReadiness';

const READY = Object.freeze({ items: [], hints: [] });

async function settle(label, read) {
    try {
        return { status: 'ok', value: await read() };
    } catch (error) {
        // The read's name only: a message could carry configuration details.
        console.warn(`[useCompanyReadiness] Could not read ${label}:`, error?.code || 'error');
        return { status: 'failed' };
    }
}

const dataOf = (snap, missing) => (snap.exists() ? snap.data() : missing);

async function readFormTemplates(companyId, company) {
    if (company.status !== 'ok' || company.value?.features?.eDocs === false) return { status: 'ok', value: {} };
    const forms = normalizePostApplicationTemplates(company.value?.postApplicationTemplates);
    return settle('the forms\' templates', async () => Object.fromEntries(await Promise.all(forms.map(async (form) => [
        form.templateId,
        dataOf(await getDoc(doc(db, 'companies', companyId, 'templates', form.templateId)), null),
    ]))));
}

async function readReadiness(companyId) {
    const [email, sms, company] = await Promise.all([
        settle('the email settings', async () => {
            const { data } = await httpsCallable(functions, 'getEmailSettingsMeta')({ companyId });
            return data?.settings || {};
        }),
        settle('the texting set-up', async () => dataOf(await getDoc(doc(db, 'companies', companyId, 'integrations', 'sms_provider')), null)),
        settle('the company', async () => dataOf(await getDoc(doc(db, 'companies', companyId)), {})),
    ]);
    const formTemplates = await readFormTemplates(companyId, company);
    return companyReadiness({ email, sms, company, formTemplates });
}

/** `{ isLoading, readiness }`: `readiness` is `{ items, hints }` once read, else null. */
export function useCompanyReadiness({ companyId, enabled }) {
    const active = Boolean(enabled && companyId);
    const [state, setState] = useState({ key: null, readiness: null });
    const key = active ? companyId : null;

    useEffect(() => {
        if (!key || isE2ETestMode) return undefined;
        let current = true;
        readReadiness(key).then((readiness) => {
            if (current) setState({ key, readiness });
        });
        return () => { current = false; };
    }, [key]);

    if (!active) return { isLoading: false, readiness: null };
    if (isE2ETestMode) return { isLoading: false, readiness: READY };
    const readiness = state.key === key ? state.readiness : null;
    return { isLoading: readiness === null, readiness };
}

export default useCompanyReadiness;
