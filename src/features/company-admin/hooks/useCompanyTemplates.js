/**
 * The Documents workspace's templates, live: `companies/{id}/templates`, newest
 * change first. `isE2EEdocMock` (E2E test mode's `?e2eEdoc=mock`) serves one
 * fixture template and reads nothing. Moved verbatim from `DocumentsManager`.
 */
import { useEffect, useState } from 'react';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db } from '@lib/firebase';

export function useCompanyTemplates({ companyId, isE2EEdocMock }) {
    const [templates, setTemplates] = useState([]);
    const [templatesLoading, setTemplatesLoading] = useState(true);

    useEffect(() => {
        if (!companyId) return;
        if (isE2EEdocMock) {
            setTemplates([
                {
                    id: 'tpl_e2e_mock',
                    title: 'E2E Test Document',
                    storagePath: 'secure_documents/e2e/mock.pdf',
                    fields: [
                        { id: 'full_name', label: 'Full Name', type: 'text', required: true, defaultValue: '' },
                        { id: 'sig1', label: 'Signature', type: 'signature', required: true, defaultValue: '' },
                    ],
                },
            ]);
            setTemplatesLoading(false);
            return () => {};
        }
        const q = query(collection(db, 'companies', companyId, 'templates'), orderBy('updatedAt', 'desc'));
        return onSnapshot(q, (snap) => {
            setTemplates(snap.docs.map(d => ({ id: d.id, ...d.data() })));
            setTemplatesLoading(false);
        }, (err) => {
            console.error('[DocumentsManager] templates snapshot', err);
            setTemplatesLoading(false);
        });
    }, [companyId, isE2EEdocMock]);

    return { templates, templatesLoading };
}

export default useCompanyTemplates;
