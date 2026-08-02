import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('@/context/DataContext', () => ({
  useData: () => ({ setCurrentCompanyProfile: vi.fn() }),
}));

vi.mock('@shared/components/feedback/ToastProvider', () => ({
  useToast: () => ({ showSuccess: vi.fn(), showError: vi.fn() }),
}));

vi.mock('@lib/firebase', () => ({
  db: {},
  functions: {},
  storage: {},
}));

vi.mock('firebase/firestore', () => ({
  doc: vi.fn(),
  getDoc: vi.fn(),
  collection: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  getDocs: vi.fn(),
}));

vi.mock('firebase/functions', () => ({
  httpsCallable: vi.fn(() => vi.fn()),
}));

vi.mock('@lib/runtime/e2eMode', () => ({
  isE2ETestMode: true,
  getE2EQueryParam: vi.fn((name, fallback) => {
    if (name === 'e2eIntake') return 'choice';
    if (name === 'e2eUpload') return 'allow';
    return fallback;
  }),
}));

import { PublicApplyHandler } from './PublicApplyHandler';

describe('PublicApplyHandler E2E intake', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows intake chooser when e2eIntake=choice', async () => {
    render(
      <MemoryRouter initialEntries={['/apply/e2e-company?e2eIntake=choice']}>
        <Routes>
          <Route path="/apply/:slug" element={<PublicApplyHandler />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText(/How would you like to start/i)).toBeInTheDocument();
    });
    expect(screen.getByText('Fill Out Manually')).toBeInTheDocument();
    expect(screen.getByText(/Upload CDL for Auto-Fill/i)).toBeInTheDocument();
  });
});
