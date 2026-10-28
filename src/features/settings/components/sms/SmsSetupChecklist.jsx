import React from 'react';
import { Badge, Card, StatusMedallion } from '@/design-system/components';
import { Icon, Check, CheckCircle } from '@design-system/icons';

/**
 * The steps to set up text messaging, in order, each marked done or not. The
 * first step not done is the current one. The page supplies the words and any
 * action under a step; this draws them.
 */
export function SmsSetupChecklist({ steps }) {
    const currentId = steps.find((step) => !step.done)?.id;
    return (
        <Card padding="none" className="overflow-hidden">
            <ol aria-label="Setup steps" className="divide-y divide-ds-border-subtle">
                {steps.map((step, index) => {
                    const isCurrent = step.id === currentId;
                    return (
                        <li key={step.id} className="flex items-start gap-ds-3 px-ds-4 py-ds-4">
                            <StatusMedallion tone={step.done ? 'success' : isCurrent ? 'info' : 'neutral'}>
                                {step.done
                                    ? <Icon icon={Check} />
                                    : <span aria-hidden="true" className="text-ds-sm font-semibold">{index + 1}</span>}
                            </StatusMedallion>
                            <div className="min-w-0 flex-1">
                                <h2 className={`font-semibold ${step.done || isCurrent ? 'text-ds-content' : 'text-ds-content-secondary'}`}>
                                    {step.title}
                                    <span className="sr-only">{step.done ? ' (done)' : ' (to do)'}</span>
                                </h2>
                                <p className="text-ds-sm text-ds-content-muted">{step.description}</p>
                                {step.actions && <div className="mt-ds-3 flex flex-wrap gap-ds-2">{step.actions}</div>}
                            </div>
                            {step.done && (
                                <span className="shrink-0" aria-hidden="true">
                                    <Badge tone="success" icon={CheckCircle}>Done</Badge>
                                </span>
                            )}
                        </li>
                    );
                })}
            </ol>
        </Card>
    );
}
