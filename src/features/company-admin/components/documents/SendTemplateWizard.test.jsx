// Guided three-step send flow. The wizard performs no I/O: every assertion
// here is about navigation, the preserved delivery contract, the final summary
// and the double-submit / close-during-send guards. All fixtures are artificial.
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SendTemplateWizard } from './SendTemplateWizard';

const noop = () => {};

const baseProps = () => ({
    selectedTemplate: { id: 'tpl-1', title: 'Artificial Offer Letter', fields: [{ id: 'f1' }, { id: 'f2' }] },
    onClose: vi.fn(),
    manualName: '',
    setManualName: vi.fn(),
    manualEmail: '',
    setManualEmail: vi.fn(),
    manualPhone: '',
    setManualPhone: vi.fn(),
    deliveryMethod: 'email',
    setDeliveryMethod: vi.fn(),
    editablePrefillPartition: { groups: [], plainFields: [] },
    prefillValues: {},
    setPrefillValues: noop,
    prefillValuesByGroupKey: {},
    setPrefillValuesByGroupKey: noop,
    sending: false,
    executeTemplateSend: vi.fn(),
    filteredDrivers: [],
    searchQuery: '',
    setSearchQuery: vi.fn(),
    handleQuickSelect: vi.fn(),
});

const renderWizard = (overrides = {}) => {
    const props = { ...baseProps(), ...overrides };
    return { props, ...render(<SendTemplateWizard {...props} />) };
};

/** Walk to the final step of a wizard rendered with a recipient name. */
const goToReview = () => {
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
};

beforeEach(() => {
    vi.clearAllMocks();
});

describe('step structure', () => {
    it('presents exactly the three documented steps and starts on Recipient', () => {
        renderWizard();
        expect(screen.getByText('1. Recipient')).toBeInTheDocument();
        expect(screen.getByText('2. Document details')).toBeInTheDocument();
        expect(screen.getByText('3. Delivery and review')).toBeInTheDocument();
        expect(screen.getByText('Step 1 of 3: Recipient')).toBeInTheDocument();
        expect(screen.getByLabelText(/Recipient name/)).toBeInTheDocument();
    });

    it('blocks Continue until a recipient name exists', () => {
        const { unmount } = renderWizard();
        expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
        unmount();

        renderWizard({ manualName: 'Artificial Person' });
        expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled();
    });

    it('moves forward and back through the steps', () => {
        renderWizard({ manualName: 'Artificial Person' });

        fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
        expect(screen.getByText('Step 2 of 3: Document details')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
        expect(screen.getByText('Step 3 of 3: Delivery and review')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Back' }));
        expect(screen.getByText('Step 2 of 3: Document details')).toBeInTheDocument();
    });

    it('disables Back on the first step', () => {
        renderWizard({ manualName: 'Artificial Person' });
        expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled();
    });
});

describe('step 1 — recipient', () => {
    it('edits the recipient through the parent-owned setters', () => {
        const { props } = renderWizard();
        fireEvent.change(screen.getByLabelText(/Recipient name/), { target: { value: 'Artificial Person' } });
        fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'nobody@example.invalid' } });
        fireEvent.change(screen.getByLabelText('Phone number'), { target: { value: '5550000000' } });

        expect(props.setManualName).toHaveBeenCalledWith('Artificial Person');
        expect(props.setManualEmail).toHaveBeenCalledWith('nobody@example.invalid');
        expect(props.setManualPhone).toHaveBeenCalledWith('5550000000');
    });

    it('offers existing drivers and leads with the untouched quick-select callback', () => {
        const driver = { id: 'lead-1', firstName: 'Artificial', lastName: 'Driver', email: 'lead@example.invalid' };
        const { props } = renderWizard({ filteredDrivers: [driver] });

        fireEvent.click(screen.getByRole('button', { name: /Artificial Driver/ }));
        expect(props.handleQuickSelect).toHaveBeenCalledWith(driver);
    });

    it('says so when no lead matches', () => {
        renderWizard();
        expect(screen.getByText('No leads found.')).toBeInTheDocument();
    });
});

