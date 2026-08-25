import React from 'react';
import { render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { describe, expect, it } from 'vitest';
import { ButtonLink, IconButtonLink, Link } from './Link';

describe('Link', () => {
  it('renders a real anchor with a destination', () => {
    render(<Link href="/records">All records</Link>);
    const link = screen.getByRole('link', { name: 'All records' });
    expect(link).toHaveAttribute('href', '/records');
  });

  it('refuses a link with no destination', () => {
    // An `<a>` with no href is not a link: it is announced as generic text and
    // is not keyboard-focusable. The error names the component to use instead.
    expect(() => render(<Link>Nowhere</Link>)).toThrow(/requires a non-empty href/i);
    expect(() => render(<Link href="  ">Nowhere</Link>)).toThrow(/For an action, use Button/i);
  });

  it('is not external unless asked', () => {
    render(<Link href="/records">All records</Link>);
    const link = screen.getByRole('link');
    expect(link).not.toHaveAttribute('target');
    expect(link).not.toHaveAttribute('rel');
  });
});

/**
 * The reason this component exists.
 *
 * Every external anchor in the product opened a new tab with no announcement.
 * A screen-reader or magnifier user simply loses the page — WCAG 3.2.5 — and
 * `target="_blank"` without `rel="noopener"` hands the opened page a handle on
 * this one.
 */
describe('external links', () => {
  it('announces the new tab in the accessible name', () => {
    render(<Link href="https://example.com" external>Provider docs</Link>);
    expect(screen.getByRole('link', { name: /Provider docs \(opens in a new tab\)/ })).toBeInTheDocument();
  });

  it('does not put the hint in the visible label', () => {
    render(<Link href="https://example.com" external>Provider docs</Link>);
    const hint = screen.getByText(/opens in a new tab/);
    expect(hint).toHaveClass('ds-visually-hidden');
  });

  it('closes the reverse-tabnabbing hole', () => {
    render(<Link href="https://example.com" external>Provider docs</Link>);
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(link.getAttribute('rel')).toContain('noreferrer');
  });

  it('announces it on a button-shaped link too', () => {
    render(<ButtonLink href="https://example.com" external>Open dashboard</ButtonLink>);
    expect(screen.getByRole('link', { name: /Open dashboard \(opens in a new tab\)/ })).toBeInTheDocument();
  });

  it('folds the hint into an icon-only link’s label, not beside it', () => {
    // An icon-only link has no visible text to append to, so the hint has to go
    // into `aria-label` or it would be announced as a separate empty node.
    render(
      <IconButtonLink href="https://example.com" external label="Download the file">
        <svg />
      </IconButtonLink>,
    );
    expect(screen.getByRole('link', { name: 'Download the file (opens in a new tab)' })).toBeInTheDocument();
  });
});

describe('ButtonLink', () => {
  it('wears the Button shape so it lines up beside one', () => {
    render(<ButtonLink href="/export" variant="primary">Export</ButtonLink>);
    const link = screen.getByRole('link', { name: 'Export' });
    expect(link).toHaveClass('ds-button');
    expect(link).toHaveAttribute('data-variant', 'primary');
    // The default step of the shared control scale, same as Button's.
    expect(link).toHaveAttribute('data-size', 'md');
  });

  it('is still announced as a link, not a button', () => {
    render(<ButtonLink href="/export">Export</ButtonLink>);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByRole('link')).toBeInTheDocument();
  });

  it('requires an accessible label when it is icon-only', () => {
    expect(() => render(<IconButtonLink href="/x"><svg /></IconButtonLink>))
      .toThrow(/requires a non-empty label/i);
  });

  it('has no structural accessibility violations', async () => {
    const { container } = render(
      <div>
        <p>
          Read the <Link href="https://example.com" external>provider documentation</Link> first.
        </p>
        <ButtonLink href="/export" variant="primary">Export</ButtonLink>
        <IconButtonLink href="/file.pdf" label="Download the report"><svg /></IconButtonLink>
      </div>,
    );
    expect((await axe(container)).violations).toEqual([]);
  });
});
