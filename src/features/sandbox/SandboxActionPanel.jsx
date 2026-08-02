import React, { useCallback, useEffect, useId, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { useNavigate } from 'react-router-dom';
import { functions } from '@lib/firebase';
import { useData } from '@/context/DataContext';
import { Loader2, Trash2, ArrowRightCircle, ShieldAlert } from 'lucide-react';
import { Button, Card, FormField, Select, StatusMedallion } from '@/design-system/components';

/**
 * Post-submit actions for sandbox applications. Delete / transfer require Super Admin (callable enforces).
 *
 * Presentation migrated to the approved `Card` / `Button` / `FormField` /
 * `Select` / `StatusMedallion` primitives and `--ds-*` tokens (2026-07-27).
 * The `listSandboxTenantCompanies`, `deleteSandboxApplication` and
 * `transferSandboxApplication` callables, their exact payloads, the Super Admin
 * claim check, the `/sandbox/transfer-success` navigation state, and the
 * `onDeletedRestart` / `onTransferComplete` callbacks are unchanged.
 *
 * DEFECTS FIXED (2026-07-27): the panel was not a `<main>` landmark and opened
 * at `<h2>` with no `<h1>`; the transfer `<label>` was not bound to the select;
 * and the error text was not announced.
 */
export function SandboxActionPanel({
  applicationId,
  confirmationNumber,
  onDeletedRestart,
  onTransferComplete,
}) {
  const navigate = useNavigate();
  const headingId = `sandbox-actions-${useId().replace(/:/g, '')}`;
  const { currentUserClaims } = useData();
  const isSuperAdmin =
    currentUserClaims?.roles?.globalRole === 'super_admin' ||
    currentUserClaims?.globalRole === 'super_admin';

  const [companies, setCompanies] = useState([]);
  const [loadingList, setLoadingList] = useState(false);
  const [targetId, setTargetId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const loadCompanies = useCallback(async () => {
    if (!isSuperAdmin) return;
    setLoadingList(true);
    setError('');
    try {
      const fn = httpsCallable(functions, 'listSandboxTenantCompanies');
      const { data } = await fn({});
      setCompanies(data?.companies || []);
    } catch (e) {
      console.error(e);
      setError(e?.message || 'Could not load companies.');
    } finally {
      setLoadingList(false);
    }
  }, [isSuperAdmin]);

  useEffect(() => {
    loadCompanies();
  }, [loadCompanies]);

  const handleDelete = async () => {
    if (!isSuperAdmin || !applicationId) return;
    setBusy(true);
    setError('');
    try {
      const fn = httpsCallable(functions, 'deleteSandboxApplication');
      await fn({ applicationId });
      onDeletedRestart?.();
    } catch (e) {
      console.error(e);
      setError(e?.message || 'Delete failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleTransfer = async () => {
    if (!isSuperAdmin || !applicationId || !targetId) return;
    setBusy(true);
    setError('');
    try {
      const fn = httpsCallable(functions, 'transferSandboxApplication');
      const { data } = await fn({ applicationId, targetCompanyId: targetId });
      onTransferComplete?.(data);
      navigate('/sandbox/transfer-success', {
        state: {
          companyName: data?.companyName,
          companyId: data?.companyId,
          applicationId: data?.applicationId,
        },
      });
    } catch (e) {
      console.error(e);
      setError(e?.message || 'Transfer failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main
      aria-labelledby={headingId}
      className="flex min-h-screen items-center justify-center bg-ds-canvas p-ds-4"
    >
      <Card padding="lg" className="w-full max-w-lg space-y-ds-6">
        <div className="flex items-start gap-ds-3">
          <StatusMedallion tone="warning"><ShieldAlert className="h-6 w-6" /></StatusMedallion>
          <div className="min-w-0">
            <h1 id={headingId} className="text-ds-heading-sm font-bold text-ds-content">Sandbox submission complete</h1>
            <p className="mt-ds-1 text-ds-sm text-ds-content-secondary">
              Application saved under tenant <code className="rounded-ds-sm bg-ds-surface-subtle px-ds-1 text-ds-xs">SANDBOX</code>.
              Use the actions below (Super Admin) to clean up or move this record into a live pipeline.
            </p>
          </div>
        </div>

        {confirmationNumber && (
          <div className="rounded-ds-md border border-ds-border-subtle bg-ds-surface-subtle px-ds-4 py-ds-3">
            <p className="text-ds-xs uppercase tracking-wide text-ds-content-secondary">Confirmation</p>
            <p className="font-mono font-semibold text-ds-content [overflow-wrap:anywhere]">{confirmationNumber}</p>
            <p className="mt-ds-1 text-ds-xs text-ds-content-secondary [overflow-wrap:anywhere]">Application id: {applicationId}</p>
          </div>
        )}

        {!isSuperAdmin && (
          <p className="rounded-ds-md border border-ds-status-warning-border bg-ds-status-warning-bg px-ds-4 py-ds-3 text-ds-sm text-ds-status-warning-fg">
            Sign in as a Super Admin to delete or transfer this test application.
          </p>
        )}

        {error && (
          <p
            role="alert"
            className="rounded-ds-md border border-ds-status-danger-border bg-ds-status-danger-bg px-ds-4 py-ds-3 text-ds-sm text-ds-status-danger-fg [overflow-wrap:anywhere]"
          >
            {error}
          </p>
        )}

        <div className="space-y-ds-4">
          <div className="space-y-ds-3">
            <FormField id="sandbox-transfer-target" label="Transfer to company">
              {loadingList ? (
                /* The select is not rendered yet, so `FormField` still needs one
                   control child; a disabled placeholder keeps the label bound to
                   something and the loading state announced. */
                <Select disabled aria-busy="true">
                  <option value="">Loading tenants…</option>
                </Select>
              ) : (
                <Select
                  value={targetId}
                  onChange={(e) => setTargetId(e.target.value)}
                  disabled={!isSuperAdmin || busy}
                >
                  <option value="">Select active company…</option>
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.companyName} ({c.id})
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
            {loadingList && (
              <p role="status" className="flex items-center gap-ds-2 text-ds-sm text-ds-content-muted">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading tenants…
              </p>
            )}
            <Button
              variant="primary"
              fullWidth
              onClick={handleTransfer}
              disabled={!isSuperAdmin || !targetId}
              loading={busy}
            >
              {busy ? null : <ArrowRightCircle className="h-4 w-4" aria-hidden="true" />}
              Transfer to selected company
            </Button>
          </div>

          <div className="border-t border-ds-border-subtle pt-ds-4">
            <Button
              variant="secondary"
              fullWidth
              onClick={handleDelete}
              disabled={!isSuperAdmin || busy}
            >
              <Trash2 className="h-4 w-4 text-ds-status-danger-fg" aria-hidden="true" />
              Delete sandbox application
            </Button>
          </div>
        </div>
      </Card>
    </main>
  );
}
