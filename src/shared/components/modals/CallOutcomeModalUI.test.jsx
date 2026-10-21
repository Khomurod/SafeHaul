/**
 * The callback date picker starts at the recruiter's own day: by UTC, in a US
 * evening, today could not be picked. "Remind me in 1 Hour" keeps No Answer and
 * says when it will remind (the time itself: `useCallOutcome.reminder.test.js`).
 * All names are artificial.
 */
import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CallOutcomeModalUI } from './CallOutcomeModalUI';

const DETAIL_OUTCOMES = ['interested', 'callback', 'not_qualified', 'not_interested', 'hired_elsewhere'];

function Harness({ initialOutcome, reminderLabel = '', onQuickReminder = () => {} }) {
    const [outcome, setOutcome] = useState(initialOutcome);
    const [notes, setNotes] = useState('');
    const [callbackDate, setCallbackDate] = useState('');
    const [callbackTime, setCallbackTime] = useState('');
    const noop = () => {};
    return (
        <CallOutcomeModalUI
            lead={{ firstName: 'Dana', lastName: 'Driver', phone: '' }}
            onClose={noop}
            outcome={outcome}
            setOutcome={setOutcome}
            notes={notes}
            setNotes={setNotes}
            driverType=""
            setDriverType={noop}
            experienceLevel=""
            setExperienceLevel={noop}
            position=""
            setPosition={noop}
            callbackDate={callbackDate}
            setCallbackDate={setCallbackDate}
            callbackTime={callbackTime}
            setCallbackTime={setCallbackTime}
            saving={false}
            handleSave={(event) => event.preventDefault()}
            showDetailInputs={DETAIL_OUTCOMES.includes(outcome)}
            showCallbackSelect={outcome === 'callback'}
            reminderLabel={reminderLabel}
            onQuickReminder={onQuickReminder}
        />
    );
}

let zone;

beforeEach(() => {
    zone = process.env.TZ;
    process.env.TZ = 'America/Chicago';
    vi.useFakeTimers({ toFake: ['Date'] });
});

afterEach(() => {
    vi.useRealTimers();
    if (zone === undefined) delete process.env.TZ;
    else process.env.TZ = zone;
});

describe('CallOutcomeModalUI callback reminder', () => {
    it('sets the hour reminder without leaving No Answer', () => {
        const onQuickReminder = vi.fn();
        const { rerender } = render(<Harness initialOutcome="no_answer" onQuickReminder={onQuickReminder} />);

        fireEvent.click(screen.getByRole('button', { name: /Remind me in 1 Hour/ }));
        expect(onQuickReminder).toHaveBeenCalledTimes(1);

        rerender(<Harness initialOutcome="no_answer" reminderLabel="Oct 12 at 8:30 PM" />);
        expect(screen.getByRole('status')).toHaveTextContent('Reminder set for Oct 12 at 8:30 PM');
        expect(screen.queryByLabelText('Date')).toBeNull();
    });

    it('lets the recruiter pick today, their own day, as the earliest callback date', () => {
        vi.setSystemTime(new Date('2026-10-13T00:30:00Z'));
        render(<Harness initialOutcome="callback" />);

        expect(screen.getByLabelText('Date')).toHaveAttribute('min', '2026-10-12');
    });
});
