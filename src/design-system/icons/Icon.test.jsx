import React from 'react';
import { render } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { describe, expect, it } from 'vitest';
import { AlertTriangle as RawAlertTriangle } from 'lucide-react';
import { Icon, ICON_SIZES } from './Icon';
import { GLYPH, glyph, glyphComponent, glyphEntry } from './glyph';
import { AlertTriangle, GLYPH_NAMES, Trash2, UploadCloud, CloudUpload } from './glyphs';

const svgOf = (container) => container.querySelector('svg');

describe('glyph tokens', () => {
    it('cannot be rendered as a component, and says so by name', () => {
        // The whole reason the registry hands out tokens rather than
        // re-exporting the components: `<Trash2 size={13} />` has to stop being
        // a thing that works, or moving the import path changes nothing.
        expect(() => render(<Trash2 size={13} />)).toThrow(/Trash2 is an icon token/);
    });

    it('names the contract in the failure rather than just refusing', () => {
        expect(() => render(<Trash2 />)).toThrow(/<Icon icon=\{Trash2\} size="md" \/>/);
    });

    it('does not keep a second copy of the step list', () => {
        // It did, and the copy had already drifted: `3xl` joined the scale and
        // the token's message still offered six steps. The steps are enumerated
        // in exactly one place — `ICON_SIZES` — and `Icon` is what reads it.
        expect(() => render(<Trash2 />)).not.toThrow(/xs[\s\S]*sm[\s\S]*md/);
        expect(() => render(<Icon icon={Trash2} size={9} />))
            .toThrow(new RegExp(ICON_SIZES.map((step) => `'${step}'`).join(', ')));
    });

    it('carries the name the codebase writes, not lucide’s canonical one', () => {
        // 33 of the 171 are compatibility aliases: `AlertTriangle` reports a
        // `displayName` of `TriangleAlert`. Reading the name off the component
        // would have renamed a fifth of the registry to identifiers that appear
        // nowhere in this repository.
        expect(glyphEntry(AlertTriangle).name).toBe('AlertTriangle');
        expect(glyphEntry(AlertTriangle).component.displayName).toBe('TriangleAlert');
    });

    it('is recognised across module copies', () => {
        // `Symbol.for`, not a module-local symbol: Vitest and Storybook can each
        // instantiate this graph, and a token minted in one must open in the other.
        const token = glyph(RawAlertTriangle, 'AlertTriangle');
        expect(token[Symbol.for('safehaul.design-system.glyph')]).toBeTruthy();
        expect(GLYPH).toBe(Symbol.for('safehaul.design-system.glyph'));
    });

    it('refuses to mint a nameless token', () => {
        expect(() => glyph(RawAlertTriangle, '')).toThrow(/non-empty string/);
        expect(() => glyph(RawAlertTriangle, '   ')).toThrow(/non-empty string/);
        expect(() => glyph(undefined, 'Nope')).toThrow(/no icon component/);
    });

    it('exports one token per name in GLYPH_NAMES, and nothing else', async () => {
        const registry = await import('./glyphs');
        const exported = Object.keys(registry).filter((key) => key !== 'GLYPH_NAMES');
        expect([...exported].sort()).toEqual([...GLYPH_NAMES].sort());
        for (const name of GLYPH_NAMES) {
            expect(glyphEntry(registry[name])?.name).toBe(name);
        }
    });

    it('records the one duplicated drawing rather than hiding it', () => {
        // `UploadCloud` is lucide's alias for `CloudUpload`; both names are in
        // live use. Both are exported so no call site has to be renamed to be
        // migrated — collapsing them is a Phase 7 tidy with no visual effect.
        expect(glyphEntry(UploadCloud).component).toBe(glyphEntry(CloudUpload).component);
    });
});

describe('glyphComponent', () => {
    it('opens a token', () => {
        expect(glyphComponent(Trash2)).toBe(glyphEntry(Trash2).component);
    });

    it('passes a bare component through, which is the migration hatch', () => {
        // 178 files still hand raw lucide components to design-system containers
        // as props. This branch is deleted when the backlog reaches zero.
        expect(glyphComponent(RawAlertTriangle)).toBe(RawAlertTriangle);
    });

    it('leaves an absent icon absent so callers keep their own empty branch', () => {
        expect(glyphComponent(undefined)).toBeUndefined();
        expect(glyphComponent(null)).toBeNull();
    });
});

