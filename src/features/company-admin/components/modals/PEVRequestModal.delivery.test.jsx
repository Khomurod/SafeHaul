// PEVRequestModal contract, part 2 of 2: delivery validation — missing
// email/fax handling without window.alert, onProceed, and contact seeding.
// The env/fetch stubs and the base employer fixture live in
// `PEVRequestModal.support.js`; the modal itself runs unmocked.
import React from 'react';

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import { PEVRequestModal } from './PEVRequestModal';
import { stubHarness, restoreHarness, baseEmployer } from './PEVRequestModal.support';

describe('PEVRequestModal', () => {

  beforeEach(stubHarness);

  afterEach(restoreHarness);

  it('shows Missing Info on email delivery when no address on file', async () => {

    render(

      <PEVRequestModal

        employer={baseEmployer}

        applicant={{}}

        onClose={() => {}}

        onProceed={() => {}}

      />,

    );

    await waitFor(() => {

      expect(globalThis.fetch).toHaveBeenCalled();

    });

    expect(screen.getAllByText(/Missing Info/i).length).toBeGreaterThanOrEqual(1);

  });


  it('does not use window.alert when email missing; shows inline error instead', async () => {

    const alertFn = vi.fn();

    globalThis.alert = alertFn;

    const fetchMock = vi.fn(() =>

      Promise.resolve({

        ok: true,

        json: () =>

          Promise.resolve([

            {

              dot_number: '999',

              legal_name: 'ZED EXPRESS LLC',

              phy_city: 'Wylie',

              phy_state: 'TX',

            },

          ]),

      }),

    );

    vi.stubGlobal('fetch', fetchMock);



    render(

      <PEVRequestModal

        employer={{ ...baseEmployer, companyName: 'Zed express' }}

        applicant={{}}

        onClose={() => {}}

        onProceed={() => {}}

      />,

    );



    await waitFor(() => screen.getByTestId('fmcsa-row-0'));



    fireEvent.click(screen.getByTestId('fmcsa-row-0'));

    fireEvent.click(screen.getByRole('button', { name: /Continue to Preview/i }));



    await waitFor(() => {

      expect(screen.getByRole('alert')).toBeInTheDocument();

    });

    expect(screen.getByRole('alert').textContent).toMatch(/Enter the employer/i);

    expect(alertFn).not.toHaveBeenCalled();



    fireEvent.change(screen.getByPlaceholderText('hr@company.com'), {

      target: { value: 'hr@zed.test' },

    });



    await waitFor(() => {

      expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    });



    delete globalThis.alert;

  });



  it('calls onProceed when email is present after validation', async () => {

    const onProceed = vi.fn();

    render(

      <PEVRequestModal

        employer={{ ...baseEmployer, companyEmail: 'ok@company.test' }}

        applicant={{}}

        onClose={() => {}}

        onProceed={onProceed}

      />,

    );



    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());



    fireEvent.click(screen.getByRole('button', { name: /Continue to Preview/i }));



    await waitFor(() => {

      expect(onProceed).toHaveBeenCalledWith(

        'email',

        expect.objectContaining({ email: 'ok@company.test' }),

      );

    });

  });



  it('shows inline fax error and does not alert when fax missing', async () => {

    const alertFn = vi.fn();

    globalThis.alert = alertFn;



    render(

      <PEVRequestModal

        employer={baseEmployer}

        applicant={{}}

        onClose={() => {}}

        onProceed={() => {}}

      />,

    );



    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());



    // Delivery method is a native radio group as of the 2026-07-27 migration.
    // It used to be three plain <button>s with a hand-drawn dot and no
    // aria-checked, so nothing announced which method was selected.

    fireEvent.click(screen.getByRole('radio', { name: /Fax Transmission/i }));

    fireEvent.click(screen.getByRole('button', { name: /Continue to Preview/i }));



    await waitFor(() => {

      expect(screen.getByRole('alert')).toBeInTheDocument();

    });

    expect(screen.getByRole('alert').textContent).toMatch(/fax/i);

    expect(alertFn).not.toHaveBeenCalled();



    delete globalThis.alert;

  });



  it('prefers companyEmail over legacy email when seeding contact info', async () => {

    render(

      <PEVRequestModal

        employer={{

          ...baseEmployer,

          companyEmail: 'ops@carrier.test',

          email: 'legacy@old.test',

        }}

        applicant={{}}

        onClose={() => {}}

        onProceed={() => {}}

      />,

    );

    await waitFor(() => {

      expect(globalThis.fetch).toHaveBeenCalled();

    });

    const emailInput = screen.getByPlaceholderText('hr@company.com');

    expect(emailInput.value).toBe('ops@carrier.test');

  });

});
