import React from 'react';
import { render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { describe, expect, it } from 'vitest';
import { Badge } from './Badge';

describe('Badge', () => {
  it('renders feature-provided content with a generic tone', async () => {
    const { container } = render(<Badge tone="warning">Needs review</Badge>);
    expect(screen.getByText('Needs review')).toHaveAttribute('data-tone', 'warning');
    expect((await axe(container)).violations).toEqual([]);
  });
});
