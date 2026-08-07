import React, { useMemo } from 'react';
import { CheckCircle2, Edit2, FileCheck } from 'lucide-react';
import { Button, Card, FieldDisplay } from '@/design-system/components';
import { useData } from '@/context/DataContext';
import { buildApplicationReview } from '@/config/applicationDefinition';
import { StepNavigation } from './components/StepNavigation';

/**
 * Review & confirm.
 *
 * WHAT CHANGED, AND WHY
 * ---------------------
 * This screen used to render from a hand-written list of fields with its own
 * labels, its own ordering and its own idea of what to show. Three consequences,
 * all of them visible to applicants:
 *
 *   * A question the company had HIDDEN still got a row. An application that
 *     never asked for a Social Security Number showed "SSN: Not Provided", and
 *     one with Emergency Contacts turned off showed an emergency-contact row.
 *   * Values were interpolated into template strings with no check, so a driver
 *     with no emergency contact read "undefined (undefined) - undefined" and one
 *     with no straight-truck experience read "undefined yrs".
 *   * Custom questions did not appear at all. A driver could not review the
 *     answers they had just given, and would not see a mistake until a recruiter
 *     did.
 *
 * It now renders from `buildApplicationReview`, which resolves the same section
 * table the preserved record and the PDF use. So what the driver confirms here
 * and what the record freezes a moment later are the same thing, by
 * construction, rather than by two lists agreeing.
 *
 * Preserved: the SSN masking rule (last four only — the full number appears
 * solely in the authorized original PDF), the "Confirm & Proceed" label the
 * guest specs click, and the per-section Edit control landing on the 0-based
 * wizard step.
 */

/** Which wizard step edits which part of the application. */
const STEP_BY_SECTION = {
    personal: 0,
    addressHistory: 0,
    qualifications: 1,
    license: 2,
    drivingRecord: 3,
    experience: 6,
    employment: 5,
    educationMilitary: 5,
    businessInfo: 6,
    emergencyAndDisclosures: 6,
    documents: 2,
};

/** Last four digits only. Never the whole number, on any screen. */
function maskSsn(value) {
    const digits = String(value ?? '').replace(/\D/g, '');
    if (!digits) return value;
    return `***-**-${digits.slice(-4)}`;
}

const MISSING = 'italic text-ds-content-muted';

function ReviewSection({ title, onEdit, children }) {
    return (
        <Card padding="none" className="mb-ds-6 overflow-hidden">
            <div className="flex items-center justify-between gap-ds-3 border-b border-ds-border-subtle bg-ds-surface-subtle px-ds-5 py-ds-3">
                <h2 className="text-ds-body font-bold text-ds-content">{title}</h2>
                {onEdit && (
                    <Button variant="ghost" size="md" onClick={onEdit} aria-label={`Edit ${title}`}>
                        <Edit2 size={14} aria-hidden="true" /> Edit
                    </Button>
                )}
            </div>
            <div className="p-ds-5">{children}</div>
        </Card>
    );
}

function AnswerRow({ answer }) {
    const value = answer.sensitive && !answer.isMissing ? maskSsn(answer.value) : answer.value;
    return (
        <FieldDisplay label={answer.label} className="min-w-0">
            <span className={`whitespace-pre-wrap [overflow-wrap:anywhere] ${answer.isMissing ? MISSING : ''}`}>
                {value}
            </span>
        </FieldDisplay>
    );
}

function RepeatingRows({ answer }) {
    if (answer.rows.length === 0) {
        return <p className={`text-ds-sm ${MISSING}`}>None added.</p>;
    }
    return (
        <ul className="space-y-ds-3">
            {answer.rows.map((cells, index) => (
                <li key={index} className="rounded-ds-md border border-ds-border-subtle p-ds-3">
                    <div className="grid grid-cols-1 gap-x-ds-6 gap-y-ds-2 sm:grid-cols-2">
                        {cells.map((cell) => (
                            <FieldDisplay key={cell.label} label={cell.label} className="min-w-0">
                                <span className="whitespace-pre-wrap [overflow-wrap:anywhere]">{cell.displayValue}</span>
                            </FieldDisplay>
                        ))}
                    </div>
                </li>
            ))}
        </ul>
    );
}

const Step8_Review = ({ formData, onNavigate }) => {
    const { currentCompanyProfile } = useData();

    const { sections, customAnswers } = useMemo(() => buildApplicationReview({
        applicationConfig: currentCompanyProfile?.applicationConfig,
        formData,
        customQuestions: currentCompanyProfile?.customQuestions,
    }), [currentCompanyProfile, formData]);

    return (
        <div id="page-8" className="form-step space-y-ds-8">
            <div>
                <h2 className="text-ds-heading-md font-bold text-ds-content">Review &amp; Confirm</h2>
                <p className="mt-ds-1 text-ds-content-muted">Please ensure all details are accurate before signing.</p>
            </div>

            <Card padding="md" className="flex items-start gap-ds-3 border-ds-status-success-border bg-ds-status-success-bg">
                <CheckCircle2 className="mt-ds-1 shrink-0 text-ds-status-success-fg" size={24} aria-hidden="true" />
                <div className="min-w-0">
                    <p className="font-bold text-ds-status-success-fg">Almost Done!</p>
                    <p className="mt-ds-1 text-ds-sm text-ds-status-success-fg">
                        Review your application below. If you need to make changes, tap the <strong>Edit</strong> button on any section.
                    </p>
                </div>
            </Card>

            {sections.map((section) => {
                const step = STEP_BY_SECTION[section.id];
                const scalars = section.answers.filter((answer) => !answer.repeating);
                const groups = section.answers.filter((answer) => answer.repeating);

                return (
                    <ReviewSection
                        key={section.id}
                        title={section.title}
                        onEdit={typeof step === 'number' ? () => onNavigate(step) : null}
                    >
                        {scalars.length > 0 && (
                            <div className="grid grid-cols-1 gap-x-ds-8 gap-y-ds-4 md:grid-cols-2">
                                {scalars.map((answer) => <AnswerRow key={answer.key} answer={answer} />)}
                            </div>
                        )}
                        {groups.map((answer) => (
                            <div key={answer.key} className="mt-ds-4 border-t border-ds-border-subtle pt-ds-4 first:mt-0 first:border-0 first:pt-0">
                                <h3 className="mb-ds-2 text-ds-sm font-semibold text-ds-content">{answer.label}</h3>
                                <RepeatingRows answer={answer} />
                            </div>
                        ))}
                    </ReviewSection>
                );
            })}

            {customAnswers.length > 0 && (
                <ReviewSection title="Additional Questions" onEdit={() => onNavigate(7)}>
                    <dl className="space-y-ds-4">
                        {customAnswers.map((answer) => (
                            <div key={answer.key}>
                                <dt className={`text-ds-sm font-semibold ${answer.labelUnavailable ? MISSING : 'text-ds-content'}`}>
                                    {answer.label}
                                </dt>
                                <dd className={`mt-ds-1 whitespace-pre-wrap text-ds-sm [overflow-wrap:anywhere] ${answer.isMissing ? MISSING : 'text-ds-content-secondary'}`}>
                                    {answer.value}
                                </dd>
                            </div>
                        ))}
                    </dl>
                </ReviewSection>
            )}

            <StepNavigation
                onBack={() => onNavigate('back')}
                onContinue={() => onNavigate('next')}
                continueLabel="Confirm & Proceed"
                continueIcon={<FileCheck size={18} aria-hidden="true" />}
                continueTone="success"
            />
        </div>
    );
};

export default Step8_Review;
