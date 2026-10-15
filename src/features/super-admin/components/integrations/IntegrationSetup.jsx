import React, { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@lib/firebase';
import { Icon, ArrowLeft } from '@design-system/icons';
import { Button } from '@/design-system/components';
import { ErrorState, LoadingState, PageState } from '@design-system/patterns';
import { IntegrationManager } from './IntegrationManager';

/**
 * A company's SMS setup, opened from the list or from its address
 * (`/super-admin/integrations/<id>`, after a reload or from a shared link).
 *
 * The form saves under `companies/<id>`, and `saveIntegrationConfig` does not
 * check that the company exists, so a company named only by the address is read
 * first: a deleted or mistyped id gets a notice and the way back, never the
 * form. A company picked from the list is known to exist and opens at once.
 */
export function IntegrationSetup({ companyId, pickedCompany, onBack }) {
    const picked = pickedCompany?.id === companyId ? pickedCompany : null;
    const [lookup, setLookup] = useState(null);
    const [attempt, setAttempt] = useState(0);

    useEffect(() => {
        if (picked || !companyId) return undefined;
        let current = true;
        setLookup(null);
        // Inside the promise chain, so an id Firestore refuses is a failed read too.
        Promise.resolve()
            .then(() => getDoc(doc(db, 'companies', companyId)))
            .then((snapshot) => {
                if (!current) return;
                setLookup(snapshot.exists()
                    ? { companyId, found: true, companyName: snapshot.data().companyName }
                    : { companyId, found: false });
            }, (error) => {
                console.error('Error reading the company for its SMS setup:', error);
                if (current) setLookup({ companyId, failed: true });
            });
        return () => { current = false; };
    }, [companyId, picked, attempt]);

    if (picked) {
        return <IntegrationManager companyId={companyId} companyName={picked.companyName} onBack={onBack} />;
    }
    const back = (
        <Button variant="secondary" onClick={onBack}>
            <Icon icon={ArrowLeft} /> Back to List
        </Button>
    );
    if (lookup?.companyId !== companyId) {
        return <LoadingState title="Loading the company" />;
    }
    if (lookup.failed) {
        return (
            <ErrorState
                title="Could not load this company"
                description="Check the connection and try again."
                actions={(
                    <>
                        <Button onClick={() => setAttempt((count) => count + 1)}>Try again</Button>
                        {back}
                    </>
                )}
            />
        );
    }
    if (!lookup.found) {
        return (
            <PageState
                tone="warning"
                title="Company not found"
                description={`No company has the ID “${companyId}”. It may have been deleted, or the link may be mistyped.`}
                actions={back}
            />
        );
    }
    return <IntegrationManager companyId={companyId} companyName={lookup.companyName} onBack={onBack} />;
}
