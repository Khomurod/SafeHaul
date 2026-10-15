/**
 * A company's SMS setup opens from its address (`/super-admin/integrations/<id>`).
 * The form saves under that company, and the server does not check the company
 * exists, so an address whose company was deleted or mistyped opens a notice
 * with the way back, never the form.
 *
 * All names and ids below are artificial.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fx = vi.hoisted(() => ({ reads: [], answers: [] }));

vi.mock('@lib/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
    doc: (_db, ...path) => ({ path: path.join('/') }),
    getDoc: (ref) => {
        fx.reads.push(ref.path);
        return fx.answers.shift() ?? Promise.reject(new Error('no answer prepared'));
    },
}));
vi.mock('./IntegrationManager', () => ({
    IntegrationManager: ({ companyId, companyName, onBack }) => (
        <section aria-label="SMS setup form">
            <p>{`Setting up SMS for ${companyName} (${companyId})`}</p>
            <button type="button" onClick={onBack}>Back to List</button>
        </section>
    ),
}));

import { IntegrationSetup } from './IntegrationSetup';

const company = (id, data) => ({ id, exists: () => Boolean(data), data: () => data });

beforeEach(() => {
    fx.reads = [];
    fx.answers = [];
});

describe("a company's SMS setup", () => {
    it('opens at once for the company picked from the list', () => {
        render(
            <IntegrationSetup
                companyId="co-9"
                pickedCompany={{ id: 'co-9', companyName: 'Artificial Carrier 9' }}
                onBack={() => {}}
            />,
        );

        expect(screen.getByText('Setting up SMS for Artificial Carrier 9 (co-9)')).toBeInTheDocument();
        expect(fx.reads).toEqual([]);
    });

    it('reads the company from the address first, and opens with its name', async () => {
        let answer;
        fx.answers.push(new Promise((resolve) => { answer = resolve; }));
        render(<IntegrationSetup companyId="co-7" pickedCompany={null} onBack={() => {}} />);

        expect(screen.getByRole('status')).toHaveTextContent('Loading the company');
        await waitFor(() => expect(fx.reads).toEqual(['companies/co-7']));
        expect(screen.queryByRole('region', { name: 'SMS setup form' })).not.toBeInTheDocument();

        answer(company('co-7', { companyName: 'Artificial Carrier 7' }));
        expect(await screen.findByText('Setting up SMS for Artificial Carrier 7 (co-7)')).toBeInTheDocument();
    });

    it('does not open the form for an address whose company does not exist', async () => {
        const onBack = vi.fn();
        fx.answers.push(Promise.resolve(company('co-gone', null)));
        render(<IntegrationSetup companyId="co-gone" pickedCompany={null} onBack={onBack} />);

        expect(await screen.findByRole('heading', { name: 'Company not found' })).toBeInTheDocument();
        expect(screen.getByText(/No company has the ID “co-gone”/)).toBeInTheDocument();
        expect(screen.queryByRole('region', { name: 'SMS setup form' })).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /Back to List/ }));
        expect(onBack).toHaveBeenCalledTimes(1);
    });

    it('says when the company could not be read, and reads it again on Try again', async () => {
        fx.answers.push(Promise.reject(Object.assign(new Error('offline'), { code: 'unavailable' })));
        fx.answers.push(Promise.resolve(company('co-7', { companyName: 'Artificial Carrier 7' })));
        render(<IntegrationSetup companyId="co-7" pickedCompany={null} onBack={() => {}} />);

        expect(await screen.findByRole('alert')).toHaveTextContent('Could not load this company');
        expect(screen.queryByRole('region', { name: 'SMS setup form' })).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
        expect(await screen.findByText('Setting up SMS for Artificial Carrier 7 (co-7)')).toBeInTheDocument();
        expect(fx.reads).toEqual(['companies/co-7', 'companies/co-7']);
    });

    it('reads a picked company again when the address names another one', async () => {
        fx.answers.push(Promise.resolve(company('co-8', null)));
        render(
            <IntegrationSetup
                companyId="co-8"
                pickedCompany={{ id: 'co-9', companyName: 'Artificial Carrier 9' }}
                onBack={() => {}}
            />,
        );

        expect(await screen.findByRole('heading', { name: 'Company not found' })).toBeInTheDocument();
        expect(fx.reads).toEqual(['companies/co-8']);
    });
});
