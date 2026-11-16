/**
 * `BulkUploadSteps`: where a bulk upload is, read and not operated.
 * All data is artificial.
 */
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { describe, expect, it } from 'vitest';

import { BulkUploadSteps } from './BulkUploadSteps';

const items = () => within(screen.getByRole('list', { name: 'Import steps' })).getAllByRole('listitem');

describe('BulkUploadSteps', () => {
    it('lists the three frozen steps in order', () => {
        render(<BulkUploadSteps step="upload" />);
        expect(items().map((item) => item.textContent.replace(/\s+(current step|completed|not started)$/, '')))
            .toEqual(['1Upload', '2Preview', '3Finish']);
    });

    it.each([
        ['upload', ['step', null, null], ['current step', 'not started', 'not started']],
        ['preview', [null, 'step', null], ['completed', 'current step', 'not started']],
        ['success', [null, null, 'step'], ['completed', 'completed', 'current step']],
    ])('marks where the upload is at %s, in words as well as colour', (step, current, words) => {
        render(<BulkUploadSteps step={step} />);
        expect(items().map((item) => item.getAttribute('aria-current'))).toEqual(current);
        items().forEach((item, index) => expect(item).toHaveTextContent(words[index]));
    });

    it('is a list, not a control: nothing in it can be focused or pressed', () => {
        const { container } = render(<BulkUploadSteps step="preview" />);
        expect(container.querySelectorAll('button, a, [tabindex]')).toHaveLength(0);
    });

    it('takes the layout class its place needs', () => {
        render(<BulkUploadSteps step="upload" className="w-full" />);
        expect(screen.getByRole('list', { name: 'Import steps' })).toHaveClass('w-full');
    });

    it('has no axe violations', async () => {
        const { container } = render(<BulkUploadSteps step="preview" />);
        expect((await axe(container)).violations).toEqual([]);
    });
});
