import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { BootLoadingFallback, RouteLoadingFallback } from './RouteLoadingFallback';

const PLACEHOLDER = { name: 'Loading Application...' };

describe('RouteLoadingFallback (inside the router)', () => {
  afterEach(cleanup);

  it('shows the apply-page placeholder on the driver application', () => {
    render(
      <MemoryRouter initialEntries={['/apply/acme']}>
        <RouteLoadingFallback />
      </MemoryRouter>,
    );
    expect(screen.getByRole('main', PLACEHOLDER)).toBeInTheDocument();
    expect(screen.queryByText('Loading…')).toBeNull();
  });

  it('keeps the branded loader on every other page', () => {
    render(
      <MemoryRouter initialEntries={['/login']}>
        <RouteLoadingFallback />
      </MemoryRouter>,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Loading…');
    expect(screen.queryByRole('main', PLACEHOLDER)).toBeNull();
  });
});

describe('BootLoadingFallback (outside the router)', () => {
  const originalPath = window.location.pathname;

  afterEach(() => {
    cleanup();
    window.history.replaceState({}, '', originalPath);
  });

  it('shows the apply-page placeholder on the driver application', () => {
    window.history.replaceState({}, '', '/apply/acme');
    render(<BootLoadingFallback platformLoader={<p>Platform loader</p>} />);
    expect(screen.getByRole('main', PLACEHOLDER)).toBeInTheDocument();
    expect(screen.queryByText('Platform loader')).toBeNull();
  });

  it('shows the loader it was given on every other page', () => {
    window.history.replaceState({}, '', '/login');
    render(<BootLoadingFallback platformLoader={<p>Platform loader</p>} />);
    expect(screen.getByText('Platform loader')).toBeInTheDocument();
    expect(screen.queryByRole('main', PLACEHOLDER)).toBeNull();
  });
});
