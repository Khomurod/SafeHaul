import React, { useState } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { FMCSA_SELECT_DRIVER } from '@shared/services/fmcsaEmployerSocrata';
import { NORTH_AMERICAN_REGION_NAMES } from '@shared/utils/northAmericanRegions';
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

  it('marks the name invalid and says why in both modes, beside the lookup\'s own message', () => {
    const { unmount } = render(<EmployerNameAutocomplete id="co" value="" onChange={vi.fn()} required error="Required." />);
    const combobox = screen.getByRole('combobox');
    expect(combobox).toHaveAttribute('aria-invalid', 'true');
    expect(combobox.getAttribute('aria-describedby')).toBe('co-error');
    expect(document.getElementById('co-error')).toHaveTextContent('Required.');
    unmount();

    vi.stubEnv('VITE_SOCRATA_APP_TOKEN', '');
    render(<EmployerNameAutocomplete id="co" value="" onChange={vi.fn()} required error="Required." />);
    expect(screen.getByLabelText(/company name/i)).toHaveAttribute('aria-invalid', 'true');
    expect(document.getElementById('co-error')).toHaveTextContent('Required.');
  });

  it('keeps browser autofill off in both modes, so the applicant\'s own details never land here', () => {
    const { unmount } = render(<EmployerNameAutocomplete id="co" value="" onChange={vi.fn()} />);
    // The lookup draws its own listbox; the browser's list would cover it.
    expect(screen.getByRole('combobox')).toHaveAttribute('autocomplete', 'off');
    unmount();

    vi.stubEnv('VITE_SOCRATA_APP_TOKEN', '');
    render(<EmployerNameAutocomplete id="co" value="" onChange={vi.fn()} />);
    expect(screen.getByLabelText(/company name/i)).toHaveAttribute('autocomplete', 'off');
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
        statesAllowlist={NORTH_AMERICAN_REGION_NAMES}
      />,
    );

    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'Te', name: 'companyName' } });

    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });

    // Active carriers, then the rest (`fmcsaEmployerSocrata.driver.test.js`).
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [reqUrl, init] of fetchMock.mock.calls) {
      expect(init.headers['X-App-Token']).toBe('test-app-token');
      expect(new URL(reqUrl).searchParams.get('$select')).toBe(FMCSA_SELECT_DRIVER);
    }

    // Both answers hold the same carrier; it is offered once.
    const pick = await screen.findByRole('option', { name: /Test Carrier LLC/i });
    expect(screen.getAllByRole('option')).toHaveLength(1);
    fireEvent.click(pick);

    expect(onChange.mock.calls).toEqual(
      expect.arrayContaining([
        ['companyName', 'Test Carrier LLC'],
        ['dotNumber', '999'],
        ['address', '100 Road'],
        ['city', 'Austin'],
        ['state', 'Texas'],
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

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const signals = fetchMock.mock.calls.map(([, init]) => init.signal);
    expect(signals.every((signal) => !signal.aborted)).toBe(true);

    fireEvent.change(input, { target: { value: '', name: 'companyName' } });

    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });
});
