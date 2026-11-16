import { readFileSync } from 'node:fs';
import path from 'node:path';
import React from 'react';
import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataTable } from './DataTable';
import { readScrollEdges } from './useScrollEdges';

const COLUMNS = [
  { key: 'name', header: 'Name', rowHeader: true, render: (row) => row.name },
  { key: 'region', header: 'Region', render: (row) => row.region },
];
const ROWS = [{ id: '1', name: 'Ash', region: 'North' }];

/** The scroll region's geometry, as a browser would report it. */
function setGeometry(region, { scrollWidth, clientWidth, scrollLeft = 0 }) {
  Object.defineProperty(region, 'scrollWidth', { configurable: true, value: scrollWidth });
  Object.defineProperty(region, 'clientWidth', { configurable: true, value: clientWidth });
  Object.defineProperty(region, 'scrollLeft', { configurable: true, writable: true, value: scrollLeft });
}

/** The stylesheet as rules, its comments left out. */
const RULES = [...readFileSync(path.join(__dirname, 'scrollEdges.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map(([, selector, body]) => ({ selector: selector.trim().replace(/\s+/g, ' '), body }));

describe('which edges of a table hide columns', () => {
  it('says neither for a table that fits, give or take a pixel', () => {
    expect(readScrollEdges({ scrollWidth: 600, clientWidth: 600, scrollLeft: 0 })).toEqual({ start: false, end: false });
    expect(readScrollEdges({ scrollWidth: 601, clientWidth: 600, scrollLeft: 0 })).toEqual({ start: false, end: false });
  });

  it('says the far edge at the start, both in the middle, the near edge at the end', () => {
    expect(readScrollEdges({ scrollWidth: 900, clientWidth: 400, scrollLeft: 0 })).toEqual({ start: false, end: true });
    expect(readScrollEdges({ scrollWidth: 900, clientWidth: 400, scrollLeft: 200 })).toEqual({ start: true, end: true });
    expect(readScrollEdges({ scrollWidth: 900, clientWidth: 400, scrollLeft: 500 })).toEqual({ start: true, end: false });
    // A sub-pixel short of the end is the end.
    expect(readScrollEdges({ scrollWidth: 900, clientWidth: 400, scrollLeft: 499.5 })).toEqual({ start: true, end: false });
  });

  it('reads a right-to-left offset, which counts down from zero', () => {
    expect(readScrollEdges({ scrollWidth: 900, clientWidth: 400, scrollLeft: -200 })).toEqual({ start: true, end: true });
  });
});

describe('DataTable shades an edge with columns past it', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('frames its scroll region, and marks the edges as it scrolls', () => {
    const { container } = render(<DataTable ariaLabel="Records" columns={COLUMNS} data={ROWS} getRowId={(row) => row.id} />);
    const frame = container.querySelector('.ds-data-table__scroll-frame');
    const region = frame.querySelector(':scope > .ds-data-table__scroll-region');
    expect(region).not.toBeNull();
    // The test DOM lays nothing out: a table that fits marks neither edge.
    expect(frame).not.toHaveAttribute('data-overflow-start');
    expect(frame).not.toHaveAttribute('data-overflow-end');

    setGeometry(region, { scrollWidth: 900, clientWidth: 400 });
    fireEvent.scroll(region);
    expect(frame).toHaveAttribute('data-overflow-end', 'true');
    expect(frame).not.toHaveAttribute('data-overflow-start');

    region.scrollLeft = 500;
    fireEvent.scroll(region);
    expect(frame).toHaveAttribute('data-overflow-start', 'true');
    expect(frame).not.toHaveAttribute('data-overflow-end');
  });

  it('re-reads the edges when the table changes size without a scroll', () => {
    const callbacks = [];
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback) { callbacks.push(callback); }

      observe() {}

      disconnect() {}
    });
    const { container } = render(<DataTable ariaLabel="Records" columns={COLUMNS} data={ROWS} getRowId={(row) => row.id} />);
    const frame = container.querySelector('.ds-data-table__scroll-frame');
    setGeometry(frame.querySelector('.ds-data-table__scroll-region'), { scrollWidth: 900, clientWidth: 400 });

    act(() => callbacks.forEach((callback) => callback([])));
    expect(frame).toHaveAttribute('data-overflow-end', 'true');
  });

  it('shades only an edge it has marked, and never the edge a pinned column holds', () => {
    const shaded = RULES.filter(({ body }) => /opacity:\s*1/.test(body)).map(({ selector }) => selector).join(', ');
    expect(shaded).toContain('.ds-data-table__scroll-frame[data-overflow-end]::after');
    expect(shaded).toContain('.ds-data-table:not([data-pin-first-column]) .ds-data-table__scroll-frame[data-overflow-start]::before');
    const resting = RULES.find(({ selector }) => selector.startsWith('.ds-data-table__scroll-frame::before, .ds-data-table__scroll-frame::after'));
    expect(resting.body).toMatch(/opacity:\s*0/);
    expect(resting.body).toMatch(/pointer-events:\s*none/);
  });
});
