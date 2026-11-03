import React from 'react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { Skeleton } from './Skeleton';

describe('Skeleton', () => {
    it('is always hidden from assistive technology', () => {
        const { container } = render(<Skeleton />);
        expect(container.firstChild).toHaveAttribute('aria-hidden', 'true');
    });

    /* The caller announces; a placeholder that could be un-hidden would be read as content. */
    it('cannot be un-hidden by a caller', () => {
        const { container } = render(<Skeleton aria-hidden="false" />);
        expect(container.firstChild).toHaveAttribute('aria-hidden', 'true');
    });

    it('defaults to a full-width line', () => {
        const { container } = render(<Skeleton />);
        expect(container.firstChild).toHaveAttribute('data-shape', 'line');
        expect(container.firstChild).toHaveAttribute('data-width', 'full');
        expect(container.firstChild).not.toHaveAttribute('data-height');
    });

    it.each(['half', 'three-quarters', 'full'])('draws a line at the %s width', (width) => {
        const { container } = render(<Skeleton width={width} />);
        expect(container.firstChild).toHaveAttribute('data-width', width);
    });

    it('draws a block at its one height', () => {
        const { container } = render(<Skeleton shape="block" height="lg" />);
        expect(container.firstChild).toHaveAttribute('data-shape', 'block');
        expect(container.firstChild).toHaveAttribute('data-height', 'lg');
    });

    it('refuses a shape or a width it has no rule for', () => {
        expect(() => render(<Skeleton shape="circle" />)).toThrow(TypeError);
        expect(() => render(<Skeleton shape="circle" />)).toThrow(/Unsupported Skeleton shape: circle/);
        expect(() => render(<Skeleton width="wide" />)).toThrow(TypeError);
        expect(() => render(<Skeleton width="wide" />)).toThrow(/Unsupported Skeleton width: wide/);
    });

    it('refuses a block without a height it supports', () => {
        expect(() => render(<Skeleton shape="block" />)).toThrow(TypeError);
        expect(() => render(<Skeleton shape="block" height="xl" />)).toThrow(/Skeleton block needs a supported height/);
    });

    /* A line sits inside the text it replaces, so that text's line box sets its height. */
    it('refuses a height on a line', () => {
        expect(() => render(<Skeleton height="lg" />)).toThrow(TypeError);
        expect(() => render(<Skeleton height="lg" />)).toThrow(/Skeleton line takes the height of its text/);
    });

    it('keeps caller class names', () => {
        const { container } = render(<Skeleton className="mt-ds-2" />);
        expect(container.firstChild).toHaveClass('ds-skeleton', 'mt-ds-2');
    });

    it('has no axe violations beside the sentence that announces it', async () => {
        const { container } = render(
            <div>
                <p role="status">Loading the summary.</p>
                <p><Skeleton width="half" /></p>
                <Skeleton shape="block" height="lg" />
            </div>,
        );
        expect((await axe(container)).violations).toEqual([]);
        expect(screen.getByRole('status')).toHaveTextContent('Loading the summary.');
    });
});

describe('Skeleton CSS', () => {
    /* Comments stripped first, so the prose cannot satisfy a check (as `Avatar.test.jsx` does). */
    const css = readFileSync(path.join(__dirname, 'Skeleton.css'), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '');

    it('stops pulsing under reduced motion', () => {
        const media = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
        expect(media).toMatch(/\.ds-skeleton\s*\{\s*animation:\s*none;/);
    });

    it('sizes every width and the block height it accepts', () => {
        for (const width of ['half', 'three-quarters', 'full']) {
            expect(css).toContain(`.ds-skeleton[data-width='${width}']`);
        }
        expect(css).toContain(".ds-skeleton[data-shape='block'][data-height='lg']");
    });
});
