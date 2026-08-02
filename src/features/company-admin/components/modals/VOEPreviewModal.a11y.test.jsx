/**
 * Dialog, keyboard and axe coverage for the VOE preview.
 *
 * Why this lives in a unit test rather than an E2E spec: under
 * `VITE_E2E_TEST_MODE=1` Firestore is unreachable, so the driver dossier settles
 * into its error state and never mounts `DossierContent` — the PEV tab, and
 * therefore this modal, cannot be reached in a Playwright run at all. These
 * checks run the real axe engine against the real markup so the coverage lives
 * in CI. Real-browser measurements are recorded in the roadmap completion log.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { axe } from 'vitest-axe';

const h2cMock = vi.hoisted(() => ({ fn: vi.fn() }));

vi.mock('@/context/DataContext', () => ({
  useData: () => ({ currentCompanyProfile: { name: 'Northwind Carriers' } }),
}));
vi.mock('html2canvas', () => ({ default: (...args) => h2cMock.fn(...args) }));
vi.mock('jspdf', () => ({ jsPDF: class { save() {} addImage() {} } }));

import { VOEPreviewModal } from './VOEPreviewModal';

const EMPLOYER = {
  companyName: 'Acme Freight',
  city: 'Austin',
  state: 'TX',
  startDate: '2020-01',
  endDate: '2022-06',
};

const APPLICANT = {
  id: 'app-abc123',
  firstName: 'Maria',
  lastName: 'Garcia',
  ssn: '123-45-6789',
  signature: 'data:image/png;base64,AAAA',
  'signature-date': '07/01/2026',
};

const renderModal = (props = {}) => {
  const onClose = props.onClose || vi.fn();
  const onSend = props.onSend || vi.fn();
  const utils = render(
    <VOEPreviewModal
      employer={props.employer === undefined ? EMPLOYER : props.employer}
      applicant={props.applicant === undefined ? APPLICANT : props.applicant}
      onClose={onClose}
      onSend={onSend}
    />,
  );
  return { ...utils, onClose, onSend };
};

beforeEach(() => {
  vi.clearAllMocks();
  h2cMock.fn.mockResolvedValue({ width: 800, height: 1000, toDataURL: () => 'data:image/png;base64,X' });
});
afterEach(cleanup);

describe('VOEPreviewModal axe', () => {
  it('has no violations with a signed document', async () => {
    const { container } = renderModal();
    expect((await axe(container)).violations).toEqual([]);
  });

  it('has no violations with a typed signature', async () => {
    const { container } = renderModal({ applicant: { ...APPLICANT, signature: 'TEXT_SIGNATURE:Maria Garcia' } });
    expect((await axe(container)).violations).toEqual([]);
  });

  it('has no violations with a missing signature', async () => {
    const { container } = renderModal({ applicant: { ...APPLICANT, signature: undefined } });
    expect((await axe(container)).violations).toEqual([]);
  });

  it('has no violations in the missing-data state', async () => {
    const { container } = renderModal({ applicant: null });
    expect((await axe(container)).violations).toEqual([]);
  });

  it('has no violations while showing an export failure', async () => {
    h2cMock.fn.mockRejectedValue(new Error('boom'));
    const { container } = renderModal();
    fireEvent.click(screen.getByRole('button', { name: /Download PDF/i }));
    await screen.findByRole('alert');

    expect((await axe(container)).violations).toEqual([]);
  });
});

describe('VOEPreviewModal dialog semantics', () => {
  it('is a modal dialog named by its visible heading', () => {
    renderModal();
    const dialog = screen.getByRole('dialog', { name: 'Employment Verification Preview' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });

  it('moves focus into the dialog on open', () => {
    renderModal();
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
  });

  it('closes on Escape and returns to the request modal', () => {
    const { onClose } = renderModal();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('restores focus to the control that opened it', async () => {
    function Harness() {
      const [open, setOpen] = React.useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>Continue to Preview</button>
          {open && (
            <VOEPreviewModal
              employer={EMPLOYER}
              applicant={APPLICANT}
              onClose={() => setOpen(false)}
              onSend={vi.fn()}
            />
          )}
        </>
      );
    }
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Continue to Preview' });
    trigger.focus();
    fireEvent.click(trigger);

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it('names every chrome action', () => {
    renderModal();
    ['Close verification preview', 'Print', 'Download PDF', 'Edit Request', 'Transmit Request Now']
      .forEach((name) => {
        expect(screen.getByRole('button', { name: new RegExp(name, 'i') })).toBeInTheDocument();
      });
  });

  it('makes the document scroll region keyboard-focusable and named', () => {
    renderModal();
    // Real-browser axe found `scrollable-region-focusable` (serious) here: the
    // VOE document is far taller than the viewport and none of the dialog's
    // focusable controls are inside the scroller, so a keyboard user could not
    // scroll the document at all.
    const region = screen.getByRole('region', { name: 'Verification document preview' });
    expect(region).toHaveAttribute('tabindex', '0');
    expect(region.contains(screen.getByTestId('voe-document'))).toBe(true);
  });

  it('keeps heading order without skipping a level', () => {
    const { container } = renderModal();
    const levels = [...container.querySelectorAll('h1,h2,h3,h4,h5,h6')].map((h) => Number(h.tagName[1]));

    // The chrome heading is <h4>, under the dossier header's <h3>. The document
    // that follows is a facsimile of a paper form and keeps its own <h1>; a
    // decrease in level is not a heading-order defect, and axe agrees (asserted
    // above). What must not happen is a skipped increase.
    levels.slice(1).forEach((level, i) => {
      expect(level - levels[i]).toBeLessThanOrEqual(1);
    });
  });
});

describe('VOEPreviewModal export feedback', () => {
  it('announces PDF generation while it runs', async () => {
    let resolveCapture;
    h2cMock.fn.mockReturnValue(new Promise((res) => { resolveCapture = res; }));
    renderModal();
    fireEvent.click(screen.getByRole('button', { name: /Download PDF/i }));

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/Generating the verification PDF/));

    resolveCapture({ width: 800, height: 1000, toDataURL: () => 'data:image/png;base64,X' });
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(''));
  });

  it('announces a blocked print pop-up instead of throwing', () => {
    vi.stubGlobal('open', vi.fn(() => null));
    renderModal();

    expect(() => fireEvent.click(screen.getByRole('button', { name: /^Print$/i }))).not.toThrow();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Could not open the print window. Please allow pop-ups for this site and try again.',
    );
    vi.unstubAllGlobals();
  });

  it('clears a previous export error on the next successful attempt', async () => {
    h2cMock.fn.mockRejectedValueOnce(new Error('boom'));
    renderModal();

    fireEvent.click(screen.getByRole('button', { name: /Download PDF/i }));
    await screen.findByRole('alert');

    h2cMock.fn.mockResolvedValue({ width: 800, height: 1000, toDataURL: () => 'data:image/png;base64,X' });
    fireEvent.click(screen.getByRole('button', { name: /Download PDF/i }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });
});

describe('VOEPreviewModal transmission gating', () => {
  it('explains why transmission is blocked and ties the reason to the control', () => {
    renderModal({ applicant: { ...APPLICANT, signature: undefined } });
    const transmit = screen.getByRole('button', { name: /Transmit Request Now/i });

    expect(transmit).toBeDisabled();
    expect(transmit).toHaveAccessibleDescription(
      'This form cannot be transmitted without a valid applicant signature.',
    );
  });

  it('drops the explanation once a signature is present', () => {
    renderModal();
    const transmit = screen.getByRole('button', { name: /Transmit Request Now/i });

    expect(transmit).toBeEnabled();
    expect(transmit).not.toHaveAttribute('aria-describedby');
  });

  it('still shows the missing-signature notice inside the document', () => {
    renderModal({ applicant: { ...APPLICANT, signature: undefined } });
    const doc = screen.getByTestId('voe-document');
    expect(within(doc).getByText('DRIVER SIGNATURE MISSING')).toBeInTheDocument();
  });
});

describe('VOEPreviewModal missing-data state', () => {
  it('explains itself and offers a way back instead of rendering nothing', () => {
    const { onClose } = renderModal({ applicant: null });

    expect(screen.getByRole('dialog', { name: 'Verification document unavailable' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(
      /This verification request cannot be generated because the employer or applicant\s+details are missing\./,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Edit Request' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
