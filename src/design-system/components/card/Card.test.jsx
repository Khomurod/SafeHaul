import { readFileSync } from 'node:fs';
import path from 'node:path';
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { describe, expect, it, vi } from 'vitest';
import { Card, MetricCard } from './Card';

describe('Card', () => {
  it('keeps static cards non-interactive and metric actions native', () => {
    const onActivate = vi.fn();
    render(
      <>
        <Card aria-label="Summary">Static content</Card>
        <MetricCard label="Records" value={12} tone="info" onActivate={onActivate} />
      </>,
    );

    expect(screen.getByLabelText('Summary').tagName).toBe('SECTION');
    fireEvent.click(screen.getByRole('button', { name: 'Records: 12' }));
    expect(onActivate).toHaveBeenCalledOnce();
  });

  it('wears the soft shadow only when asked, and refuses an unknown elevation', () => {
    render(
      <>
        <Card aria-label="Plain">Plain</Card>
        <Card aria-label="Table card" elevation="soft" padding="none">Rows</Card>
      </>,
    );
    expect(screen.getByLabelText('Plain')).not.toHaveAttribute('data-elevation');
    expect(screen.getByLabelText('Table card')).toHaveAttribute('data-elevation', 'soft');
    expect(() => render(<Card elevation="raised">x</Card>)).toThrow(/Unsupported Card elevation/);
    const css = readFileSync(path.join(__dirname, 'Card.css'), 'utf8');
    expect(css).toMatch(/\.ds-card\[data-elevation='soft'\]\s*\{\s*box-shadow:\s*var\(--ds-shadow-soft\);/);
  });

  it('keeps the label and the value apart as words, so the name contains what is visible', () => {
    // axe's label-content-name-mismatch reads the visible text word by word: run
    // together, "Needs attention" and "0" read "attention0", which the name
    // "Needs attention: 0" does not contain. happy-dom has no layout, so axe
    // here cannot see it; the rendered text is what it compares.
    render(<MetricCard label="Needs attention" value={0} tone="warning" onActivate={() => {}} />);

    const card = screen.getByRole('button', { name: 'Needs attention: 0' });
    expect(card.textContent).toBe('Needs attention 0');
  });

  it('has no structural accessibility violations', async () => {
    const { container } = render(
      <MetricCard label="Completed" value={7} tone="success" onActivate={() => {}} />,
    );
    expect((await axe(container)).violations).toEqual([]);
  });
});

describe('MetricCard loading', () => {
  it('holds the value with a placeholder, stays a button named by its label, and still navigates', () => {
    const onActivate = vi.fn();
    render(<MetricCard label="Records" value={12} tone="info" loading onActivate={onActivate} />);

    const card = screen.getByRole('button', { name: 'Records' });
    expect(card).toHaveAttribute('aria-busy', 'true');
    expect(card).toHaveAttribute('data-loading', 'true');
    const value = card.querySelector('.ds-metric-card__value');
    expect(value.querySelector('.ds-skeleton')).not.toBeNull();
    expect(value).not.toHaveAttribute('title');
    expect(card).not.toHaveTextContent('12');

    fireEvent.click(card);
    expect(onActivate).toHaveBeenCalledOnce();
  });

  it('marks a static card busy too', () => {
    const { container } = render(<MetricCard label="Owners" value="4" loading />);
    expect(container.firstChild).toHaveAttribute('aria-busy', 'true');
    expect(container.firstChild).not.toHaveTextContent('4');
  });

  /*
   * Seven other screens show a `MetricCard` that never loads: not loading must
   * render the label and the value with no placeholder and no busy state. The
   * markup is pinned whole, so a wrapper or attribute that sneaks in shows up.
   */
  it('renders the label and the value, and nothing else, when not loading', () => {
    const interactive = render(<MetricCard label="Records" value={12} tone="info" onActivate={() => {}} />);
    expect(interactive.container.innerHTML).toBe(
      '<button type="button" class="ds-metric-card" data-tone="info" data-interactive="true" aria-label="Records: 12">'
      + '<span class="ds-metric-card__content"><span class="ds-metric-card__label" title="Records">Records</span> '
      + '<span class="ds-metric-card__value" title="12">12</span></span></button>',
    );
    const still = render(<MetricCard label="Owners" value="4" loading={false} />);
    expect(still.container.innerHTML).toBe(
      '<div class="ds-metric-card" data-tone="neutral" data-interactive="false">'
      + '<span class="ds-metric-card__content"><span class="ds-metric-card__label" title="Owners">Owners</span> '
      + '<span class="ds-metric-card__value" title="4">4</span></span></div>',
    );
    expect(still.container.firstChild).not.toHaveAttribute('aria-busy');
    expect(still.container.firstChild).not.toHaveAttribute('data-loading');
  });

  it('has no structural accessibility violations while loading', async () => {
    const { container } = render(
      <MetricCard label="Records" value={12} tone="info" loading onActivate={() => {}} />,
    );
    expect((await axe(container)).violations).toEqual([]);
  });
});

describe('MetricCard description', () => {
  it('draws a note under the value, as words apart from it', () => {
    const { container } = render(
      <MetricCard label="Live sequences" value={0} description="Sending right now" />,
    );
    const note = container.querySelector('.ds-metric-card__description');
    expect(note).toHaveTextContent('Sending right now');
    expect(container.firstChild.textContent).toBe('Live sequences 0 Sending right now');
    // The note sits in the text column, after the value.
    expect(container.querySelector('.ds-metric-card__content').lastElementChild).toBe(note);
  });

  it('carries the note in an interactive card\'s name, after the number', () => {
    // Every visible word is in the name, in order (WCAG 2.5.3).
    render(<MetricCard label="Messages" value={12} description="Across all sequences" onActivate={() => {}} />);
    expect(screen.getByRole('button', { name: 'Messages: 12. Across all sequences' })).toBeInTheDocument();
  });

  it('keeps the note while loading, and names the card by the words it shows', () => {
    render(<MetricCard label="Messages" value={12} description="Across all sequences" loading onActivate={() => {}} />);
    const card = screen.getByRole('button', { name: 'Messages. Across all sequences' });
    expect(card).not.toHaveTextContent('12');
    expect(card.querySelector('.ds-metric-card__description')).toHaveTextContent('Across all sequences');
  });

  it.each([[''], ['   '], [42]])('refuses a description of %j rather than drawing an empty line', (description) => {
    expect(() => render(<MetricCard label="Owners" value="4" description={description} />))
      .toThrow(/MetricCard description must be a non-empty string/);
  });

  it.each([
    ['no description', undefined],
    // `null` is how React spells "none": `description={note || null}`.
    ['a null description', null],
  ])('adds no note, and no space for one, with %s', (_, description) => {
    const { container } = render(<MetricCard label="Owners" value="4" description={description} />);
    expect(container.querySelector('.ds-metric-card__description')).toBeNull();
    expect(container.firstChild.textContent).toBe('Owners 4');
  });

  it('has no structural accessibility violations with a note', async () => {
    const { container } = render(
      <>
        <MetricCard label="Live sequences" value={0} description="Sending right now" tone="info" />
        <MetricCard label="Messages" value={12} description="Across all sequences" tone="success" onActivate={() => {}} />
      </>,
    );
    expect((await axe(container)).violations).toEqual([]);
  });
});

/*
 * The C2 tile, as rules: jsdom lays nothing out, so the stylesheet is what is
 * pinned. Comments are stripped first, because they explain what was removed.
 */
describe('MetricCard stylesheet', () => {
  const css = readFileSync(path.join(__dirname, 'Card.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = (selector) => {
    const start = css.indexOf(`${selector} {`);
    return start < 0 ? '' : css.slice(start, css.indexOf('}', start));
  };

  it('draws the glyph bare: no tile, no tile size, no control height', () => {
    expect(css).not.toMatch(/--ds-metric-icon-size/);
    expect(css).not.toMatch(/--ds-metric-tone-bg/);
    expect(rule('.ds-metric-card__icon')).not.toMatch(/background|border-radius|--ds-control-height/);
    expect(rule('.ds-metric-card__icon')).toMatch(/color:\s*var\(--ds-color-content-muted\)/);
  });

  it('cuts nothing: no ellipsis, no single-line label or value', () => {
    expect(css).not.toMatch(/text-overflow:\s*ellipsis/);
    expect(css).not.toMatch(/white-space:\s*nowrap/);
    expect(rule('.ds-metric-card__label')).not.toMatch(/text-transform/);
  });

  it('sets the value at the page-title size, a step down on a phone', () => {
    expect(rule('.ds-metric-card__value')).toMatch(/font-size:\s*var\(--ds-font-size-heading-2xl\)/);
    expect(css).toMatch(/@media \(max-width: 767px\)[\s\S]*\.ds-metric-card__value\s*\{\s*font-size:\s*var\(--ds-font-size-heading-xl\)/);
  });

  it('insets the tone bar from the top and bottom, and colours it per tone', () => {
    const bar = rule('.ds-metric-card::before');
    expect(bar).toMatch(/top:\s*var\(--ds-space-4\)/);
    expect(bar).toMatch(/bottom:\s*var\(--ds-space-4\)/);
    expect(bar).toMatch(/background:\s*var\(--ds-metric-bar\)/);
    for (const tone of ['neutral', 'info', 'success', 'warning', 'accent', 'danger']) {
      expect(rule(`.ds-metric-card[data-tone='${tone}']`)).toMatch(/--ds-metric-bar:\s*var\(--ds-color-[\w-]+\)/);
    }
  });
});
