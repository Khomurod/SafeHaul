/**
 * Employment history as the carrier fills it in, and what the lock does to it.
 *
 * A lock stores a snapshot of an employer's identity, so the carrier must not go
 * on editing the very fields that snapshot is taken from: the two drift, and four
 * ordinary edits produce an application the driver is blocked on at submission
 * and cannot fix. The sharpest: a corrected NAME on a row locked by USDOT number
 * trips `locked-employer-changed`, while the driver's wizard renders that
 * identity as a record rather than a field — so they are blocked on the one
 * field they are not allowed to touch.
 *
 * The identity is therefore a read-only display while the lock exists, which is
 * also the rule the design system already states for a field its viewer may not
 * change: a read-only display with a badge, never a disabled input. Correcting it
 * means Unlock, correct, Lock — which mints a lock that matches.
 */
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { normalizeLockedEmployers } from '@/config/applicationLockedFields';
import PreparedEmployersPanel from './PreparedEmployersPanel';

const ACME = { id: 1, companyName: 'Acme Trucking', dotNumber: '123456', position: 'Driver' };
const OWN = { id: 2, companyName: 'Their Own Job', dotNumber: '', position: 'Driver' };

function renderPanel({ employers = [ACME, OWN], locked = [], ...rest } = {}) {
    const onLock = vi.fn();
    const onUnlock = vi.fn();
    const updateFormData = vi.fn();
    render(
        <PreparedEmployersPanel
            formData={{ employers }}
            updateFormData={updateFormData}
            lockedEmployers={normalizeLockedEmployers(locked)}
            onLock={onLock}
            onUnlock={onUnlock}
            {...rest}
        />,
    );
    return { onLock, onUnlock, updateFormData };
}

describe('an employer the carrier has not locked', () => {
    it('is editable, name and USDOT number included', () => {
        renderPanel();

        // By role, not by label text: a locked row renders a read-only *display*
        // whose caption is also "Company name", so only the role tells an editable
        // control from a record.
        expect(screen.getAllByRole('textbox', { name: 'Company name' })).toHaveLength(2);
        expect(screen.getAllByRole('textbox', { name: 'USDOT number' })).toHaveLength(2);
    });

    it('offers to lock it', () => {
        const { onLock } = renderPanel({ employers: [ACME] });

        fireEvent.click(screen.getByRole('button', { name: /Lock this employer/ }));

        expect(onLock).toHaveBeenCalledWith([ACME]);
    });
});

describe('an employer the carrier locked', () => {
    it('shows its identity as a record, so the snapshot cannot drift', () => {
        renderPanel({ employers: [ACME], locked: [ACME] });

        // Not a disabled input: that reads as broken, leaves the tab order, and
        // takes its label with it. Enforcement is server-side regardless, so the
        // markup's job here is to explain.
        expect(screen.queryByRole('textbox', { name: 'Company name' })).not.toBeInTheDocument();
        expect(screen.queryByRole('textbox', { name: 'USDOT number' })).not.toBeInTheDocument();
        expect(screen.getByTestId('prep-emp-locked-0')).toBeInTheDocument();
        expect(screen.getByText('Acme Trucking')).toBeInTheDocument();
        expect(screen.getByText('123456')).toBeInTheDocument();
    });

    it('keeps every field the driver supplies editable', () => {
        // The lock is narrow by design: a PSP report names a carrier beside an
        // inspection date and says nothing about when the driver worked there.
        renderPanel({ employers: [ACME], locked: [ACME] });

        expect(screen.getByRole('textbox', { name: 'Position held' })).toBeInTheDocument();
        expect(screen.getByRole('textbox', { name: 'Reason for leaving' })).toBeInTheDocument();
    });

    it('says how to correct it, and unlocking is that route', () => {
        const { onUnlock } = renderPanel({ employers: [ACME], locked: [ACME] });

        fireEvent.click(screen.getByRole('button', { name: /Unlock to correct/ }));

        expect(onUnlock).toHaveBeenCalledWith('dot:123456');
    });

    it('leaves the rows it did not lock fully editable', () => {
        renderPanel({ employers: [ACME, OWN], locked: [ACME] });

        // One locked record, and the unlocked row keeps its own identity fields.
        expect(screen.getByTestId('prep-emp-locked-0')).toBeInTheDocument();
        expect(screen.getByRole('textbox', { name: 'Company name' })).toHaveValue('Their Own Job');
    });
});

describe('where to reach the employer', () => {
    it('shows the address, city, state, phone and email to check and correct, on a locked row too', () => {
        const filled = { ...ACME, address: '100 MAIN ST', city: 'DALLAS', state: 'Texas', phone: '(214) 555-0100', companyEmail: '' };
        const { updateFormData } = renderPanel({ employers: [filled], locked: [ACME] });

        expect(screen.getByRole('textbox', { name: 'Street address' })).toHaveValue('100 MAIN ST');
        expect(screen.getByRole('textbox', { name: 'City' })).toHaveValue('DALLAS');
        expect(screen.getByRole('combobox', { name: 'State / Province' })).toHaveValue('Texas');
        expect(screen.getByRole('textbox', { name: 'Company phone' })).toHaveValue('(214) 555-0100');
        expect(screen.getByRole('textbox', { name: 'Company email' })).toHaveValue('');

        fireEvent.change(screen.getByRole('textbox', { name: 'Company phone' }), { target: { value: '(214) 555-0199' } });
        const [key, update] = updateFormData.mock.calls.at(-1);
        expect(key).toBe('employers');
        expect(update([filled])).toEqual([expect.objectContaining({ phone: '(214) 555-0199', companyName: 'Acme Trucking' })]);
    });
});
