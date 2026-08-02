import { describe, it, expect } from 'vitest';
import { parseAddressPartsFromCdl } from './parseCdlAddress';

describe('parseAddressPartsFromCdl', () => {
  it('parses NC CDL style with commas and ZIP+4', () => {
    const r = parseAddressPartsFromCdl('2221 MEADECROFT RD, CHARLOTTE, NC 28214-8399');
    expect(r.street).toBe('2221 MEADECROFT RD');
    expect(r.city).toBe('CHARLOTTE');
    expect(r.state).toBe('NC');
    expect(r.zip).toBe('28214-8399');
  });

  it('parses same address without commas (OCR single line)', () => {
    const r = parseAddressPartsFromCdl('2221 MEADECROFT RD CHARLOTTE NC 28214-8399');
    expect(r.street).toBe('2221 MEADECROFT RD');
    expect(r.city).toBe('CHARLOTTE');
    expect(r.state).toBe('NC');
    expect(r.zip).toBe('28214-8399');
  });

  it('does not treat RD in street name as state', () => {
    const r = parseAddressPartsFromCdl('2221 MEADECROFT RD CHARLOTTE NC 28214');
    expect(r.state).toBe('NC');
    expect(r.street).toMatch(/MEADECROFT/);
    expect(r.city).toBe('CHARLOTTE');
  });

  it('handles five-digit zip only', () => {
    const r = parseAddressPartsFromCdl('1 MAIN ST, AUSTIN, TX 78701');
    expect(r.zip).toBe('78701');
    expect(r.state).toBe('TX');
    expect(r.city).toBe('AUSTIN');
  });
});
