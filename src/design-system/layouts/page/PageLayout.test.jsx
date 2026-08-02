import React from 'react';
import { render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { describe, expect, it } from 'vitest';
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
});
