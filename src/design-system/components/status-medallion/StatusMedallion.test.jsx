import React from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { StatusMedallion } from './StatusMedallion';

describe('StatusMedallion', () => {
    it('renders its icon inside a toned disc', () => {
        const { container } = render(<StatusMedallion tone="success"><svg /></StatusMedallion>);
        const medallion = container.querySelector('.ds-status-medallion');
        expect(medallion).toHaveAttribute('data-tone', 'success');
        expect(medallion).toHaveAttribute('data-size', 'md');
        expect(medallion.querySelector('svg')).toBeInTheDocument();
    });

    it('is always decorative, because the adjacent heading carries the meaning', () => {
        const { container } = render(<StatusMedallion><svg /></StatusMedallion>);
        expect(container.querySelector('.ds-status-medallion')).toHaveAttribute('aria-hidden', 'true');
    });

    it('defaults to the neutral tone', () => {
        const { container } = render(<StatusMedallion><svg /></StatusMedallion>);
        expect(container.querySelector('.ds-status-medallion')).toHaveAttribute('data-tone', 'neutral');
    });

    it('supports the large size', () => {
        const { container } = render(<StatusMedallion size="lg"><svg /></StatusMedallion>);
        expect(container.querySelector('.ds-status-medallion')).toHaveAttribute('data-size', 'lg');
    });

    it('accepts extra layout classes from the consumer', () => {
        const { container } = render(<StatusMedallion className="mx-auto mb-ds-4"><svg /></StatusMedallion>);
        expect(container.querySelector('.ds-status-medallion').className).toContain('mx-auto');
    });

    it('rejects an unsupported tone or size rather than rendering silently', () => {
        expect(() => render(<StatusMedallion tone="brand"><svg /></StatusMedallion>)).toThrow(/Unsupported StatusMedallion tone/);
        expect(() => render(<StatusMedallion size="xl"><svg /></StatusMedallion>)).toThrow(/Unsupported StatusMedallion size/);
    });
});
