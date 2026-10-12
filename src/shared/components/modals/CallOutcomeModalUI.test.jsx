/**
 * The callback reminder is set on the recruiter's own day.
 *
 * "Remind me in 1 Hour" took the date by UTC and the time by the local clock,
 * so a US evening call scheduled the callback a day late. The date picker's
 * earliest day was today by UTC too, so in a US evening today could not be
 * picked. All names are artificial.
 */
import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CallOutcomeModalUI } from './CallOutcomeModalUI';

const DETAIL_OUTCOMES = ['interested', 'callback', 'not_qualified', 'not_interested', 'hired_elsewhere'];

function Harness({ initialOutcome }) {
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
    it('reminds an hour from now on the recruiter\'s own day', () => {
        // 7:30 pm on 12 October in Chicago, 00:30 on 13 October in UTC.
        vi.setSystemTime(new Date('2026-10-13T00:30:00Z'));
        render(<Harness initialOutcome="no_answer" />);

        fireEvent.click(screen.getByRole('button', { name: /Remind me in 1 Hour/ }));

        expect(screen.getByLabelText('Date')).toHaveValue('2026-10-12');
        expect(screen.getByLabelText('Time')).toHaveValue('20:30');
    });

    it('moves the reminder to tomorrow when the hour crosses local midnight', () => {
        // 11:30 pm on 12 October in Chicago.
        vi.setSystemTime(new Date('2026-10-13T04:30:00Z'));
        render(<Harness initialOutcome="no_answer" />);

        fireEvent.click(screen.getByRole('button', { name: /Remind me in 1 Hour/ }));

        expect(screen.getByLabelText('Date')).toHaveValue('2026-10-13');
        expect(screen.getByLabelText('Time')).toHaveValue('00:30');
    });

    it('lets the recruiter pick today, their own day, as the earliest callback date', () => {
        vi.setSystemTime(new Date('2026-10-13T00:30:00Z'));
        render(<Harness initialOutcome="callback" />);

        expect(screen.getByLabelText('Date')).toHaveAttribute('min', '2026-10-12');
    });
});
