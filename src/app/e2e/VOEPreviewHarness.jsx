import React, { useState } from 'react';
import { VOEPreviewModal } from '@features/company-admin/components/modals/VOEPreviewModal';
import { getE2EQueryParam } from '@lib/runtime/e2eMode';

/**
 * E2E-only mount point for `VOEPreviewModal`.
 *
 * WHY THIS EXISTS
 *
 * The VOE preview owns a generated legal document and two export paths, and the
 * Print path was broken in a way **no unit test could catch**: it depended on
 * DOMPurify, and `createDOMPurify(window)` is inert under happy-dom, so a test
 * asserting print fidelity passed while a real browser stripped the signature
 * and every class attribute. The defect was only ever visible in a real browser.
 *
 * It is also unreachable in a normal Playwright run: under
 * `VITE_E2E_TEST_MODE=1` Firestore is deliberately unreachable, the driver
 * dossier settles into its error state and never mounts `DossierContent`, so
 * the PEV tab — and this modal — cannot be opened. That limitation is recorded
 * in the roadmap and is why there was no VOE E2E spec.
 *
 * This harness closes that gap: it mounts the real component, with the real
 * export pipeline, against fixture props, so `e2e/voe-print-export.spec.cjs` can
 * assert what the printed page actually contains. It is **not** a substitute for
 * reaching the modal through the dossier — that remains outstanding work.
 *
 * It is routed only when `VITE_E2E_TEST_MODE === '1'` and is lazy-loaded, so a
 * production build neither routes to it nor includes it in the entry chunk.
 */

/** Signature fixtures, including the hostile values the scrub must reject. */
const SIGNATURES = {
  // A real 40×12 RGB PNG. It has to decode: the spec asserts `naturalWidth > 0`
  // at print time, which is how "print waited for the signature" is proven.
  image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACgAAAAMCAIAAACfoWgaAAAAMUlEQVR4nGP4P0CAYdRi+lssImEDR3QQZBgQW6EW099WkMUDYisojgfE1sGRqkeKxQAV3W8ZiBPnXAAAAABJRU5ErkJggg==',
  text: 'TEXT_SIGNATURE:Maria Garcia',
  none: undefined,
  // eslint-disable-next-line no-script-url
  'hostile-js': 'javascript:window.__voePwned = true',
  'hostile-datahtml': 'data:text/html;base64,PHNjcmlwdD53aW5kb3cuX192b2VQd25lZD10cnVlPC9zY3JpcHQ+',
  'hostile-svg': 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=',
};

/**
 * A value that is markup if it is ever interpolated rather than escaped. It
 * sets `window.__voePwned`, which the spec asserts stays undefined.
 */
const HOSTILE_TEXT = '<img src=x onerror="window.__voePwned=1"><script>window.__voePwned=1' + '<' + '/script>';

const BASE_EMPLOYER = {
  companyName: 'Acme Freight',
  name: 'Acme Freight',
  city: 'Austin',
  state: 'TX',
  startDate: '2020-01',
  endDate: '2022-06',
  email: 'hr@acme.test',
  phone: '512-555-0100',
};

const BASE_APPLICANT = {
  id: 'app-abc123',
  firstName: 'Maria',
  lastName: 'Garcia',
  ssn: '123-45-6789',
  dob: '1990-04-02',
  'signature-date': '07/01/2026',
  ipAddress: '203.0.113.7',
};

export default function VOEPreviewHarness() {
  const signatureKey = getE2EQueryParam('voeSignature', 'image');
  const hostile = getE2EQueryParam('voeHostile', '') === '1';

  const [closedCount, setClosedCount] = useState(0);
  const [sentCount, setSentCount] = useState(0);
  const [open, setOpen] = useState(true);

  const employer = hostile
    ? { ...BASE_EMPLOYER, companyName: HOSTILE_TEXT, name: HOSTILE_TEXT, city: HOSTILE_TEXT, email: `${HOSTILE_TEXT}@x.test` }
    : BASE_EMPLOYER;

  const applicant = {
    ...BASE_APPLICANT,
    ...(hostile ? { firstName: HOSTILE_TEXT, ipAddress: HOSTILE_TEXT } : {}),
    signature: SIGNATURES[signatureKey],
  };

  return (
    <div className="min-h-screen bg-ds-surface-subtle p-ds-6">
      <h1 className="text-ds-body-lg font-bold text-ds-content">VOE preview harness</h1>
      <p data-testid="voe-harness-closed-count">{closedCount}</p>
      <p data-testid="voe-harness-sent-count">{sentCount}</p>
      <button type="button" data-testid="voe-harness-reopen" onClick={() => setOpen(true)}>
        Reopen verification preview
      </button>

      {open && (
        <VOEPreviewModal
          employer={employer}
          applicant={applicant}
          onClose={() => {
            setClosedCount((n) => n + 1);
            setOpen(false);
          }}
          onSend={() => setSentCount((n) => n + 1)}
        />
      )}
    </div>
  );
}
