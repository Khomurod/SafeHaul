import React from 'react';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SchemaField, SchemaSection } from './SchemaRenderer';

afterEach(cleanup);

const fileValue = { name: 'image.jpg', url: 'https://expired.example/old?token=dead', storagePath: 'companies/co1/applications/guest_uploads/x.jpg' };

describe('SchemaRenderer file display (CDL re-signed URL)', () => {
    it('uses the freshly re-signed fileUrls href, not the expired persisted value.url', () => {
        const { getByRole } = render(
            <SchemaField
                fieldKey="cdl-front"
                mode="display"
                data={{ 'cdl-front': fileValue }}
                fileUrls={{ 'cdl-front': 'https://signed.example/fresh?token=good' }}
            />,
        );
        const link = getByRole('link', { name: /image\.jpg/i });
        expect(link).toHaveAttribute('href', 'https://signed.example/fresh?token=good');
    });

    it('falls back to the persisted url when no re-signed url is available', () => {
        const { getByRole } = render(
            <SchemaField
                fieldKey="cdl-front"
                mode="display"
                data={{ 'cdl-front': fileValue }}
                fileUrls={{}}
            />,
        );
        expect(getByRole('link', { name: /image\.jpg/i }))
            .toHaveAttribute('href', 'https://expired.example/old?token=dead');
    });
});

describe('SchemaRenderer signature display', () => {
    it('renders a data-URL signature as an image, not raw base64 text', () => {
        const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
        const { getByRole, queryByText } = render(
            <SchemaField fieldKey="signature" mode="display" data={{ signature: dataUrl }} />,
        );
        expect(getByRole('img')).toHaveAttribute('src', dataUrl);
        expect(queryByText(/iVBORw0KGgo/)).toBeNull();
    });
});

describe('SchemaRenderer radio options ({label, value} objects)', () => {
    // 'sms-consent' uses YES_NO_OPTIONS = [{label:'Yes',value:'yes'}, {label:'No',value:'no'}].
    // Rendering the object directly used to throw React error #31 and crash the edit form.
    it('renders object-shaped radio options as labels in input mode without crashing', () => {
        const { getByText, getByDisplayValue } = render(
            <SchemaField fieldKey="sms-consent" mode="input" data={{ 'sms-consent': 'yes' }} onChange={() => {}} />,
        );
        expect(getByText('Yes')).toBeInTheDocument();
        expect(getByText('No')).toBeInTheDocument();
        // The radio value must be the option's primitive value, and reflect the current data.
        const checked = getByDisplayValue('yes');
        expect(checked).toBeChecked();
    });

    it('renders object-shaped radio options in display edit mode without crashing', () => {
        const { getByText, getByDisplayValue } = render(
            <SchemaField fieldKey="sms-consent" mode="display" isEditing data={{ 'sms-consent': 'no' }} onChange={() => {}} />,
        );
        expect(getByText('Yes')).toBeInTheDocument();
        expect(getByText('No')).toBeInTheDocument();
        expect(getByDisplayValue('no')).toBeChecked();
    });
});

describe('SchemaSection lockedKeys', () => {
    const data = { firstName: 'Dana', email: 'dana@example.test' };

    it('edits a field by default, but renders a locked key read-only', () => {
        // Editing: the email is an input the recruiter can change.
        const { getByDisplayValue, rerender, queryByDisplayValue, getByText } = render(
            <SchemaSection sectionId="personalInfo" data={data} isEditing onChange={() => {}} />,
        );
        expect(getByDisplayValue('dana@example.test')).toBeInTheDocument();

        // Locked: the value shows, but there is no input to change it — the guard
        // against re-keying a draft whose invite link is already out. First name,
        // not locked, is still editable.
        rerender(
            <SchemaSection
                sectionId="personalInfo"
                data={data}
                isEditing
                onChange={() => {}}
                lockedKeys={['email']}
            />,
        );
        expect(queryByDisplayValue('dana@example.test')).toBeNull();
        expect(getByText('dana@example.test')).toBeInTheDocument();
        expect(getByDisplayValue('Dana')).toBeInTheDocument();
    });
});

