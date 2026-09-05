import React from 'react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { Avatar } from './Avatar';

describe('Avatar', () => {
    it('renders its initial and is always hidden from assistive technology', () => {
        const { container } = render(<Avatar>MG</Avatar>);
        expect(container.firstChild).toHaveAttribute('aria-hidden', 'true');
        expect(container.firstChild).toHaveTextContent('MG');
    });

    /*
     * Five of the eight discs this replaced were NOT hidden, so a screen-reader
     * user heard a bare letter read out beside the name it was abbreviating.
     * The prop does not exist: a caller cannot un-hide one.
     */
    it('cannot be un-hidden by a caller', () => {
        const { container } = render(<Avatar aria-hidden="false">MG</Avatar>);
        expect(container.firstChild).toHaveAttribute('aria-hidden', 'true');
    });

    it('defaults to a 40px circle in the neutral tone', () => {
        const { container } = render(<Avatar>MG</Avatar>);
        expect(container.firstChild).toHaveAttribute('data-size', 'md');
        expect(container.firstChild).not.toHaveAttribute('data-shape');
        expect(container.firstChild).toHaveAttribute('data-tone', 'neutral');
    });

    it.each(['xs', 'sm', 'md', 'lg', 'xl'])('accepts the %s step', (size) => {
        const { container } = render(<Avatar size={size}>M</Avatar>);
        expect(container.firstChild).toHaveAttribute('data-size', size);
        expect(container.firstChild).not.toHaveAttribute('data-size-sm');
    });

    /*
     * Primer types its own prop `number | { narrow?, regular?, wide? }`, so a
     * responsive avatar is the reference system's documented shape rather than
     * something invented here. The dossier header is the consumer.
     */
    it('takes a responsive size and records both steps', () => {
        const { container } = render(<Avatar size={{ base: 'lg', sm: 'xl' }}>MG</Avatar>);
        expect(container.firstChild).toHaveAttribute('data-size', 'lg');
        expect(container.firstChild).toHaveAttribute('data-size-sm', 'xl');
    });

    it('refuses a responsive size that is not responsive', () => {
        expect(() => render(<Avatar size={{ base: 'lg', sm: 'lg' }}>M</Avatar>))
            .toThrow(/same at both steps/);
    });

    it('refuses an unsupported step, at either end', () => {
        expect(() => render(<Avatar size="huge">M</Avatar>))
            .toThrow(/Unsupported Avatar size: huge/);
        expect(() => render(<Avatar size={{ base: 'nope' }}>M</Avatar>))
            .toThrow(/needs a valid `base`/);
        expect(() => render(<Avatar size={{ base: 'md', sm: 'nope' }}>M</Avatar>))
            .toThrow(/Unsupported Avatar size at `sm`/);
        expect(() => render(<Avatar size={40}>M</Avatar>))
            .toThrow(/Expected a step name or \{ base, sm \}/);
    });

    /*
     * Primer states this as a rule, not a preference: a circle is a person, a
     * square is an organisation, a team or a bot.
     */
    it('cuts a square for something that is not a person', () => {
        const { container } = render(<Avatar shape="square">NS</Avatar>);
        expect(container.firstChild).toHaveAttribute('data-shape', 'square');
    });

    it('refuses a shape or tone it has no rule for', () => {
        expect(() => render(<Avatar shape="pill">M</Avatar>))
            .toThrow(/Unsupported Avatar shape: pill/);
        expect(() => render(<Avatar tone="brand">M</Avatar>))
            .toThrow(/Unsupported Avatar tone: brand/);
    });

    it('marks a bordered disc for CSS and omits the flag otherwise', () => {
        const { container, rerender } = render(<Avatar>M</Avatar>);
        expect(container.firstChild).not.toHaveAttribute('data-bordered');
        rerender(<Avatar bordered>M</Avatar>);
        expect(container.firstChild).toHaveAttribute('data-bordered', 'true');
    });

    it('keeps caller class names', () => {
        const { container } = render(<Avatar className="mr-2">M</Avatar>);
        expect(container.firstChild).toHaveClass('ds-avatar', 'mr-2');
    });

    it('has no axe violations beside the name it abbreviates', async () => {
        const { container } = render(
            <p><Avatar size="sm">MG</Avatar> Maria Garcia</p>,
        );
        expect((await axe(container)).violations).toEqual([]);
        expect(screen.getByText('Maria Garcia')).toBeInTheDocument();
    });
});

describe('Avatar CSS', () => {
    /*
     * `__dirname`, not `import.meta.url`: Vitest rewrites the latter, which this
     * repository records as a live hazard and which `Button.test.jsx` already
     * works around the same way.
     */
    /*
     * Comments stripped before any matching, for the reason `Button.test.jsx`
     * records: the prose above the media query names `data-size-sm`, so the
     * "no responsive rule outside the breakpoint" assertion fired on its own
     * explanation. A check satisfied — or refused — by its own documentation is
     * a check nobody can trust.
     */
    const css = readFileSync(path.join(__dirname, 'Avatar.css'), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '');

    it('sizes every step in both the base and the responsive block', () => {
        for (const step of ['xs', 'sm', 'md', 'lg', 'xl']) {
            expect(css).toContain(`.ds-avatar[data-size='${step}']`);
            expect(css).toContain(`.ds-avatar[data-size-sm='${step}']`);
        }
    });

    /*
     * The responsive half is only meaningful above the breakpoint the one
     * consumer already used by hand. A rule outside the media query would apply
     * at every width and silently win over the base step.
     */
    /*
     * The ring exists to be seen. `border-inverse` is slate-700 against the
     * slate-900 panel these sit on, so it reads as no ring at all — the one
     * consumer that needed one had already picked the lighter content role by
     * hand and recorded why.
     */
    it('rings an inverse avatar with a colour that reads on a dark panel', () => {
        const rule = css.slice(css.indexOf("[data-tone='inverse'][data-bordered]"));
        expect(rule.slice(0, rule.indexOf('}'))).toContain('--ds-color-content-on-inverse-muted');
    });

    it('confines the responsive steps to the 640px breakpoint', () => {
        const media = css.slice(css.indexOf('@media (min-width: 640px)'));
        const block = media.slice(0, media.indexOf('\n}\n\n'));
        for (const step of ['xs', 'sm', 'md', 'lg', 'xl']) {
            expect(block).toContain(`data-size-sm='${step}'`);
        }
        expect(css.slice(0, css.indexOf('@media'))).not.toContain('data-size-sm');
    });
});
