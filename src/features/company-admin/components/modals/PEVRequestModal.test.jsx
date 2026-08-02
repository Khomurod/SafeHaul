import React from 'react';

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import { PEVRequestModal } from './PEVRequestModal';



describe('PEVRequestModal', () => {

  beforeEach(() => {

    vi.stubEnv('VITE_SOCRATA_APP_TOKEN', 'test-token');

    vi.stubGlobal(

      'fetch',

      vi.fn(() =>

        Promise.resolve({ ok: true, json: () => Promise.resolve([]) }),

      ),

    );

  });



  afterEach(async () => {

    await new Promise((r) => {

      setTimeout(r, 0);

    });

    vi.unstubAllEnvs();

    vi.unstubAllGlobals();

    vi.restoreAllMocks();

  });



  const baseEmployer = {

    companyName: 'Swift Transportation',

    companyEmail: '',

    email: '',

    fax: '',

    phone: '',

  };



  it('hides FMCSA registry section when no Socrata token', () => {

    vi.unstubAllEnvs();

    vi.stubEnv('VITE_SOCRATA_APP_TOKEN', '');

    render(

      <PEVRequestModal

        employer={baseEmployer}

        applicant={{}}

        onClose={() => {}}

        onProceed={() => {}}

      />,

    );

    expect(screen.queryByText(/FMCSA company match/i)).not.toBeInTheDocument();

  });



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



  it('fetches FMCSA candidates and fills contact fields when a row is chosen', async () => {

    const fetchMock = vi.fn(() =>

      Promise.resolve({

        ok: true,

        json: () =>

          Promise.resolve([

            {

              dot_number: '42',

              legal_name: 'Swift LLC',

              phy_city: 'Phoenix',

              phy_state: 'AZ',

              email_address: 'hr@swift.test',

              fax: '4805551212',

              telephone: '4805550100',

            },

          ]),

      }),

    );

    vi.stubGlobal('fetch', fetchMock);



    render(

      <PEVRequestModal

        employer={baseEmployer}

        applicant={{}}

        onClose={() => {}}

        onProceed={() => {}}

      />,

    );



    await waitFor(() => {

      expect(screen.getByText(/Swift LLC/)).toBeInTheDocument();

    });



    expect(fetchMock).toHaveBeenCalled();

    const firstUrl = String(fetchMock.mock.calls[0][0]);

    expect(firstUrl).toContain('az4n-8mr2');



    fireEvent.click(screen.getByTestId('fmcsa-row-0'));



    await waitFor(() => {

      const emailInput = screen.getByPlaceholderText('hr@company.com');

      expect(emailInput.value).toBe('hr@swift.test');

    });



    const rowBtn = screen.getByTestId('fmcsa-row-0');

    expect(rowBtn.getAttribute('aria-pressed')).toBe('true');

    expect(screen.getByText(/^Selected$/)).toBeInTheDocument();

    expect(screen.queryByText(/No email or fax from this registry row/i)).not.toBeInTheDocument();

  });



  it('shows selection and no-contact banner when census row has no email/fax/phone', async () => {

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

        employer={{ ...baseEmployer, companyName: 'Zed express', state: 'Texas' }}

        applicant={{}}

        onClose={() => {}}

        onProceed={() => {}}

      />,

    );



    await waitFor(() => {

      expect(screen.getByText(/ZED EXPRESS LLC/)).toBeInTheDocument();

    });



    fireEvent.click(screen.getByTestId('fmcsa-row-0'));



    await waitFor(() => {

      expect(screen.getByText(/No email or fax from this registry row/i)).toBeInTheDocument();

    });

    expect(screen.getByTestId('fmcsa-row-0').getAttribute('aria-pressed')).toBe('true');

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


