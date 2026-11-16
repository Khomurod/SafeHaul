import React, { useId, useState } from 'react';
import { Button } from '@/design-system/components';
import { AgreementRow } from '@features/applications/components/PreservedApplicationView';
import {
  isPreservedSnapshot,
  toDisplayAgreements,
} from '@features/applications/services/submissionPresenter';
import { readSubmissionRecord } from '@features/applications/services/submissionRecordRead';

/**
 * The applicant's consents, one by one, on the DQ row of the preserved
 * original application (`requiresAuditedAccess`); nothing on any other row.
 *
 * They come from the frozen submission record the PDF was made from,
 * `companies/{companyId}/applications/{applicationId}/submission/{snapshotId}`
 * — always under `applications`, where the server writes it, as
 * `useSubmissionRecord` explains — through the same presenter and the same
 * `AgreementRow` the Application tab uses, so the two cannot disagree.
 *
 * Read when the recruiter opens the list, then kept: one read, and none on a
 * visit to the DQ tab for any other file. The record holds the whole
 * application, so reading it whenever the tab opens would cost that on every
 * visit. It comes through `readSubmissionRecord`, so the record the
 * Application tab already read is not read again, and showing the list again
 * after a return to the tab reads nothing while the dossier is open. A failed
 * read is read again on the next opening.
 *
 * The PDF is still reached only through the row's audited download; this adds
 * no link to it and never regenerates it.
 */

const CLOSED = { open: false, status: 'idle', agreements: [] };

const MESSAGES = {
  loading: 'Loading consents…',
  error: 'The consents could not be loaded. Hide them and show them again to try once more.',
  missing: "This submission's record could not be found, so its consents cannot be listed here.",
  empty: 'No consents were recorded with this submission.',
};

async function readConsents({ companyId, applicationId, snapshotId }) {
  const snapshot = await readSubmissionRecord({ companyId, applicationId, snapshotId });
  if (!isPreservedSnapshot(snapshot)) return { status: 'missing', agreements: [] };
  const agreements = toDisplayAgreements(snapshot);
  return { status: agreements.length > 0 ? 'ready' : 'empty', agreements };
}

export function OriginalApplicationConsents({ companyId, applicationId, file }) {
  const panelId = useId();
  const snapshotId = file?.requiresAuditedAccess ? file.snapshotId : null;
  // The record the view was read for. The DQ record's id repeats across
  // applications (`application-pdf-v1`), so a view held for another one is
  // never shown, and a read that answers after the record changed is dropped.
  const inputs = JSON.stringify([companyId, applicationId, snapshotId]);
  const [view, setView] = useState({ inputs, ...CLOSED });
  const current = view.inputs === inputs ? view : { inputs, ...CLOSED };

  if (!snapshotId) return null;

  const settle = (result) => setView((latest) => (latest.inputs === inputs ? { ...latest, ...result } : latest));

  const toggle = () => {
    if (current.open || (current.status !== 'idle' && current.status !== 'error')) {
      setView({ ...current, open: !current.open });
      return;
    }
    setView({ inputs, open: true, status: 'loading', agreements: [] });
    readConsents({ companyId, applicationId, snapshotId }).then(settle, (err) => {
      console.error('Could not read the submission record for its consents:', err);
      settle({ status: 'error', agreements: [] });
    });
  };

  return (
    // A line of its own under the row, as wide as the row, lined up with the
    // file name above it (the 20px icon and its 12px gap).
    <div className="basis-full pl-ds-8">
      <Button
        variant="link"
        size="sm"
        onClick={toggle}
        aria-expanded={current.open}
        aria-controls={current.open ? panelId : undefined}
      >
        {current.open ? 'Hide consents' : 'Show consents'}
        <span className="ds-visually-hidden"> in {file.fileName}</span>
      </Button>
      {current.open && (
        <div id={panelId} className="mt-ds-2">
          <div role="status">
            {MESSAGES[current.status] && (
              <p className="text-ds-sm text-ds-content-secondary">{MESSAGES[current.status]}</p>
            )}
          </div>
          {current.status === 'ready' && (
            <ul aria-label="Consents in this submission" className="space-y-ds-3">
              {current.agreements.map((agreement) => (
                <AgreementRow key={agreement.key} agreement={agreement} compact />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
