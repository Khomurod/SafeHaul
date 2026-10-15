/**
 * What the carrier's editor offers, field by field, in the driver's vocabulary.
 *
 * Never a text box where the driver's wizard reads something else: "Upload
 * Medical Card" as text reads "[object Object]", a Social Security Number box's
 * contents are silently discarded by the server, and a free-text state, licence
 * state, endorsements or "known by other name" lets a carrier's "TX" reach the
 * driver's state picker, which lists names, as "Alabama" while the application
 * goes on holding "TX".
 */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ApplicationPrepEditor from './ApplicationPrepEditor';

// The documents panel is the upload control and is covered on its own; here it
// only has to be present, not to sign previews.
vi.mock('./ApplicationDocumentsPanel', () => ({
    default: () => <section aria-label="Documents you already have" />,
}));

function renderEditor(formData = {}) {
    const updateField = vi.fn();
    render(
        <ApplicationPrepEditor
            companyId="co-1"
            formData={formData}
            updateField={updateField}
            updateList={vi.fn()}
            lockedEmployers={[]}
            onLockEmployers={vi.fn()}
            onUnlockEmployer={vi.fn()}
            onUpload={vi.fn()}
            onFileChange={vi.fn()}
        />,
    );
    return { updateField };
}

describe('ApplicationPrepEditor', () => {
    it('does not ask the carrier for the driver\'s Social Security Number', () => {
        renderEditor();
        expect(screen.queryByLabelText(/Social Security/i)).toBeNull();
        expect(document.getElementById('ssn-edit')).toBeNull();
    });

    it('leaves the medical card to the documents panel, with no text-box copy of it', () => {
        renderEditor({ 'medical-card-upload': { name: 'medcard.pdf', storagePath: 'companies/co-1/applications/guest_uploads/m.pdf' } });
        expect(document.getElementById('medical-card-upload-edit')).toBeNull();
        expect(screen.queryByDisplayValue('[object Object]')).toBeNull();
        // Its expiration date is still the carrier's to fill in.
        expect(screen.getByLabelText('Medical Card Expiration')).toBeInTheDocument();
    });

    it('picks the address state and the licence state from the wizard\'s own list', () => {
        const { updateField } = renderEditor();
        const state = screen.getByLabelText('State');
        const licenceState = screen.getByLabelText('License State');
        expect(state.tagName).toBe('SELECT');
        expect(licenceState.tagName).toBe('SELECT');
        fireEvent.change(licenceState, { target: { value: 'Texas' } });
        expect(updateField).toHaveBeenCalledWith('cdlState', 'Texas');
    });

    it('records endorsements as the codes the wizard reads', () => {
        const { updateField } = renderEditor({ endorsements: '' });
        fireEvent.click(screen.getByLabelText('Hazmat (H)'));
        expect(updateField).toHaveBeenCalledWith('endorsements', 'H');
    });
});
