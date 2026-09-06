import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@lib/firebase';
import { getE2EQueryParam, isE2ETestMode } from '@lib/runtime/e2eMode';
import { Icon, Loader2, Check, X, Pencil, ShieldCheck, CheckCircle2 } from '@design-system/icons';
import { Button, Card, Input, Notice, SegmentedControl, StatusMedallion } from '@/design-system/components';

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

export function ReviewChangePortal() {
    const { token } = useParams();
    const isMock = isE2ETestMode && getE2EQueryParam('e2eReview', '') === 'mock';

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [data, setData] = useState(null);
    const [resolutions, setResolutions] = useState({});
    const [submitting, setSubmitting] = useState(false);
    const [done, setDone] = useState(false);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            setLoading(true);
            setError('');
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
                const init = {};
                (res.changes || []).filter((c) => c.status === 'pending').forEach((c) => {
                    init[c.fieldKey] = { action: 'approve', value: isScalar(c.proposedValue) ? String(c.proposedValue ?? '') : c.proposedValue };
                });
                setResolutions(init);
            } catch (e) {
                if (!cancelled) setError(e?.message || 'This review link is invalid or has expired.');
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [token, isMock]);

    const setAction = (fieldKey, action) => setResolutions((p) => ({ ...p, [fieldKey]: { ...p[fieldKey], action } }));
    const setValue = (fieldKey, value) => setResolutions((p) => ({ ...p, [fieldKey]: { ...p[fieldKey], value } }));

    const pending = (data?.changes || []).filter((c) => c.status === 'pending');

    const handleSubmit = async () => {
        const payload = pending.map((c) => {
            const r = resolutions[c.fieldKey] || { action: 'approve' };
            const out = { fieldKey: c.fieldKey, action: r.action };
            if (r.action === 'edit') out.value = isScalar(c.proposedValue) ? r.value : c.proposedValue;
            return out;
        });
        setSubmitting(true);
        setError('');
        try {
            if (!isMock) {
                const fn = httpsCallable(functions, 'submitChangeResolution');
                await fn({ token, resolutions: payload });
            }
            setDone(true);
        } catch (e) {
            setError(e?.message || 'Could not submit your review. Please try again.');
        } finally {
            setSubmitting(false);
        }
    };

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
                            <p className="text-ds-body text-ds-content-on-inverse-muted">Your recruiter proposed edits. Approve, reject, or fix each one.</p>
                        </div>
                    </div>
                </div>

                <div className="p-ds-6">
                    {loading ? (
                        <div role="status" className="flex items-center justify-center py-16 text-ds-content-muted">
                            <Icon icon={Loader2} size="xl" className="mr-2 animate-spin" /> Loading…
                        </div>
                    ) : error ? (
                        <Notice announce="assertive" tone="danger">{error}</Notice>
                    ) : done ? (
                        <div role="status" className="py-12 text-center">
                            <StatusMedallion tone="success" className="mx-auto mb-ds-4">
                                <Icon icon={CheckCircle2} />
                            </StatusMedallion>
                            <h2 className="mb-1 text-ds-heading-lg font-bold text-ds-content">Thank you!</h2>
                            <p className="text-ds-sm text-ds-content-secondary">Your responses have been recorded.</p>
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
                                const r = resolutions[c.fieldKey] || { action: 'approve' };
                                const canEdit = isScalar(c.proposedValue) && isScalar(c.originalValue);
                                const fieldName = c.fieldLabel || c.fieldKey;
                                return (
                                    <div key={c.fieldKey} className="rounded-ds-lg border border-ds-border p-ds-4">
                                        <p className="mb-2 text-ds-xs font-bold uppercase tracking-wide text-ds-content-muted">{fieldName}</p>
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

                            <Button type="button" variant="primary" size="lg" fullWidth loading={submitting} onClick={handleSubmit}>
                                Submit my responses
                            </Button>
                            <p role="status" className="ds-visually-hidden">
                                {submitting ? 'Submitting your responses…' : ''}
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