describe('Icon', () => {
    it('renders the glyph behind the token', () => {
        const { container } = render(<Icon icon={Trash2} />);
        expect(svgOf(container)).toBeInTheDocument();
        expect(svgOf(container)).toHaveClass('ds-icon');
    });

    it('sizes by attribute, never by width/height props', () => {
        // A width attribute cannot be overridden at a breakpoint, and the
        // container-sizes-its-own-glyph rules in Button.css depend on being able to.
        const { container } = render(<Icon icon={Trash2} size="xl" />);
        expect(svgOf(container)).toHaveAttribute('data-size', 'xl');
    });

    it('defaults to md', () => {
        const { container } = render(<Icon icon={Trash2} />);
        expect(svgOf(container)).toHaveAttribute('data-size', 'md');
    });

    it.each(ICON_SIZES)('accepts the %s step', (size) => {
        const { container } = render(<Icon icon={Trash2} size={size} />);
        expect(svgOf(container)).toHaveAttribute('data-size', size);
    });

    it('refuses a pixel number, which is what it exists to replace', () => {
        expect(() => render(<Icon icon={Trash2} size={18} />)).toThrow(/unsupported size 18/);
        expect(() => render(<Icon icon={Trash2} size="huge" />)).toThrow(/unsupported size/);
    });

    it('names the glyph in a size failure so the call site is findable', () => {
        expect(() => render(<Icon icon={Trash2} size={18} />)).toThrow(/for Trash2/);
    });

    it('refuses a missing icon', () => {
        expect(() => render(<Icon />)).toThrow(/must be a glyph/);
        expect(() => render(<Icon icon="Trash2" />)).toThrow(/must be a glyph/);
    });

    it('hides a decorative glyph from assistive technology', () => {
        const { container } = render(<Icon icon={Trash2} />);
        expect(svgOf(container)).toHaveAttribute('aria-hidden', 'true');
        expect(svgOf(container)).not.toHaveAttribute('role');
        expect(svgOf(container)).toHaveAttribute('focusable', 'false');
    });

    it('names a meaningful glyph as an image', () => {
        const { container } = render(<Icon icon={Trash2} label="Delete" />);
        expect(svgOf(container)).toHaveAttribute('role', 'img');
        expect(svgOf(container)).toHaveAttribute('aria-label', 'Delete');
        expect(svgOf(container)).not.toHaveAttribute('aria-hidden');
    });

    it('refuses a blank label rather than announcing an unnamed image', () => {
        expect(() => render(<Icon icon={Trash2} label="" />)).toThrow(/non-empty string/);
        expect(() => render(<Icon icon={Trash2} label="  " />)).toThrow(/non-empty string/);
        expect(() => render(<Icon icon={Trash2} label={7} />)).toThrow(/non-empty string/);
    });

    it('keeps a caller class beside its own', () => {
        const { container } = render(<Icon icon={Trash2} className="shrink-0" />);
        expect(svgOf(container)).toHaveClass('ds-icon', 'shrink-0');
    });

    it('lets a caller override the stroke weight', () => {
        const { container } = render(<Icon icon={Trash2} strokeWidth={1.5} />);
        expect(svgOf(container)).toHaveAttribute('stroke-width', '1.5');
        const { container: plain } = render(<Icon icon={Trash2} />);
        expect(svgOf(plain)).toHaveAttribute('stroke-width', '2');
    });

    it('accepts a bare component for as long as the backlog exists', () => {
        const { container } = render(<Icon icon={RawAlertTriangle} size="sm" />);
        expect(svgOf(container)).toHaveAttribute('data-size', 'sm');
    });

    it('has no accessibility violations either way', async () => {
        const { container } = render(
            <div>
                <Icon icon={AlertTriangle} />
                <Icon icon={Trash2} label="Delete" />
            </div>,
        );
        expect((await axe(container)).violations).toEqual([]);
    });
});
