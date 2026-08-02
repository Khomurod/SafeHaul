import React, { useState } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { FMCSA_SELECT_EXTENDED } from '@shared/services/fmcsaEmployerSocrata';
import EmployerNameAutocomplete from './EmployerNameAutocomplete';

function ControlledEmployerNameAutocomplete(props) {
  const [companyName, setCompanyName] = useState('');
  return (
    <EmployerNameAutocomplete
      {...props}
      value={companyName}
      onChange={(name, val) => {
        if (name === 'companyName') setCompanyName(val);
        props.onChange?.(name, val);
      }}
    />
  );
}

describe('EmployerNameAutocomplete', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_SOCRATA_APP_TOKEN', 'test-app-token');
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('falls back to plain InputField when no token', () => {
    vi.unstubAllEnvs();
    vi.stubEnv('VITE_SOCRATA_APP_TOKEN', '');
    const onChange = vi.fn();
    render(
      <EmployerNameAutocomplete id="co" value="" onChange={onChange} required />,
    );
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    const input = screen.getByLabelText(/company name/i);
    fireEvent.change(input, { target: { value: 'Acme', name: 'companyName' } });
    expect(onChange).toHaveBeenCalledWith('companyName', 'Acme');
  });

  it('debounces fetch and autofills fields on selection', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve([
            {
              dot_number: 999,
              legal_name: 'Test Carrier LLC',
              phy_street: '100 Road',
              phy_city: 'Austin',
              phy_state: 'TX',
              phone: '512-555-0100',
              email_address: 'fleet@testcarrier.com',
            },
          ]),
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const onChange = vi.fn();
    render(
      <ControlledEmployerNameAutocomplete
        id="co"
        onChange={onChange}
        statesAllowlist={['TX', 'CA']}
      />,
    );

    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'Te', name: 'companyName' } });

    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [reqUrl, init] = fetchMock.mock.calls[0];
    expect(init.headers['X-App-Token']).toBe('test-app-token');
    const decodedUrl = decodeURIComponent(String(reqUrl)).replace(/\+/g, ' ');
    expect(decodedUrl).toContain(`$select=${FMCSA_SELECT_EXTENDED}`);

    const pick = await screen.findByRole('option', { name: /Test Carrier LLC/i });
    fireEvent.click(pick);

    expect(onChange.mock.calls).toEqual(
      expect.arrayContaining([
        ['companyName', 'Test Carrier LLC'],
        ['dotNumber', '999'],
        ['address', '100 Road'],
        ['city', 'Austin'],
        ['state', 'TX'],
        ['phone', '512-555-0100'],
        ['companyEmail', 'fleet@testcarrier.com'],
      ]),
    );
  });

  it('aborts in-flight request when prefix drops below 2 characters', async () => {
    const fetchMock = vi.fn(
      () =>
        new Promise(() => {
          /* never resolves */
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const onChange = vi.fn();
    render(<ControlledEmployerNameAutocomplete id="co" onChange={onChange} />);

    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'Te', name: 'companyName' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const ac = fetchMock.mock.calls[0][1].signal;
    expect(ac.aborted).toBe(false);

    fireEvent.change(input, { target: { value: '', name: 'companyName' } });

    expect(ac.aborted).toBe(true);
  });
});