/*
 * Edit mode is used by exactly two screens — the carrier's prep editor and the
 * dossier's Edit Application — and until 2026-10-01 every type fell through to a
 * text box. These pin what each type is now, in the format the driver's wizard
 * reads, because a value the wizard cannot show is a value the driver never saw.
 */
describe('SchemaField edit mode speaks the wizard\'s vocabulary', () => {
    const edit = (fieldKey, data, onChange = () => {}) => render(
        <SchemaField fieldKey={fieldKey} mode="display" isEditing data={data} onChange={onChange} />,
    );

    it('edits a state with the state list, not free text', () => {
        const onChange = vi.fn();
        const { getByLabelText } = edit('state', { state: 'Texas' }, onChange);
        const select = getByLabelText('State');
        expect(select.tagName).toBe('SELECT');
        expect(select).toHaveValue('Texas');
        // The placeholder plus the 50 states the wizard's picker offers.
        expect(select.options).toHaveLength(51);
        fireEvent.change(select, { target: { value: 'Oklahoma' } });
        expect(onChange).toHaveBeenCalledWith('state', 'Oklahoma');
    });

    it('shows a stored state the list does not hold as itself', () => {
        const { getByLabelText } = edit('cdlState', { cdlState: 'TX' });
        const select = getByLabelText('License State');
        expect(select).toHaveValue('TX');
        expect(select.selectedOptions[0]).toHaveTextContent('TX');
    });

    it('edits endorsements as boxes, stored as the comma-joined codes the wizard writes', () => {
        const onChange = vi.fn();
        const { getByLabelText } = edit('endorsements', { endorsements: 'H,N' }, onChange);
        expect(getByLabelText('Hazmat (H)')).toBeChecked();
        expect(getByLabelText('Tanker (N)')).toBeChecked();
        expect(getByLabelText('Doubles/Triples (T)')).not.toBeChecked();

        fireEvent.click(getByLabelText('Doubles/Triples (T)'));
        expect(onChange).toHaveBeenLastCalledWith('endorsements', 'H,N,T');
        fireEvent.click(getByLabelText('Hazmat (H)'));
        expect(onChange).toHaveBeenLastCalledWith('endorsements', 'N');
    });

    it('keeps an endorsement it cannot name visible and checked, rather than silently', () => {
        const onChange = vi.fn();
        const { getByLabelText } = edit('endorsements', { endorsements: 'Hazmat, N' }, onChange);
        expect(getByLabelText('Hazmat')).toBeChecked();
        fireEvent.click(getByLabelText('Hazmat'));
        expect(onChange).toHaveBeenLastCalledWith('endorsements', 'N');
    });

    it('asks a yes/no checkbox question as one box, stored as yes/no', () => {
        const onChange = vi.fn();
        const { getByLabelText } = edit('known-by-other-name', { 'known-by-other-name': 'no' }, onChange);
        const box = getByLabelText('Known by other name(s)?');
        expect(box).toHaveAttribute('type', 'checkbox');
        expect(box).not.toBeChecked();
        fireEvent.click(box);
        expect(onChange).toHaveBeenLastCalledWith('known-by-other-name', 'yes');
    });

    it('never offers a document reference as text', () => {
        const upload = { name: 'medcard.pdf', storagePath: 'companies/c/applications/guest_uploads/m.pdf' };
        const { container, queryByDisplayValue } = edit('medical-card-upload', { 'medical-card-upload': upload });
        expect(container.querySelector('input')).toBeNull();
        expect(queryByDisplayValue('[object Object]')).toBeNull();
    });

    it('never offers the applicant\'s signature or certification for editing', () => {
        const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
        const data = { signature: dataUrl, 'final-certification': true, signatureDate: '2026-09-30' };
        for (const fieldKey of ['signature', 'final-certification', 'signatureDate']) {
            const { container, unmount } = edit(fieldKey, data);
            expect(container.querySelector('input, select, textarea')).toBeNull();
            unmount();
        }
    });
});
