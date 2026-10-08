/**
 * What a pick from the employer lookup does to the row: it fills what the
 * carrier's record has, leaves nothing of a previously picked carrier behind,
 * and keeps what the driver typed. And what the list says about each carrier.
 *
 * The census rows are shaped like real ones (2026-10-07).
 */

import React, { useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import EmployerNameAutocomplete from './EmployerNameAutocomplete';
import { EMPLOYER_REGION_NAMES } from '@shared/utils/northAmericanRegions';

const TEXAS_CARRIER = {
  dot_number: '1000001', legal_name: 'LONE STAR FREIGHT LLC', phy_street: '100 MAIN ST', phy_city: 'AUSTIN',
  phy_state: 'TX', phy_country: 'US', phone: '5125550100', email_address: 'dispatch@lonestarfreight.com', status_code: 'A',
};
const ONTARIO_CARRIER = {
  dot_number: '2000002', legal_name: '1788084 ONTARIO INC', dba_name: 'DBA NORTHERN LINE', phy_street: '55 KING ST',
  phy_city: 'TORONTO', phy_state: 'ON', phy_country: 'CA', email_address: 'NONE', status_code: 'I',
};

/** The lookup and two of the row's other fields, as the Employment page holds them. */
function RowHarness({ onRow }) {
  const [row, setRow] = useState({ companyName: '', phone: '', companyEmail: '' });
  const update = (name, value) => setRow((current) => {
    const next = { ...current, [name]: value };
    onRow?.(next);
    return next;
  });
  return (
    <>
      <EmployerNameAutocomplete id="emp-name-0" value={row.companyName} row={row} onChange={update} statesAllowlist={EMPLOYER_REGION_NAMES} />
      <label htmlFor="phone">Company Phone</label>
      <input id="phone" value={row.phone || ''} onChange={(event) => update('phone', event.target.value)} />
    </>
  );
}

let answers;

/** Every query of a lookup answers with the rows `answers` names for its text. */
function stubCensus() {
  vi.stubGlobal('fetch', vi.fn((url) => {
    const where = new URL(url).searchParams.get('$where');
    const rows = Object.entries(answers).find(([text]) => where.includes(`'${text}'`) || where.includes(`= ${text}`))?.[1] || [];
    // The active query answers; the other one adds nothing.
    return Promise.resolve({ ok: true, json: () => Promise.resolve(where.startsWith("status_code = 'A'") || where.startsWith('dot_number') ? rows : []) });
  }));
}

async function search(text) {
  fireEvent.change(screen.getByRole('combobox'), { target: { value: text, name: 'companyName' } });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(400);
  });
}

