import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@lib/firebase';
import { getE2EQueryParam, isE2ETestMode } from '@lib/runtime/e2eMode';
import { Loader2, Check, X, Pencil, ShieldCheck, CheckCircle2, AlertCircle } from 'lucide-react';
import { Button, Card, Input } from '@/design-system/components';

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
const ACTIONS = [
    { id: 'approve', label: 'Approve', icon: Check, activeCls: 'border-ds-status-success-border bg-ds-status-success-bg text-ds-status-success-fg' },
    { id: 'reject', label: 'Reject', icon: X, activeCls: 'border-ds-status-danger-border bg-ds-status-danger-bg text-ds-status-danger-fg' },
    { id: 'edit', label: 'Edit', icon: Pencil, activeCls: 'border-ds-status-info-border bg-ds-status-info-bg text-ds-status-info-fg' },
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
                <div className="bg-slate-900 p-6 text-white">
                    <div className="flex items-center gap-3">
                        <span className="rounded-ds-lg bg-ds-action-primary p-2">
                            <ShieldCheck size={22} aria-hidden="true" />
                        </span>
                        <div className="min-w-0">
                            <h1 className="text-lg font-bold">Review changes to your application</h1>
                            <p className="text-sm text-slate-400">Your recruiter proposed edits. Approve, reject, or fix each one.</p>
                        </div>
                    </div>
                </div>

                <div className="p-ds-6">
                    {loading ? (
                        <div role="status" className="flex items-center justify-center py-16 text-ds-content-muted">
                            <Loader2 className="mr-2 animate-spin" size={20} aria-hidden="true" /> Loading…
                        </div>
                    ) : error ? (
                        <div role="alert" className="flex items-start gap-2 rounded-ds-lg border border-ds-status-danger-border bg-ds-status-danger-bg p-ds-4 text-ds-sm text-ds-status-danger-fg">
                            <AlertCircle size={18} className="mt-0.5 shrink-0" aria-hidden="true" /> {error}
                        </div>
                    ) : done ? (
                        <div role="status" className="py-12 text-center">
                            <CheckCircle2 size={48} className="mx-auto mb-4 text-ds-status-success-fg" aria-hidden="true" />
                            <h2 className="mb-1 text-ds-heading-lg font-bold text-ds-content">Thank you!</h2>
                            <p className="text-ds-sm text-ds-content-secondary">Your responses have been recorded.</p>
                        </div>
                    ) : pending.length === 0 ? (
                        <div role="status" className="py-12 text-center">
                            <CheckCircle2 size={40} className="mx-auto mb-3 text-ds-status-success-fg" aria-hidden="true" />
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
                                        <div role="group" aria-label={`Decision for ${fieldName}`} className="flex flex-wrap gap-2">
                                            {ACTIONS.filter((a) => a.id !== 'edit' || canEdit).map((a) => {
                                                const active = r.action === a.id;
                                                const Icon = a.icon;
                                                return (
                                                    <button
                                                        key={a.id}
                                                        type="button"
                                                        aria-pressed={active}
                                                        onClick={() => setAction(c.fieldKey, a.id)}
                                                        className={`inline-flex min-h-10 items-center gap-1.5 rounded-ds-md border px-3 text-ds-sm font-semibold transition-colors focus-visible:outline-none focus-visible:shadow-ds-focus ${active ? a.activeCls : 'border-ds-border bg-ds-surface text-ds-content-secondary hover:bg-ds-surface-subtle'}`}
                                                    >
                                                        <Icon size={15} aria-hidden="true" /> {a.label}
                                                    </button>
                                                );
                                            })}
                                        </div>
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
