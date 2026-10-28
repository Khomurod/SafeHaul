/**
 * One line removal at a time in Super Admin's wallet. `useRemovePhoneLine`
 * ignores a second removal while one runs, so the other Remove buttons are
 * disabled meanwhile: a second confirmation must not be silently dropped.
 * (The frozen contracts are in `LineManager.contract.test.jsx`.)
 *
 * All phone numbers and ids below are artificial.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const removePhoneLine = vi.hoisted(() => vi.fn());
const toastMocks = vi.hoisted(() => ({ showSuccess: vi.fn(), showError: vi.fn() }));

vi.mock('@shared/components/feedback/ToastProvider', () => ({ useToast: () => toastMocks }));
vi.mock('@lib/firebase', () => ({ db: {}, functions: {} }));
vi.mock('firebase/functions', () => ({
    httpsCallable: (_functions, name) => (name === 'removePhoneLine' ? removePhoneLine : vi.fn()),
}));
vi.mock('firebase/firestore', () => ({
    doc: () => ({}),
    onSnapshot: (_ref, onNext) => {
        onNext({
            exists: () => true,
            data: () => ({ inventory: [{ phoneNumber: '+15550001111', status: 'active' }, { phoneNumber: '+15550002222', status: 'active' }] }),
        });
        return () => {};
    },
}));
vi.mock('./AddLineModal', () => ({ AddLineModal: () => null }));

import { LineManager } from './LineManager';

beforeEach(() => {
    vi.resetAllMocks();
});

describe('LineManager — one removal at a time', () => {
    it('disables the other Remove buttons until the removal answers', async () => {
        let finish;
        removePhoneLine.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
        render(<LineManager companyId="co-1" companyName="Artificial Freight Co" />);

        fireEvent.click(screen.getByRole('button', { name: 'Remove line +15550002222' }));
        fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove line' }));

        await waitFor(() => expect(screen.getByRole('button', { name: 'Remove line +15550001111' })).toBeDisabled());
        expect(removePhoneLine).toHaveBeenCalledTimes(1);

        finish({ data: { success: true } });
        await waitFor(() => expect(screen.getByRole('button', { name: 'Remove line +15550001111' })).toBeEnabled());
    });
});
