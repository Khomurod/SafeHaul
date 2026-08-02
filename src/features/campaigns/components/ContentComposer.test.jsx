import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { ContentComposer } from './ContentComposer';

// Capture DeviceMockup props/children so the exact type + preview content can be
// asserted without depending on the phone-frame markup (out of scope here).
vi.mock('./DeviceMockup', () => ({
    DeviceMockup: ({ type, children }) => (
        <div data-testid="device" data-type={type === undefined ? 'undefined' : type}>{children}</div>
    ),
}));

function renderComposer(messageConfig = {}) {
    const onChange = vi.fn();
    const utils = render(<ContentComposer messageConfig={messageConfig} onChange={onChange} />);
    return { onChange, ...utils };
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe('ContentComposer — method selection', () => {
    it('updates the method to sms/email while preserving the rest of the config', () => {
        const { onChange, rerender } = renderComposer({ message: 'hi', method: 'email' });

        fireEvent.click(screen.getByRole('button', { name: 'SMS' }));
        expect(onChange).toHaveBeenLastCalledWith({ message: 'hi', method: 'sms' });

        rerender(<ContentComposer messageConfig={{ message: 'hi', method: 'sms' }} onChange={onChange} />);
        fireEvent.click(screen.getByRole('button', { name: 'Email' }));
        expect(onChange).toHaveBeenLastCalledWith({ message: 'hi', method: 'email' });
    });

    it('exposes the selected channel state and an accessible group', () => {
        renderComposer({ method: 'sms' });
        const group = screen.getByRole('group', { name: 'Message channel' });
        expect(group).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'SMS' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('button', { name: 'Email' })).toHaveAttribute('aria-pressed', 'false');
    });
});

describe('ContentComposer — subject rendering & field updates', () => {
    it('renders the Subject Line only in email mode', () => {
        const { rerender, onChange } = renderComposer({ method: 'sms' });
        expect(screen.queryByLabelText('Subject Line')).not.toBeInTheDocument();

        rerender(<ContentComposer messageConfig={{ method: 'email' }} onChange={onChange} />);
        expect(screen.getByLabelText('Subject Line')).toBeInTheDocument();
        expect(screen.getByLabelText('Message Body')).toBeInTheDocument();
    });

    it('updates message and subject through onChange with a full merge', () => {
        const { onChange } = renderComposer({ method: 'email', message: '', subject: '' });

        fireEvent.change(screen.getByLabelText('Message Body'), { target: { value: 'Hello driver' } });
        expect(onChange).toHaveBeenLastCalledWith({ method: 'email', message: 'Hello driver', subject: '' });

        fireEvent.change(screen.getByLabelText('Subject Line'), { target: { value: 'New lane' } });
        expect(onChange).toHaveBeenLastCalledWith({ method: 'email', message: '', subject: 'New lane' });
    });
});

