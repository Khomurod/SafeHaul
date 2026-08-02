/**
 * Dialog and delivery-choice semantics for the PEV request modal.
 *
 * `PEVRequestModal.test.jsx` covers the FMCSA lookup, the contact seeding and
 * the validation *behaviour*. This file covers what the 2026-07-27 migration is
 * responsible for and what nothing previously asserted: that this is a real
 * dialog with real focus handling, and that the delivery method is a real radio
 * group rather than three buttons that look like one.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { axe } from 'vitest-axe';

import { PEVRequestModal } from './PEVRequestModal';

const employer = {
  companyName: 'Swift Transportation',
  companyEmail: 'hr@swift.test',
  fax: '',
  phone: '',
  state: 'TX',
};

const renderModal = (props = {}) => {
  const onClose = props.onClose || vi.fn();
  const onProceed = props.onProceed || vi.fn();
  const utils = render(
    <PEVRequestModal employer={employer} applicant={{}} onClose={onClose} onProceed={onProceed} {...props} />,
  );
  return { ...utils, onClose, onProceed };
};

beforeEach(() => {
  // No Socrata token: the FMCSA block is skipped, which keeps this file focused
  // on the dialog itself and avoids a network stub.
  vi.stubEnv('VITE_SOCRATA_APP_TOKEN', '');
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('PEVRequestModal dialog semantics', () => {
  it('is a modal dialog named by its visible heading', () => {
    renderModal();
    const dialog = screen.getByRole('dialog', { name: 'Initiate Verification' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });

  it('moves focus into the dialog on open', () => {
    renderModal();
    const dialog = screen.getByRole('dialog', { name: 'Initiate Verification' });
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('offers a named close control', () => {
    const { onClose } = renderModal();
    fireEvent.click(screen.getByRole('button', { name: 'Close verification request' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape', () => {
    const { onClose } = renderModal();
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Initiate Verification' }), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('restores focus to the control that opened it', async () => {
    function Harness() {
      const [open, setOpen] = React.useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>Initiate PEV</button>
          {open && (
            <PEVRequestModal
              employer={employer}
              applicant={{}}
              onClose={() => setOpen(false)}
              onProceed={vi.fn()}
            />
          )}
        </>
      );
    }
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Initiate PEV' });
    trigger.focus();
    fireEvent.click(trigger);

    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Initiate Verification' }), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });
});

describe('PEVRequestModal axe', () => {
  it('has no violations on open', async () => {
    const { container } = renderModal();
    expect((await axe(container)).violations).toEqual([]);
  });

  it('has no violations with the fax field shown', async () => {
    const { container } = renderModal();
    fireEvent.click(screen.getByRole('radio', { name: /Fax Transmission/i }));
    expect((await axe(container)).violations).toEqual([]);
  });

  it('has no violations while showing a validation error', async () => {
    const { container } = render(
      <PEVRequestModal
        employer={{ companyName: 'No Contact Co', state: 'TX' }}
        applicant={{}}
        onClose={vi.fn()}
        onProceed={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Continue to Preview/i }));
    await screen.findByRole('alert');
    expect((await axe(container)).violations).toEqual([]);
  });
});

describe('PEVRequestModal delivery method', () => {
  const OPTIONS = [
    ['email', 'E-mail with Portal Link'],
    ['fax', 'Fax Transmission'],
    ['manual', 'Download / Print'],
  ];

  it('is a real radio group with a legend, not three look-alike buttons', () => {
    renderModal();
    const group = screen.getByRole('group', { name: /Select Delivery Method/i });
    expect(group.tagName).toBe('FIELDSET');
    expect(screen.getAllByRole('radio')).toHaveLength(3);
  });

  it.each(OPTIONS)('exposes %s as a named radio', (_id, label) => {
    renderModal();
    expect(screen.getByRole('radio', { name: new RegExp(label.replace(/[/]/g, '\\/'), 'i') })).toBeInTheDocument();
  });

  it('starts on email and announces the selection through aria-checked', () => {
    renderModal();
    expect(screen.getByRole('radio', { name: /E-mail with Portal Link/i })).toBeChecked();
    expect(screen.getByRole('radio', { name: /Fax Transmission/i })).not.toBeChecked();
  });

  it('keeps all three radios in one browser-managed group', () => {
    renderModal();
    const names = screen.getAllByRole('radio').map((r) => r.getAttribute('name'));
    expect(new Set(names).size).toBe(1);
  });

  it('moves the selection and reveals the matching contact field', () => {
    renderModal();
    fireEvent.click(screen.getByRole('radio', { name: /Fax Transmission/i }));

    expect(screen.getByRole('radio', { name: /Fax Transmission/i })).toBeChecked();
    expect(screen.getByLabelText('Recipient Fax Number')).toBeInTheDocument();
    expect(screen.queryByLabelText('Recipient Email Address')).toBeNull();
  });

  it('says "Missing Info" inside the option that is missing it', () => {
    render(
      <PEVRequestModal
        employer={{ companyName: 'No Contact Co', state: 'TX' }}
        applicant={{}}
        onClose={vi.fn()}
        onProceed={vi.fn()}
      />,
    );
    // The marker is part of the option's own accessible description, so it is
    // announced with the option rather than sitting in a 10 px pill beside it.
    expect(screen.getByRole('radio', { name: /E-mail with Portal Link/i }))
      .toHaveAccessibleDescription(/Missing Info/i);
  });

  it('switches the primary action label for manual delivery', () => {
    renderModal();
    expect(screen.getByRole('button', { name: /Continue to Preview/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: /Download \/ Print/i }));
    expect(screen.getByRole('button', { name: /Preview & Print/i })).toBeInTheDocument();
  });

  it('proceeds with the frozen delivery value and contact shape', () => {
    const { onProceed } = renderModal();
    fireEvent.click(screen.getByRole('button', { name: /Continue to Preview/i }));

    expect(onProceed).toHaveBeenCalledWith('email', {
      email: 'hr@swift.test',
      fax: '',
      phone: '',
    });
  });
});

describe('PEVRequestModal missing-contact validation', () => {
  it('blocks email delivery with no address, announces why, and focuses the input', async () => {
    const onProceed = vi.fn();
    render(
      <PEVRequestModal
        employer={{ companyName: 'No Contact Co', state: 'TX' }}
        applicant={{}}
        onClose={vi.fn()}
        onProceed={onProceed}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Continue to Preview/i }));

    expect(onProceed).not.toHaveBeenCalled();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      "Enter the employer's email address to send the portal link, or switch to Download / Print.",
    );
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Recipient Email Address')));
  });

  it('marks the offending field invalid and describes it by the error', async () => {
    render(
      <PEVRequestModal
        employer={{ companyName: 'No Contact Co', state: 'TX' }}
        applicant={{}}
        onClose={vi.fn()}
        onProceed={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Continue to Preview/i }));

    const input = await screen.findByLabelText('Recipient Email Address');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription(/Enter the employer's email address/);
  });

  it('clears the error as soon as the value is corrected', async () => {
    render(
      <PEVRequestModal
        employer={{ companyName: 'No Contact Co', state: 'TX' }}
        applicant={{}}
        onClose={vi.fn()}
        onProceed={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Continue to Preview/i }));
    await screen.findByRole('alert');

    fireEvent.change(screen.getByLabelText('Recipient Email Address'), { target: { value: 'a@b.test' } });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('blocks fax delivery with no number and announces why', async () => {
    const onProceed = vi.fn();
    render(
      <PEVRequestModal
        employer={{ companyName: 'No Contact Co', state: 'TX' }}
        applicant={{}}
        onClose={vi.fn()}
        onProceed={onProceed}
      />,
    );
    fireEvent.click(screen.getByRole('radio', { name: /Fax Transmission/i }));
    fireEvent.click(screen.getByRole('button', { name: /Continue to Preview/i }));

    expect(onProceed).not.toHaveBeenCalled();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Enter the fax number, or switch to Download / Print.',
    );
  });

  it('never blocks manual delivery', () => {
    const onProceed = vi.fn();
    render(
      <PEVRequestModal
        employer={{ companyName: 'No Contact Co', state: 'TX' }}
        applicant={{}}
        onClose={vi.fn()}
        onProceed={onProceed}
      />,
    );
    fireEvent.click(screen.getByRole('radio', { name: /Download \/ Print/i }));
    fireEvent.click(screen.getByRole('button', { name: /Preview & Print/i }));

    expect(onProceed).toHaveBeenCalledWith('manual', expect.objectContaining({ email: '', fax: '' }));
  });
});
