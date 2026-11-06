import React, { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@lib/firebase';
import { getE2EQueryParam, isE2ETestMode } from '@lib/runtime/e2eMode';
import { serverMessageOf } from '@shared/utils/callableErrors';
import { LinkProblemScreen, isRetryableLinkProblem, linkProblemFromError } from '@shared/components/public-link';
import { Icon, Loader2, Check, X, Pencil, ShieldCheck, CheckCircle2 } from '@design-system/icons';
import { Button, Card, Input, Notice, SegmentedControl, StatusMedallion } from '@/design-system/components';
import { isEmployerChange, summarizeEmployerChange } from './employerChangeSummary';

const MOCK_REVIEW = {
    applicantName: 'Test Driver',
    status: 'open',
    changes: [
        { fieldKey: 'firstName', fieldLabel: 'First Name', originalValue: 'John', proposedValue: 'Jonathan', status: 'pending' },
        { fieldKey: 'phone', fieldLabel: 'Phone', originalValue: '5551112222', proposedValue: '5559998888', status: 'pending' },
    ],
};

function previewValue(v) {
    if (v === null || v === undefined || v === '') return '—';
    if (typeof v === 'object') return Array.isArray(v) ? `${v.length} item(s)` : '(updated)';
    return String(v);
}
const isScalar = (v) => v === null || v === undefined || typeof v !== 'object';

/**
 * The employment history, as something a driver can actually decide about.
 *
 * `previewValue` renders any array as "N item(s)", so this change used to read
 * **"2 item(s) → 1 item(s)"** — and the one thing the driver needs to know is
 * WHICH employer went. 49 CFR 391.21(b)(10) makes that consequential: the
 * application has to account for three years, and the row the recruiter removed
 * may be the reason it does.
 *
 * Rows are matched by the stable `employerId`, so a renamed employer reads as a
 * change rather than as a removal plus an addition — which is exactly the
 * distinction being approved. See `employerChangeSummary.js`.
 */
function EmployerChangeSummary({ originalValue, proposedValue }) {
    const { added, removed, changed, unchanged } = summarizeEmployerChange(originalValue, proposedValue);
    const nothing = added.length === 0 && removed.length === 0 && changed.length === 0;

    if (nothing) {
        return (
            <p className="mb-3 text-ds-sm text-ds-content-muted">
                The employers on your application are unchanged.
            </p>
        );
    }

    return (
        <div className="mb-3 space-y-2 text-ds-sm">
            {removed.length > 0 && (
                <div>
                    <p className="text-ds-xs font-semibold uppercase text-ds-content-muted">Removed</p>
                    <ul className="list-disc pl-5">
                        {removed.map((entry) => (
                            <li key={`removed-${entry.label}`} className="text-ds-content">{entry.label}</li>
                        ))}
                    </ul>
                </div>
            )}
            {added.length > 0 && (
                <div>
                    <p className="text-ds-xs font-semibold uppercase text-ds-content-muted">Added</p>
                    <ul className="list-disc pl-5">
                        {added.map((entry) => (
                            <li key={`added-${entry.label}`} className="text-ds-content">{entry.label}</li>
                        ))}
                    </ul>
                </div>
            )}
            {changed.map((entry) => (
                <div key={`changed-${entry.label}`}>
                    <p className="text-ds-xs font-semibold uppercase text-ds-content-muted">{entry.label}</p>
                    <ul className="list-disc pl-5">
                        {entry.fields.map((field) => (
                            <li key={field.label} className="text-ds-content">
                                {`${field.label}: `}
                                <span className="line-through text-ds-content-muted">{field.from || '—'}</span>
                                <span aria-hidden="true">{' → '}</span>
                                <span className="font-semibold">{field.to || '—'}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            ))}
            {unchanged > 0 && (
                <p className="text-ds-xs text-ds-content-muted">
                    {`${unchanged} other employer${unchanged === 1 ? '' : 's'} unchanged.`}
                </p>
            )}
        </div>
    );
}

// Feature-owned segmented decision control. Active tone uses semantic status
// tokens; icon + label + aria-pressed carry the state (not colour alone).
/*
 * Decision → semantic tone. The feature owns which decision is a success and
 * which is a danger; `SegmentedControl` owns what those look like.
 *
 * The local `activeCls` strings that used to live here were the third copy of the
 * same six-tone map in the product, on buttons that were also `min-h-10` — 40px,
 * which is not a step on the 36/44/52 control scale at all.
 */
const ACTIONS = [
    { id: 'approve', label: 'Approve', icon: Check, tone: 'success' },
    { id: 'reject', label: 'Reject', icon: X, tone: 'danger' },
    { id: 'edit', label: 'Edit', icon: Pencil, tone: 'info' },
];

const KEPT = 'Your choices are still on this page';

/**
 * Where a failed submission leaves the driver. A refusal of the link itself in
 * the server's words (expired, replaced by a newer link, already complete, gone)
 * ends the review on the public pages' shared link screen; anything else keeps
 * every choice for Try again.
 */
function submitFailure(e) {
    const said = serverMessageOf(e);
    switch (e?.code) {
        case 'functions/failed-precondition':
        case 'functions/not-found':
            if (said) return { endsLink: true };
            break;
        case 'functions/invalid-argument':
        case 'functions/resource-exhausted':
            if (said) return { message: `Your responses were not sent: ${said} ${KEPT}.` };
            break;
        default:
            break;
    }
    return { message: `Your responses were not sent. ${KEPT}: check your connection and try again.` };
}

/** One change's decision, as its own Approve, Reject or Edit sets it. */
const withAction = (resolutions, fieldKey, action) => ({
    ...resolutions,
    [fieldKey]: { ...resolutions[fieldKey], action },
});

const plural = (n, one, many) => (n === 1 ? one : many);

export function ReviewChangePortal() {
    const { token } = useParams();
    const isMock = isE2ETestMode && getE2EQueryParam('e2eReview', '') === 'mock';

    const [loading, setLoading] = useState(true);
    // The link itself failed, `{ reason, detail? }`: the shared link screen replaces the review.
    const [linkProblem, setLinkProblem] = useState(null);
    // Bumped to load the review again: Try again on a link that could not be
    // checked, or changes that arrived while the page was open.
    const [attempt, setAttempt] = useState(0);
    const [data, setData] = useState(null);
    const [resolutions, setResolutions] = useState({});
    const [submitting, setSubmitting] = useState(false);
    // The send in flight is Approve all's, for what the page announces.
    const [sendingAll, setSendingAll] = useState(false);
    const [submitError, setSubmitError] = useState('');
    // Submit pressed with a change still undecided; each press moves focus to the list.
    const [undecidedAttempts, setUndecidedAttempts] = useState(0);
    const undecidedRef = useRef(null);
    // The responses were recorded: `{ remaining }`, the changes still waiting
    // (ones proposed after this page loaded, which the driver has not seen).
    const [done, setDone] = useState(null);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            setLoading(true);
            setLinkProblem(null);
            try {
                let res;
                if (isMock) {
                    res = MOCK_REVIEW;
                } else {
                    const fn = httpsCallable(functions, 'getChangeReview');
                    const r = await fn({ token });
                    res = r.data;
                }
                if (cancelled) return;
                setData(res);
                // No decision is made for the driver: approving is something
                // they do, change by change or all at once, on every visit.
                const init = {};
                (res.changes || []).filter((c) => c.status === 'pending').forEach((c) => {
                    init[c.fieldKey] = { action: null, value: isScalar(c.proposedValue) ? String(c.proposedValue ?? '') : c.proposedValue };
                });
                setResolutions(init);
            } catch (e) {
                console.error('Review link error:', e);
                if (!cancelled) setLinkProblem(linkProblemFromError(e, 'This review link could not be opened.'));
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [token, isMock, attempt]);

    const setAction = (fieldKey, action) => setResolutions((p) => withAction(p, fieldKey, action));
    const setValue = (fieldKey, value) => setResolutions((p) => ({ ...p, [fieldKey]: { ...p[fieldKey], value } }));

    const pending = (data?.changes || []).filter((c) => c.status === 'pending');
    const undecided = pending.filter((c) => !resolutions[c.fieldKey]?.action);
    // Approve all is offered for several changes, and only while the driver has
    // chosen nothing but Approve: it must never overturn a Reject or an Edit.
    const canApproveAll = pending.length > 1
        && pending.every((c) => [null, undefined, 'approve'].includes(resolutions[c.fieldKey]?.action));

    useEffect(() => {
        if (undecidedAttempts > 0) undecidedRef.current?.focus();
    }, [undecidedAttempts]);

    const reload = () => {
        setLoading(true);
        setLinkProblem(null);
        setDone(null);
        setSubmitError('');
        setUndecidedAttempts(0);
        setAttempt((n) => n + 1);
    };

    /**
     * Sends one decision per pending change, in one call: the server checks each
     * on its own (still pending, employers re-attached by identity) and records
     * them together or not at all, so a send never half-lands.
     */
    const send = async (decided, { all = false } = {}) => {
        const payload = pending.map((c) => {
            const r = decided[c.fieldKey];
            const out = { fieldKey: c.fieldKey, action: r.action };
            if (r.action === 'edit') out.value = isScalar(c.proposedValue) ? r.value : c.proposedValue;
            return out;
        });
        setSubmitting(true);
        setSendingAll(all);
        setSubmitError('');
        try {
            let remaining = 0;
            if (!isMock) {
                const fn = httpsCallable(functions, 'submitChangeResolution');
                const r = await fn({ token, resolutions: payload });
                remaining = Number(r?.data?.remaining) || 0;
            }
            setDone({ remaining });
        } catch (e) {
            const failure = submitFailure(e);
            if (failure.endsLink) setLinkProblem(linkProblemFromError(e));
            else setSubmitError(failure.message);
        } finally {
            setSubmitting(false);
        }
    };

    const handleSubmit = () => {
        if (undecided.length > 0) {
            setUndecidedAttempts((n) => n + 1);
            return;
        }
        send(resolutions);
    };

    /**
     * Approve on every change, exactly as pressing each one's Approve, then the
     * same send as Submit. The page keeps showing each change approved, so a
     * failed send's Try again sends the same approvals.
     */
    const handleApproveAll = () => {
        const approved = pending.reduce((acc, c) => withAction(acc, c.fieldKey, 'approve'), resolutions);
        setResolutions(approved);
        send(approved, { all: true });
    };

    if (linkProblem) {
        return (
            <LinkProblemScreen
                reason={linkProblem.reason}
                detail={linkProblem.detail}
                onRetry={isRetryableLinkProblem(linkProblem.reason) ? reload : undefined}
            />
        );
    }

    return (
        <div className="flex min-h-screen items-start justify-center bg-ds-canvas p-4 sm:p-6">
            <Card as="main" padding="none" className="my-6 w-full max-w-xl overflow-hidden">
                {/* An inverse masthead, on the same roles as the other dark
                    surfaces in the product. */}
                <div className="bg-ds-surface-inverse p-ds-6 text-ds-content-on-inverse">
                    <div className="flex items-center gap-ds-3">
                        {/* A tinted icon tile — the shape the roadmap records as
                            open and deliberately un-owned. Not a medallion: that
                            is circular and carries a status tone, and this is a
                            square on the primary action colour. The glyph was 22,
                            which is not a step; 24 is, and two pixels was never a
                            decision anyone made. */}
                        <span aria-hidden="true" className="rounded-ds-lg bg-ds-action-primary p-ds-2">
                            <Icon icon={ShieldCheck} size="2xl" />
                        </span>
                        <div className="min-w-0">
                            <h1 className="text-ds-heading-md font-bold">Review changes to your application</h1>
                            {/* The review link carries no company name (getChangeReview
                                returns none), so the sentence names the role. */}
                            <p className="text-ds-body text-ds-content-on-inverse-muted">The company you applied to proposed these changes. Approve, reject, or fix each one.</p>
                        </div>
                    </div>
                </div>

                <div className="p-ds-6">
                    {loading ? (
                        <div role="status" className="flex items-center justify-center py-16 text-ds-content-muted">
                            <Icon icon={Loader2} size="xl" className="mr-2 animate-spin" /> Loading…
                        </div>
                    ) : done ? (
                        <div role="status" className="py-12 text-center">
                            <StatusMedallion tone="success" className="mx-auto mb-ds-4">
                                <Icon icon={CheckCircle2} />
                            </StatusMedallion>
                            <h2 className="mb-1 text-ds-heading-lg font-bold text-ds-content">Thank you!</h2>
                            <p className="text-ds-sm text-ds-content-secondary">Your responses have been recorded.</p>
                            {/* Inside the status, so it is heard with the thanks. */}
                            {done.remaining > 0 && (
                                <Notice
                                    tone="info"
                                    className="mt-ds-6"
                                    actions={(
                                        <Button size="sm" variant="secondary" onClick={reload}>
                                            {plural(done.remaining, 'Review it', 'Review them')}
                                        </Button>
                                    )}
                                >
                                    {`${done.remaining} more ${plural(done.remaining, 'change was', 'changes were')} proposed `
                                        + `after you opened this page and ${plural(done.remaining, 'still needs', 'still need')} your decision.`}
                                </Notice>
                            )}
                        </div>
                    ) : pending.length === 0 ? (
                        <div role="status" className="py-12 text-center">
                            <StatusMedallion tone="success" className="mx-auto mb-ds-3">
                                <Icon icon={CheckCircle2} />
                            </StatusMedallion>
                            <p className="text-ds-sm text-ds-content-secondary">There are no changes left to review.</p>
                        </div>
                    ) : (
                        <div className="space-y-5">
                            {pending.map((c) => {
                                const r = resolutions[c.fieldKey] || {};
                                const canEdit = isScalar(c.proposedValue) && isScalar(c.originalValue);
                                const fieldName = c.fieldLabel || c.fieldKey;
                                return (
                                    <div key={c.fieldKey} className="rounded-ds-lg border border-ds-border p-ds-4">
                                        <p className="mb-2 text-ds-xs font-bold uppercase tracking-wide text-ds-content-muted">{fieldName}</p>
                                        {isEmployerChange(c.fieldKey) ? (
                                            <EmployerChangeSummary
                                                originalValue={c.originalValue}
                                                proposedValue={c.proposedValue}
                                            />
                                        ) : (
                                            <div className="mb-3 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-ds-sm">
                                                <span className="text-ds-content-muted">
                                                    <span className="text-ds-xs font-semibold uppercase">Current: </span>
                                                    <span className="line-through">{previewValue(c.originalValue)}</span>
                                                </span>
                                                <span aria-hidden="true" className="text-ds-content-muted">→</span>
                                                <span className="text-ds-content">
                                                    <span className="text-ds-xs font-semibold uppercase text-ds-content-muted">Proposed: </span>
                                                    <span className="font-semibold">{previewValue(c.proposedValue)}</span>
                                                </span>
                                            </div>
                                        )}
                                        <SegmentedControl
                                            ariaLabel={`Decision for ${fieldName}`}
                                            columns={canEdit ? 3 : 2}
                                            value={r.action || null}
                                            onChange={(value) => setAction(c.fieldKey, value)}
                                            options={ACTIONS
                                                .filter((a) => a.id !== 'edit' || canEdit)
                                                .map((a) => ({
                                                    value: a.id,
                                                    label: a.label,
                                                    icon: a.icon,
                                                    tone: a.tone,
                                                }))}
                                        />
                                        {r.action === 'edit' && canEdit && (
                                            <Input
                                                type="text"
                                                value={r.value ?? ''}
                                                onChange={(e) => setValue(c.fieldKey, e.target.value)}
                                                aria-label={`Corrected value for ${fieldName}`}
                                                className="mt-3"
                                                placeholder="Enter the correct value"
                                            />
                                        )}
                                    </div>
                                );
                            })}

                            {undecidedAttempts > 0 && undecided.length > 0 && (
                                <Notice
                                    ref={undecidedRef}
                                    tabIndex={-1}
                                    tone="danger"
                                    announce="assertive"
                                    title="Choose a decision for each change"
                                >
                                    {`Still to decide: ${undecided.map((c) => c.fieldLabel || c.fieldKey).join(', ')}.`}
                                </Notice>
                            )}
                            {submitError && !submitting && (
                                <Notice
                                    tone="danger"
                                    announce="assertive"
                                    actions={<Button size="sm" variant="secondary" onClick={handleSubmit}>Try again</Button>}
                                >
                                    {submitError}
                                </Notice>
                            )}
                            {canApproveAll && (
                                <Button
                                    type="button"
                                    variant="secondary"
                                    size="lg"
                                    fullWidth
                                    loading={submitting && sendingAll}
                                    disabled={submitting}
                                    onClick={handleApproveAll}
                                >
                                    <Icon icon={Check} size="xl" />
                                    {`Approve all ${pending.length} changes`}
                                </Button>
                            )}
                            <Button type="button" variant="primary" size="lg" fullWidth loading={submitting && !sendingAll} disabled={submitting} onClick={handleSubmit}>
                                Submit my responses
                            </Button>
                            <p role="status" className="ds-visually-hidden">
                                {submitting
                                    ? (sendingAll ? `Approving all ${pending.length} changes…` : 'Submitting your responses…')
                                    : ''}
                            </p>
                            <p className="text-center text-ds-xs text-ds-content-muted">
                                Approved or your edited values become part of your application. Rejected changes keep your original answer.
                            </p>
                        </div>
                    )}
                </div>
            </Card>
        </div>
    );
}

export default ReviewChangePortal;
