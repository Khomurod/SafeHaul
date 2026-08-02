import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { CompanyAdminRoute } from './CompanyAdminRoute';

const { useDataMock } = vi.hoisted(() => ({ useDataMock: vi.fn() }));
vi.mock('@/context/DataContext', () => ({ useData: () => useDataMock() }));

function renderAt(claims, companyId) {
  useDataMock.mockReturnValue({
    currentUserClaims: claims,
    currentCompanyProfile: companyId ? { id: companyId } : null,
  });
  return render(
    <MemoryRouter initialEntries={['/company/settings']}>
      <Routes>
        <Route
          path="/company/settings"
          element={(
            <CompanyAdminRoute>
              <div>SETTINGS PAGE</div>
            </CompanyAdminRoute>
          )}
        />
        <Route path="/company/dashboard" element={<div>DASHBOARD PAGE</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('CompanyAdminRoute (UI-006)', () => {
  it('(3) renders the admin page for a company admin', () => {
    renderAt({ roles: { co1: 'company_admin' } }, 'co1');
    expect(screen.getByText('SETTINGS PAGE')).toBeInTheDocument();
    expect(screen.queryByText('DASHBOARD PAGE')).not.toBeInTheDocument();
  });

  it('renders the admin page for a super admin', () => {
    renderAt({ roles: { globalRole: 'super_admin' } }, 'co1');
    expect(screen.getByText('SETTINGS PAGE')).toBeInTheDocument();
  });

  it('(1,2) redirects a recruiter to the dashboard', () => {
    renderAt({ roles: { co1: 'recruiter' } }, 'co1');
    expect(screen.getByText('DASHBOARD PAGE')).toBeInTheDocument();
    expect(screen.queryByText('SETTINGS PAGE')).not.toBeInTheDocument();
  });

  it('redirects an hr_user to the dashboard', () => {
    renderAt({ roles: { co1: 'hr_user' } }, 'co1');
    expect(screen.getByText('DASHBOARD PAGE')).toBeInTheDocument();
  });
});
