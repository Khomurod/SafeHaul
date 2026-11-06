import { useCallback, useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@lib/firebase';
import { contactAttemptTextFor, stagesWithTemplate } from './contactAttemptText';

/**
 * Whether choosing a Contact Attempt stage in the dossier texts the driver
 * (`contactAttemptText.js`): `outlookFor(stage)` is `'texts'`, `'may'` or `null`.
 *
 * The company's templates are read once per company from
 * `companies/{id}/settings/automated_sms`, which any team member may read, and
 * only while the picker is offered (`enabled`). Until they arrive, or when they
 * cannot be read, the answer is `'may'`: the dossier never says no text goes
 * when it does not know.
 */
export function useContactAttemptTexts({ companyId, enabled, currentStatus, record, isLead }) {
    // `{ companyId, stages }` once read; `stages` is null when the read failed.
    const [read, setRead] = useState(null);

    useEffect(() => {
        if (!enabled || !companyId) return undefined;
        let current = true;
        getDoc(doc(db, 'companies', companyId, 'settings', 'automated_sms'))
            .then((snap) => {
                if (current) setRead({ companyId, stages: stagesWithTemplate(snap.exists() ? snap.data() : {}) });
            })
            .catch((error) => {
                console.error('[useContactAttemptTexts] Could not read the automated text templates:', error);
                if (current) setRead({ companyId, stages: null });
            });
        return () => { current = false; };
    }, [companyId, enabled]);

    // A read for another company is no answer for this one.
    const templates = read?.companyId === companyId ? read.stages : null;

    return useCallback(
        (stage) => contactAttemptTextFor(stage, { currentStatus, templates, record, isLead }),
        [currentStatus, templates, record, isLead],
    );
}
