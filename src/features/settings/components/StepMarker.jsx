import React from 'react';
import { Check, Icon } from '@design-system/icons';

const LOOKS = {
    // The step to do now: the brand tint.
    next: 'border-ds-brand-primary bg-ds-brand-primary-subtle text-ds-brand-primary',
    // A step after it: an outline.
    later: 'border-ds-border-strong bg-ds-surface text-ds-content-secondary',
    // A step done: filled, with a check instead of its number.
    done: 'border-ds-action-primary bg-ds-action-primary text-ds-content-inverse',
};

/**
 * The numbered disc before a step a person reads, not operates (Text messages'
 * setup steps, API keys' "How it works"). Decoration: the step's own words say
 * where it stands, so the disc is hidden from assistive technology.
 *
 * Feature-owned until the design system has the "Step indicator (read, not
 * operated)" primitive (roadmap §5, open); it retires when that lands.
 */
export function StepMarker({ number, state = 'next' }) {
    return (
        <span
            aria-hidden="true"
            className={`flex h-ds-6 w-ds-6 shrink-0 items-center justify-center rounded-ds-full border text-ds-xs font-bold tabular-nums ${LOOKS[state] || LOOKS.next}`}
        >
            {state === 'done' ? <Icon icon={Check} size="sm" /> : number}
        </span>
    );
}
