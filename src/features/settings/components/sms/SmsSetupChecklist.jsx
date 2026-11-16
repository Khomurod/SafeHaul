import React from 'react';
import { FormSection } from '@/design-system/components';
import { StepMarker } from '../StepMarker';

/**
 * The steps to set up text messaging, in order, each marked done or not, as
 * one flush card under its own heading. The first step not done is the next
 * one: its number is tinted, the later ones are outlined and a done one is a
 * check. The page supplies the words and any action under a step; this draws
 * them.
 */
export function SmsSetupChecklist({ steps }) {
    const currentId = steps.find((step) => !step.done)?.id;
    return (
        <FormSection layout="stacked" padding="none" title="Set up in four steps">
            <ol aria-label="Setup steps" className="divide-y divide-ds-border-subtle">
                {steps.map((step, index) => {
                    const state = step.done ? 'done' : step.id === currentId ? 'next' : 'later';
                    return (
                        <li key={step.id} className="flex items-start gap-ds-3 p-ds-4 md:px-ds-5">
                            <StepMarker number={index + 1} state={state} />
                            <div className="min-w-0 flex-1">
                                <h3 className="text-ds-body font-semibold text-ds-content">
                                    {step.title}
                                    <span className="sr-only">{step.done ? ' (done)' : ' (to do)'}</span>
                                </h3>
                                <p className="mt-ds-1 max-w-[80ch] text-ds-body text-ds-content-secondary [text-wrap:pretty]">
                                    {step.description}
                                </p>
                                {step.actions && (
                                    // Side by side at a desk; on a phone each takes the text column's width.
                                    <div className="mt-ds-3 grid gap-ds-2 md:flex md:flex-wrap">{step.actions}</div>
                                )}
                            </div>
                        </li>
                    );
                })}
            </ol>
        </FormSection>
    );
}
