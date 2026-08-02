import React from 'react';
import { render, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';
import InputField from '@shared/components/form/InputField';
import { Modal } from '@shared/components/modals/Modal';

afterEach(cleanup);

// happy-dom can't compute layout, so layout-dependent rules (color-contrast) are
// disabled here — those are covered by the @axe-core/playwright e2e gate in a real
// browser. This component gate locks the structural a11y of the C2–C4 primitives.
const AXE_OPTS = { rules: { 'color-contrast': { enabled: false } } };

async function violations(container) {
    const results = await axe(container, AXE_OPTS);
    // Map to rule ids so a failure message names the offending rules.
    return results.violations.map((v) => v.id);
}

describe('a11y: InputField (C2)', () => {
    it('has no violations in the default state', async () => {
        const { container } = render(
            <InputField label="First name" id="firstName" name="firstName" value="" onChange={() => {}} />,
        );
        expect(await violations(container)).toEqual([]);
    });

    it('has no violations in the required + error state (aria-invalid + alert)', async () => {
        const { container } = render(
            <InputField
                label="Email"
                id="email"
                name="email"
                type="email"
                required
                value="bad"
                error="Please enter a valid email address."
                onChange={() => {}}
            />,
        );
        expect(await violations(container)).toEqual([]);
    });
});

describe('a11y: Modal (C4)', () => {
    it('labelled dialog has no violations', async () => {
        const { container } = render(
            <Modal label="Example dialog" onClose={() => {}}>
                <h2>Heading</h2>
                <p>Body copy.</p>
                <button>Confirm</button>
            </Modal>,
        );
        expect(await violations(container)).toEqual([]);
    });
});
