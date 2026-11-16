import React from 'react';
import { CallOutcomeModalUI } from './CallOutcomeModalUI';
import { useCallOutcome } from '@shared/hooks/useCallOutcome';

/** `collectionName`: where the record lives, when the opener knows it (`useCallOutcome`). */
export function CallOutcomeModal({ lead, companyId, onClose, onUpdate, collectionName = null }) {
    const hookProps = useCallOutcome(lead, companyId, onUpdate, onClose, collectionName);

    return (
        <CallOutcomeModalUI 
            lead={lead} 
            onClose={onClose}
            {...hookProps}
        />
    );
}
