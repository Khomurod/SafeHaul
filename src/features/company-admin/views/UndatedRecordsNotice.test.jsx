import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { UndatedRecordsNotice } from './UndatedRecordsNotice';

describe('UndatedRecordsNotice', () => {
    it('says nothing while every record has an added date', () => {
        const { container } = render(<UndatedRecordsNotice count={0} />);
        expect(container).toBeEmptyDOMElement();
    });

    it('says how many records the date-sorted list cannot show, and that search finds them', () => {
        render(<UndatedRecordsNotice count={1240} />);
        expect(screen.getByText(
            '1,240 records have no added date, so this list, which is sorted by that date, cannot show them. Search by name, phone or email to find one.',
        )).toBeInTheDocument();
    });

    it('speaks of one record in the singular', () => {
        render(<UndatedRecordsNotice count={1} />);
        expect(screen.getByText(/^1 record has no added date, .* cannot show it\. Search by name, phone or email to find it\.$/))
            .toBeInTheDocument();
    });
});
