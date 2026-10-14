/**
 * The release confirmation states the versions and the checks in words.
 *
 * The status rows ("Checks", "Testing") were drawn as version lines with no
 * version, so each read "unknown Passed" or "unknown Healthy", and a Production
 * with no recorded release read "unknown (not recorded)".
 *
 * The hashes below are synthetic.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ReleaseConfirmDialog } from './ReleaseConfirmDialog';

const TESTING = { sha: 'aaaaaaa1111111', checksPassed: true, backendReleased: true };
const PRODUCTION = { sha: 'bbbbbbb2222222' };
const PREVIOUS = { sha: 'ccccccc3333333' };

function renderDialog(props) {
    return render(
        <ReleaseConfirmDialog
            kind="release"
            testing={TESTING}
            production={PRODUCTION}
            previousProduction={PREVIOUS}
            loading={false}
            error=""
            onConfirm={vi.fn()}
            onCancel={vi.fn()}
            {...props}
        />,
    );
}

/** The text a labelled line shows beside its label. */
const lineValue = (label) => screen.getByText(label).nextElementSibling.textContent;

describe('ReleaseConfirmDialog', () => {
    it('states the version, what it replaces, and the checks, with no "unknown"', () => {
        renderDialog();
        expect(lineValue('Releasing version')).toBe('aaaaaaa');
        expect(lineValue('Production currently')).toBe('bbbbbbb');
        expect(lineValue('Checks')).toBe('Passed');
        expect(lineValue('Testing')).toBe('Healthy');
        expect(screen.queryByText(/unknown/i)).not.toBeInTheDocument();
    });

    it('says when the checks did not pass and Testing is incomplete', () => {
        renderDialog({ testing: { ...TESTING, checksPassed: false, backendReleased: false } });
        expect(lineValue('Checks')).toBe('Not passed');
        expect(lineValue('Testing')).toBe('Incomplete');
    });

    it('says "Not recorded" for a Production with no recorded release', () => {
        renderDialog({ production: null });
        expect(lineValue('Production currently')).toBe('Not recorded');
        expect(screen.queryByText(/unknown/i)).not.toBeInTheDocument();
    });

    it('names the version a rollback returns to, and shows no checks', () => {
        renderDialog({ kind: 'rollback' });
        expect(lineValue('Rolling back to')).toBe('ccccccc');
        expect(lineValue('Production currently')).toBe('bbbbbbb');
        expect(screen.queryByText('Checks')).not.toBeInTheDocument();
    });
});