describe('ContentComposer — variable insertion', () => {
    it.each([
        ['Driver Name', '[Driver Name]'],
        ['My Company', '[Company Name]'],
        ['Recruiter Name', '[Recruiter Name]'],
    ])('inserts the exact %s value with surrounding spaces', (label, value) => {
        const { onChange } = renderComposer({ method: 'sms', message: '' });
        const textarea = screen.getByLabelText('Message Body');
        textarea.focus();
        textarea.selectionStart = 0;
        textarea.selectionEnd = 0;

        fireEvent.click(screen.getByRole('button', { name: `Insert ${label} placeholder` }));
        expect(onChange).toHaveBeenLastCalledWith({ method: 'sms', message: ` ${value} ` });
    });

    it('inserts at the caret position inside existing text', () => {
        const { onChange } = renderComposer({ method: 'sms', message: 'AB' });
        const textarea = screen.getByLabelText('Message Body');
        textarea.focus();
        textarea.selectionStart = 1;
        textarea.selectionEnd = 1;

        fireEvent.click(screen.getByRole('button', { name: 'Insert Driver Name placeholder' }));
        expect(onChange).toHaveBeenLastCalledWith({ method: 'sms', message: 'A [Driver Name] B' });
    });

    it('replaces the current selection', () => {
        const { onChange } = renderComposer({ method: 'sms', message: 'Hello World' });
        const textarea = screen.getByLabelText('Message Body');
        textarea.focus();
        textarea.selectionStart = 6;
        textarea.selectionEnd = 11; // "World"

        fireEvent.click(screen.getByRole('button', { name: 'Insert Driver Name placeholder' }));
        expect(onChange).toHaveBeenLastCalledWith({ method: 'sms', message: 'Hello  [Driver Name] ' });
    });

    it('targets the subject when email + subject is the active field', () => {
        const { onChange } = renderComposer({ method: 'email', subject: 'Hi', message: 'Body' });
        const subject = screen.getByLabelText('Subject Line');
        fireEvent.focus(subject);
        subject.selectionStart = 2;
        subject.selectionEnd = 2;

        fireEvent.click(screen.getByRole('button', { name: 'Insert My Company placeholder' }));
        expect(onChange).toHaveBeenLastCalledWith(
            expect.objectContaining({ subject: 'Hi [Company Name] ' }),
        );
    });

    it('targets the message when email + message is the active field', () => {
        const { onChange } = renderComposer({ method: 'email', subject: 'Hi', message: 'Body' });
        const message = screen.getByLabelText('Message Body');
        fireEvent.focus(message);
        message.selectionStart = 4;
        message.selectionEnd = 4;

        fireEvent.click(screen.getByRole('button', { name: 'Insert My Company placeholder' }));
        expect(onChange).toHaveBeenLastCalledWith(
            expect.objectContaining({ message: 'Body [Company Name] ' }),
        );
    });

    it('appends to the end when the selection API is unavailable', () => {
        const { onChange } = renderComposer({ method: 'sms', message: 'AB' });
        const textarea = screen.getByLabelText('Message Body');
        Object.defineProperty(textarea, 'selectionStart', { configurable: true, get: () => undefined });

        fireEvent.click(screen.getByRole('button', { name: 'Insert Driver Name placeholder' }));
        expect(onChange).toHaveBeenLastCalledWith({ method: 'sms', message: 'AB [Driver Name] ' });
    });

    it('restores focus and caret to the edited field after insertion', async () => {
        renderComposer({ method: 'sms', message: 'AB' });
        const textarea = screen.getByLabelText('Message Body');
        textarea.focus();
        textarea.selectionStart = 1;
        textarea.selectionEnd = 1;
        const focusSpy = vi.spyOn(textarea, 'focus');
        const rangeSpy = vi.spyOn(textarea, 'setSelectionRange');

        fireEvent.click(screen.getByRole('button', { name: 'Insert Driver Name placeholder' }));

        // insertion = " [Driver Name] " (length 15) → caret = 1 + 15 = 16.
        await waitFor(() => expect(focusSpy).toHaveBeenCalled());
        expect(rangeSpy).toHaveBeenCalledWith(16, 16);
    });
});

describe('ContentComposer — preview, count, and copy', () => {
    it('passes the method as the DeviceMockup type and shows the message preview', () => {
        const { rerender, onChange } = renderComposer({ method: 'email', message: 'Preview text' });
        const device = screen.getByTestId('device');
        expect(device).toHaveAttribute('data-type', 'email');
        expect(device).toHaveTextContent('Preview text');

        rerender(<ContentComposer messageConfig={{ method: 'sms' }} onChange={onChange} />);
        expect(screen.getByTestId('device')).toHaveAttribute('data-type', 'sms');
        expect(screen.getByText('Type something to see a preview...')).toBeInTheDocument();
    });

    it('shows an accessible character count of the message length', () => {
        const { rerender, onChange } = renderComposer({ method: 'sms', message: 'Hello' });
        const count = screen.getByText(/5 chars/);
        expect(count).toHaveAttribute('aria-live', 'polite');
        expect(count).toHaveTextContent('Message length: 5 chars');

        rerender(<ContentComposer messageConfig={{ method: 'sms' }} onChange={onChange} />);
        expect(screen.getByText(/0 chars/)).toBeInTheDocument();
    });

    it('uses the method-specific message placeholder', () => {
        const { rerender, onChange } = renderComposer({ method: 'sms' });
        expect(screen.getByPlaceholderText('Hey [Driver Name], we have a new lane open...')).toBeInTheDocument();

        rerender(<ContentComposer messageConfig={{ method: 'email' }} onChange={onChange} />);
        expect(screen.getByPlaceholderText('Dear [Driver Name]...')).toBeInTheDocument();
        expect(screen.getByPlaceholderText('e.g. Unique Opportunity for [Driver Name]')).toBeInTheDocument();
    });

    it('keeps the Pro Tips copy', () => {
        renderComposer({ method: 'sms' });
        expect(screen.getByText('Content Strategy')).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: /Pro Tips/ })).toBeInTheDocument();
        expect(screen.getByText('Keep SMS under 160 characters to avoid splitting.')).toBeInTheDocument();
        expect(screen.getByText('End with a clear question to prompt a reply.')).toBeInTheDocument();
    });

    it('has no accessibility violations in email mode', async () => {
        // page-has-heading-one is scoped out: this composer renders inside the
        // CampaignEditor page (which owns the h1) in the app.
        const { container } = renderComposer({ method: 'email', message: 'Hi', subject: 'Hello' });
        const results = await axe(container, { rules: { 'page-has-heading-one': { enabled: false } } });
        expect(results.violations).toEqual([]);
    });
});