beforeEach(() => {
  vi.stubEnv('VITE_SOCRATA_APP_TOKEN', 'test-app-token');
  vi.useFakeTimers({ shouldAdvanceTime: true });
  answers = { LONE: [TEXAS_CARRIER], 1788084: [ONTARIO_CARRIER], NORTHERN: [ONTARIO_CARRIER] };
  stubCensus();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('a pick', () => {
  it('fills what the carrier has, and a second pick leaves nothing of the first one', async () => {
    let row;
    render(<RowHarness onRow={(next) => { row = next; }} />);

    await search('LONE');
    fireEvent.click(await screen.findByRole('option', { name: /LONE STAR FREIGHT LLC/ }));
    expect(row).toMatchObject({
      companyName: 'LONE STAR FREIGHT LLC', dotNumber: '1000001', address: '100 MAIN ST', city: 'AUSTIN',
      state: 'Texas', phone: '5125550100', companyEmail: 'dispatch@lonestarfreight.com',
    });

    await search('NORTHERN');
    fireEvent.click(await screen.findByRole('option', { name: /1788084 ONTARIO INC/ }));
    expect(row).toMatchObject({
      companyName: '1788084 ONTARIO INC', dotNumber: '2000002', address: '55 KING ST', city: 'TORONTO',
      // A province, read with its country; and nothing of the Texas carrier's phone or email.
      state: 'Ontario', phone: '', companyEmail: '',
    });
  });

  it('keeps what the driver typed after a pick when the next carrier has nothing for it', async () => {
    let row;
    render(<RowHarness onRow={(next) => { row = next; }} />);

    await search('LONE');
    fireEvent.click(await screen.findByRole('option', { name: /LONE STAR FREIGHT LLC/ }));
    fireEvent.change(screen.getByLabelText('Company Phone'), { target: { value: '(512) 555-0199' } });

    await search('NORTHERN');
    fireEvent.click(await screen.findByRole('option', { name: /1788084 ONTARIO INC/ }));

    expect(row.phone).toBe('(512) 555-0199');
    expect(row.companyEmail).toBe('');
  });

  it('never fills an email the census holds as "NONE"', async () => {
    let row;
    render(<RowHarness onRow={(next) => { row = next; }} />);

    await search('NORTHERN');
    fireEvent.click(await screen.findByRole('option', { name: /1788084 ONTARIO INC/ }));

    expect(row.companyEmail).toBe('');
  });
});

describe('the list', () => {
  it('shows the trade name, where the carrier is, and that it is closed', async () => {
    render(<RowHarness />);

    await search('NORTHERN');
    const option = await screen.findByRole('option', { name: /1788084 ONTARIO INC/ });

    expect(option).toHaveTextContent('d/b/a NORTHERN LINE');
    expect(option).toHaveTextContent('USDOT 2000002 · TORONTO, ON, Canada · Inactive');
  });

  it('finds a carrier by its USDOT number', async () => {
    render(<RowHarness />);

    await search('1788084');

    expect(await screen.findByRole('option', { name: /1788084 ONTARIO INC/ })).toBeInTheDocument();
    const asked = globalThis.fetch.mock.calls.map(([url]) => new URL(url).searchParams.get('$where'));
    expect(asked[0]).toBe('dot_number = 1788084');
  });

  it('says so when nothing matches, and lets the driver type the company in', async () => {
    render(<RowHarness />);

    await search('ZZQX');

    // Announced, as the "Searching…" before it was.
    expect(await screen.findByText(/No carrier found under that name or USDOT number/)).toHaveAttribute('role', 'status');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.getByRole('combobox')).toHaveValue('ZZQX');
    expect(screen.getByRole('combobox').getAttribute('aria-describedby')).toBe('emp-name-0-no-match');
  });

  it('keeps the highlighted carrier in view as the arrow keys move down a long list', async () => {
    answers.LONE = Array.from({ length: 10 }, (_, i) => ({ ...TEXAS_CARRIER, dot_number: String(1000001 + i), legal_name: `LONE STAR ${i}` }));
    // jsdom has no scrollIntoView; a browser does.
    const scrolled = vi.fn(function scrollIntoView() { scrolled.lastTarget = this; });
    Element.prototype.scrollIntoView = scrolled;
    try {
      render(<RowHarness />);

      await search('LONE');
      await screen.findByRole('option', { name: /LONE STAR 0/ });
      fireEvent.keyDown(screen.getByRole('combobox'), { key: 'ArrowDown' });
      fireEvent.keyDown(screen.getByRole('combobox'), { key: 'ArrowDown' });

      const third = screen.getByRole('option', { name: /LONE STAR 2/ });
      expect(third).toHaveAttribute('aria-selected', 'true');
      expect(scrolled).toHaveBeenLastCalledWith({ block: 'nearest' });
      expect(scrolled.lastTarget).toBe(third);
    } finally {
      delete Element.prototype.scrollIntoView;
    }
  });
});

describe('the browser-test switch', () => {
  it('never stands in for the app token outside a browser test', () => {
    vi.stubEnv('VITE_SOCRATA_APP_TOKEN', '');
    window.history.pushState({}, '', '/apply/e2e-company?e2eSafer=mock');
    try {
      render(<RowHarness />);
      expect(screen.queryByRole('combobox')).toBeNull();
    } finally {
      window.history.pushState({}, '', '/');
    }
  });
});
