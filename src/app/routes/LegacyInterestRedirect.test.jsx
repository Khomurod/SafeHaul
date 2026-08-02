import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation, useParams } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { LegacyInterestRedirect } from './LegacyInterestRedirect';
import { PUBLIC_FEATURE_ROUTE_MANIFEST } from './appRouteManifest';

afterEach(cleanup);

function ApplyProbe() {
  const { slug } = useParams();
  const location = useLocation();
  return <div data-testid="apply" data-slug={slug} data-search={location.search} />;
}

function LoginProbe() {
  return <div data-testid="login" />;
}

function renderAt(url) {
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/interest/:slug" element={<LegacyInterestRedirect />} />
        <Route path="/apply/:slug" element={<ApplyProbe />} />
        <Route path="/login" element={<LoginProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('legacy /interest/:slug compatibility redirect', () => {
  it('forwards old interest links to the public application, not login', () => {
    renderAt('/interest/acme-trucking');
    const apply = screen.getByTestId('apply');
    expect(apply.dataset.slug).toBe('acme-trucking');
    expect(apply.dataset.search).toBe('');
    expect(screen.queryByTestId('login')).toBeNull();
  });

  it('preserves recruiter attribution and maps the lead id to prefill', () => {
    renderAt('/interest/acme-trucking?r=recruiter-1&l=lead-9');
    const apply = screen.getByTestId('apply');
    expect(apply.dataset.slug).toBe('acme-trucking');
    const params = new URLSearchParams(apply.dataset.search);
    expect(params.get('r')).toBe('recruiter-1');
    expect(params.get('prefill')).toBe('lead-9');
  });

  it('supports the long-form recruiter/leadId query names too', () => {
    renderAt('/interest/acme?recruiter=rec-2&leadId=lead-3');
    const params = new URLSearchParams(screen.getByTestId('apply').dataset.search);
    expect(params.get('r')).toBe('rec-2');
    expect(params.get('prefill')).toBe('lead-3');
  });

  it('is registered as a public (login-free) route', () => {
    const route = PUBLIC_FEATURE_ROUTE_MANIFEST.find((r) => r.path === '/interest/:slug');
    expect(route).toBeTruthy();
    expect(route.screen).toBe('legacyInterestRedirect');
    // Public manifest routes carry no allowedRoles — they render outside ProtectedRoute.
    expect(route.allowedRoles).toBeUndefined();
  });
});
