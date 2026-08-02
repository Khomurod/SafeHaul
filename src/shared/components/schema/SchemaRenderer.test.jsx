import React from 'react';
import { render, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { SchemaField } from './SchemaRenderer';

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
