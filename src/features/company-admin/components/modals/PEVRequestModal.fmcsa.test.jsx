// PEVRequestModal contract, part 1 of 2: the FMCSA registry lookup — the
// token gate, candidate fetch-and-fill, and the no-contact census banner.
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



});
