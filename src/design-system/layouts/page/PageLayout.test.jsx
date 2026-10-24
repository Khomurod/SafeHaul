import React from 'react';
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

    it('shows nothing while the number is unknown', () => {
      render(<PageHeader title="Leads" countLabel="leads" />);

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
});
