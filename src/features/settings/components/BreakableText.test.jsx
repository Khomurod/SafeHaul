import React from 'react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { BreakableText } from './BreakableText';
import { splitAfterDots } from '../utils/splitAfterDots';

// Artificial addresses and names.
const SAMPLES = ['john.doe@', 'a..b@', 'a.@', '.a@', 'abc@', 'a.b.c', 'a.', '', 'first.middle.last.name@'];

describe('splitAfterDots', () => {
    it('cuts after each dot exactly as the look-behind it replaces did', () => {
        // Built at run time, so this file carries no look-behind either.
        const lookBehind = new RegExp('(?<=\\.)');
        for (const sample of SAMPLES) {
            expect(splitAfterDots(sample), sample).toEqual(sample.split(lookBehind));
        }
    });
});

describe('BreakableText', () => {
    it('lets an email break after its "@" and its dots, never inside the domain', () => {
        const { container } = render(<BreakableText email text="jean-baptiste.okonkwo@example-mail.com" />);
        expect(container.textContent).toBe('jean-baptiste.okonkwo@example-mail.com');
        expect(container.querySelectorAll('wbr')).toHaveLength(2);
        expect([...container.querySelectorAll('.whitespace-nowrap')].map((node) => node.textContent))
            .toEqual(['jean-baptiste.', 'example-mail.com']);
    });

    it('keeps a hyphenated name part whole and breaks only at spaces', () => {
        const { container } = render(<BreakableText text="Maria Delacroix-Whitfield" />);
        expect(container.textContent).toBe('Maria Delacroix-Whitfield');
        expect(container.querySelector('.whitespace-nowrap').textContent).toBe('Delacroix-Whitfield');
    });

    it('carries no regular-expression look-behind, which older Safari cannot read', () => {
        for (const file of ['BreakableText.jsx', '../utils/splitAfterDots.js']) {
            const source = readFileSync(path.join(__dirname, file), 'utf8')
                .split('\n').filter((line) => !line.trim().startsWith('*')).join('\n');
            expect(source, file).not.toMatch(/\(\?<[=!]/);
        }
    });
});
