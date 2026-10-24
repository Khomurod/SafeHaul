import React, { createRef } from 'react';
import { render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PageContainer, PageHeader, ResponsiveGrid, Stack } from './PageLayout';

describe('page layouts', () => {
  it('provides a single page heading and responsive composition contract', async () => {
    const { container } = render(
      <PageContainer>
        <Stack>
          <PageHeader title="Overview" description="Current activity" />
          <ResponsiveGrid><div>One</div><div>Two</div></ResponsiveGrid>
        </Stack>
      </PageContainer>,
    );
    expect(screen.getByRole('heading', { name: 'Overview', level: 1 })).toBeInTheDocument();
    expect((await axe(container)).violations).toEqual([]);
  });

  describe('PageHeader count', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('sits beside the heading, outside it, and is read with its word', () => {
      render(<PageHeader title="Applications" count={8} countLabel="applications" />);

      expect(screen.getByRole('heading', { level: 1, name: 'Applications' })).toBeInTheDocument();
      expect(screen.getByRole('status')).toHaveTextContent(/^8 applications$/);
    });

    it('groups a large number the way the rest of the app writes it', () => {
      render(<PageHeader title="Leads" count={12345} countLabel="leads" />);

      expect(screen.getByRole('status')).toHaveTextContent(/^12,345 leads$/);
    });

    it('shows zero, an empty list being a real answer', () => {
      render(<PageHeader title="Leads" count={0} countLabel="leads" />);

      expect(screen.getByRole('status')).toHaveTextContent(/^0 leads$/);
    });

    it('keeps an empty status region while the number is unknown, so the first one is announced', () => {
      const { rerender } = render(<PageHeader title="Leads" countLabel="leads" />);
      const region = screen.getByRole('status');
      expect(region).toBeEmptyDOMElement();

      rerender(<PageHeader title="Leads" count={8} countLabel="leads" />);

      // The same element: a region inserted with its content is often not read.
      expect(screen.getByRole('status')).toBe(region);
      expect(region).toHaveTextContent(/^8 leads$/);
    });

    it('draws a plain heading when the page shows no count at all', () => {
      render(<PageHeader title="Settings" />);

      expect(screen.queryByRole('status')).toBeNull();
    });

    it.each([[-1], [2.5], ['8'], [Number.NaN]])('refuses %p as a count', (count) => {
      vi.spyOn(console, 'error').mockImplementation(() => {});

      expect(() => render(<PageHeader title="Leads" count={count} countLabel="leads" />))
        .toThrow('PageHeader count must be a whole number of records');
    });

    it('refuses a count with no word to read after it', () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});

      expect(() => render(<PageHeader title="Leads" count={3} />))
        .toThrow('PageHeader count needs a countLabel');
    });

    it('has no accessibility violations', async () => {
      const { container } = render(
        <PageHeader title="Applications" count={8} countLabel="applications" actions={<button type="button">Export</button>} />,
      );
      expect((await axe(container)).violations).toEqual([]);
    });
  });

  describe('PageHeader level', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('is a second-level heading under a masthead that holds the page\'s h1, drawn the same', () => {
      render(<PageHeader level={2} title="Blog Posts" count={3} countLabel="articles" />);

      const heading = screen.getByRole('heading', { level: 2, name: 'Blog Posts' });
      expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
      expect(heading).toHaveClass('ds-page-header__heading');
      expect(screen.getByRole('heading', { level: 2 })).toBe(heading);
      expect(screen.getByRole('status')).toHaveTextContent(/^3 articles$/);
    });

    it('hands its heading to a page that moves focus to it', () => {
      const ref = createRef();
      render(<PageHeader level={2} title="Blog Posts" headingRef={ref} />);

      expect(ref.current).toBe(screen.getByRole('heading', { level: 2, name: 'Blog Posts' }));
      ref.current.focus();
      expect(ref.current).toHaveFocus();
    });

    it('is not focusable without a headingRef', () => {
      render(<PageHeader title="Settings" />);

      expect(screen.getByRole('heading', { level: 1 })).not.toHaveAttribute('tabindex');
    });

    it.each([[3], [0], ['2']])('refuses %p as a level', (level) => {
      vi.spyOn(console, 'error').mockImplementation(() => {});

      expect(() => render(<PageHeader title="Leads" level={level} />))
        .toThrow('PageHeader level must be 1 or 2');
    });
  });
});