describe('step 2 — document details', () => {
    it('shows the template being sent and its field count', () => {
        renderWizard({ manualName: 'Artificial Person' });
        fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

        // The title appears in the dialog subtitle as well as the step body.
        expect(screen.getAllByText('Artificial Offer Letter').length).toBeGreaterThan(0);
        expect(screen.getByText('2 fields')).toBeInTheDocument();
    });

    it('renders grouped and plain prefill controls', () => {
        renderWizard({
            manualName: 'Artificial Person',
            editablePrefillPartition: {
                groups: [
                    {
                        groupKey: 'binding:full_name',
                        uiLabel: 'Full name',
                        appliesCount: 2,
                        useDateTriplet: false,
                        members: [{ id: 'f1', label: 'Name' }, { id: 'f2', label: 'Print name' }],
                    },
                ],
                plainFields: [{ id: 'f3', label: 'Trailer number' }],
            },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

        expect(screen.getByText(/applies to 2 places/)).toBeInTheDocument();
        expect(screen.getByLabelText('Trailer number')).toBeInTheDocument();
    });

    it('says plainly when a template has nothing to pre-fill', () => {
        renderWizard({ manualName: 'Artificial Person' });
        fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
        expect(screen.getByText(/no editable pre-fill fields/i)).toBeInTheDocument();
    });
});

describe('step 3 — delivery and review', () => {
    it('offers exactly the four preserved delivery values', () => {
        const { props } = renderWizard({ manualName: 'Artificial Person' });
        goToReview();

        for (const label of ['Email', 'SMS', 'Email + SMS', 'Copy Link']) {
            expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
        }

        fireEvent.click(screen.getByRole('button', { name: 'Copy Link' }));
        expect(props.setDeliveryMethod).toHaveBeenCalledWith('copy');
        fireEvent.click(screen.getByRole('button', { name: 'Email + SMS' }));
        expect(props.setDeliveryMethod).toHaveBeenCalledWith('both');
        fireEvent.click(screen.getByRole('button', { name: 'SMS' }));
        expect(props.setDeliveryMethod).toHaveBeenCalledWith('sms');
    });

    it('exposes the selected delivery method non-visually', () => {
        renderWizard({ manualName: 'Artificial Person', deliveryMethod: 'sms' });
        goToReview();
        expect(screen.getByRole('button', { name: 'SMS' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('button', { name: 'Email' })).toHaveAttribute('aria-pressed', 'false');
    });

    it('summarises the send, including the seven-day expiry', () => {
        renderWizard({
            manualName: 'Artificial Person',
            manualEmail: 'nobody@example.invalid',
            manualPhone: '5550000000',
        });
        goToReview();

        expect(screen.getAllByText('Artificial Offer Letter').length).toBeGreaterThan(0);
        expect(screen.getByText('Artificial Person')).toBeInTheDocument();
        expect(screen.getByText('nobody@example.invalid')).toBeInTheDocument();
        expect(screen.getByText('5550000000')).toBeInTheDocument();
        expect(screen.getByText('7 days after sending')).toBeInTheDocument();
    });

    it('labels the action Send Document, or Copy Signing Link for the copy method', () => {
        const { unmount } = renderWizard({ manualName: 'Artificial Person' });
        goToReview();
        expect(screen.getByRole('button', { name: /Send Document/ })).toBeInTheDocument();
        unmount();

        renderWizard({ manualName: 'Artificial Person', deliveryMethod: 'copy' });
        goToReview();
        expect(screen.getByRole('button', { name: /Copy Signing Link/ })).toBeInTheDocument();
    });

    it('calls the parent send handler unchanged', () => {
        const { props } = renderWizard({ manualName: 'Artificial Person' });
        goToReview();
        fireEvent.click(screen.getByRole('button', { name: /Send Document/ }));
        expect(props.executeTemplateSend).toHaveBeenCalledTimes(1);
    });
});

describe('send guards', () => {
    it('disables the submit action while a send is in flight', () => {
        renderWizard({ manualName: 'Artificial Person', sending: true });
        goToReview();
        expect(screen.getByRole('button', { name: /Send Document/ })).toBeDisabled();
    });

    it('announces the in-flight send to assistive technology', () => {
        renderWizard({ manualName: 'Artificial Person', sending: true });
        expect(screen.getByText('Sending document, please wait…')).toBeInTheDocument();
    });

    it('disables Close and step navigation while sending', () => {
        renderWizard({ manualName: 'Artificial Person', sending: true });
        expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled();
    });

    it('does not close on Escape while sending', () => {
        const { props } = renderWizard({ manualName: 'Artificial Person', sending: true });
        fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
        expect(props.onClose).not.toHaveBeenCalled();
    });

    it('closes on Escape when idle', () => {
        const { props } = renderWizard({ manualName: 'Artificial Person' });
        fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
        expect(props.onClose).toHaveBeenCalled();
    });
});

describe('accessibility', () => {
    it('has no violations on any step', async () => {
        const { container } = renderWizard({ manualName: 'Artificial Person' });
        expect((await axe(container)).violations).toEqual([]);

        fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
        expect((await axe(container)).violations).toEqual([]);

        fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
        expect((await axe(container)).violations).toEqual([]);
    });

    it('marks the current step with aria-current', () => {
        renderWizard({ manualName: 'Artificial Person' });
        expect(screen.getByText('1. Recipient')).toHaveAttribute('aria-current', 'step');
        expect(screen.getByText('2. Document details')).not.toHaveAttribute('aria-current');
    });
});
