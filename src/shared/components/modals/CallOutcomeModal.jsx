import React from 'react';
import { CallOutcomeModalUI } from './CallOutcomeModalUI';
import { useCallOutcome } from '@shared/hooks/useCallOutcome';

export function CallOutcomeModal({ lead, companyId, onClose, onUpdate }) {
    const hookProps = useCallOutcome(lead, companyId, onUpdate, onClose);

    return (
        <CallOutcomeModalUI 
            lead={lead} 
            onClose={onClose}
            {...hookProps}
        />
    );
}
