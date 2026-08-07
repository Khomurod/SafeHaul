/**
 * Contract freeze for the dossier Application tab's read-only summary.
 *
 * In scope: the summary cards, their fallbacks, the SSN masking rule, the CDL
 * expiry banding, the view toggle, and the pending-changes presentation.
 *
 * Out of scope for this campaign (and therefore only smoke-checked here): the
 * full-application `SchemaSection` editing path and the propose/review-link
 * workflow, which belong to the complex-editing campaign.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

let changesState;
vi.mock('@features/applications/hooks/useApplicationChanges', () => ({
  useApplicationChanges: () => changesState,
}));

vi.mock('@shared/components/schema/SchemaRenderer', () => ({
  SchemaSection: ({ sectionId }) => <div data-testid={`schema-${sectionId}`} />,
}));

let submissionRecordState = { record: null, loading: false, error: null };
vi.mock('@features/applications/hooks/useSubmissionRecord', () => ({
  useSubmissionRecord: () => submissionRecordState,
}));

import { ApplicationTab } from './ApplicationTab';

afterEach(cleanup);

const resetChanges = () => {
  changesState = {
    pendingChanges: [],
    proposing: false,
    linking: false,
    proposeChanges: vi.fn(),
    createReviewLink: vi.fn(),
  };
};

const APP = {
  id: 'app-1',
  firstName: 'Maria',
  middleName: 'Elena',
  lastName: 'Garcia',
  dob: '1990-04-02',
  ssn: '123-45-6789',
  street: '1 Main St',
  city: 'Austin',
  state: 'Texas',
  zip: '78701',
  cdlNumber: 'TX998877',
  cdlState: 'Texas',
  cdlClass: 'A',
};

/** A preserved record as `presentSubmission` returns one. */
const PRESERVED = {
  isPreserved: true,
  isReconstructed: false,
  notice: null,
  reconstructionNotes: [],
  submittedAt: '2026-07-14T15:22:41.000Z',
  company: { companyName: 'Northwind Freight Systems' },
  sections: [
    {
      id: 'personal',
      title: 'Personal Information',
      answers: [
        { key: 'firstName', label: 'First Name', value: 'Maria', isMissing: false, sensitive: false, repeating: false, rows: [] },
        { key: 'ssn', label: 'Social Security Number', value: '555-66-7777', isMissing: false, sensitive: true, repeating: false, rows: [] },
        { key: 'middleName', label: 'Middle Name', value: 'Not provided', isMissing: true, sensitive: false, repeating: false, rows: [] },
      ],
    },
    {
      id: 'employment',
      title: 'Employment History',
      answers: [
        {
          key: 'employers',
          label: 'Previous Employers',
          value: 'Not provided',
          isMissing: false,
          sensitive: false,
          repeating: true,
          rows: [[
            { label: 'Employer', displayValue: 'Lone Star Logistics' },
            { label: 'Position', displayValue: 'OTR Driver' },
          ]],
        },
        {
          key: 'unemployment',
          label: 'Employment Gaps',
          value: 'Not provided',
          isMissing: true,
          sensitive: false,
          repeating: true,
          rows: [],
        },
      ],
    },
  ],
  customAnswers: [
    { key: 'q1', label: 'Willing to run a dedicated lane?', labelUnavailable: false, unmatched: false, value: 'Yes', isMissing: false },
    { key: 'q2', label: 'Question wording not recorded', labelUnavailable: true, unmatched: true, value: 'Some answer', isMissing: false },
  ],
  agreements: [
    { key: 'a1', title: 'BACKGROUND CHECK DISCLOSURE', version: 'v1', status: 'accepted', summary: 'Accepted and signed by the applicant', acceptedAt: '2026-07-14T15:22:41.000Z', hasSignature: true, signatureType: 'drawn', legacyWording: false },
    { key: 'a2', title: 'FMCSA PSP DISCLOSURE', version: 'v1', status: 'unrecorded', summary: 'No acceptance was recorded for this agreement', acceptedAt: null, hasSignature: false, signatureType: null, legacyWording: false },
  ],
  coverage: { isComplete: false, coveredMonths: 35, requiredMonths: 36, missingMonths: 1, gaps: [{ fromMonth: '2026-07', toMonth: '2026-07', months: 1 }], summary: 'Accounts for 35 of 36 months; 1 unaccounted for.' },
};

const NOT_PRESERVED = {
  isPreserved: false,
  isReconstructed: false,
  notice: 'No preserved submission record exists for this application.',
  sections: [],
  customAnswers: [],
  agreements: [],
  coverage: null,
  company: null,
  submittedAt: null,
};

const renderTab = (appData = APP, props = {}) => {
  resetChanges();
  submissionRecordState = props.submissionRecord !== undefined
    ? props.submissionRecord
    : { record: NOT_PRESERVED, loading: false, error: null };
  if (props.changes) Object.assign(changesState, props.changes);
  render(
    <ApplicationTab
      appData={appData}
      fileUrls={props.fileUrls || {}}
      canEdit={props.canEdit ?? false}
      companyId="co-1"
      applicationId="app-1"
      collectionName="applications"
    />,
  );
};

describe('ApplicationTab identity summary', () => {
  it('joins the full name including a middle name', () => {
    renderTab();
    expect(screen.getByText('Maria Elena Garcia')).toBeInTheDocument();
  });

  it('omits the middle name cleanly when absent', () => {
    renderTab({ ...APP, middleName: '' });
    expect(screen.getByText('Maria Garcia')).toBeInTheDocument();
  });

  it('masks the SSN to the last four digits by default', () => {
    renderTab();
    expect(screen.getByText('***-**-6789')).toBeInTheDocument();
    expect(screen.queryByText('123-45-6789')).toBeNull();
  });

  it('reveals and re-masks the SSN from a named toggle', () => {
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: /show ssn/i }));
    expect(screen.getByText('123-45-6789')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /hide ssn/i }));
    expect(screen.getByText('***-**-6789')).toBeInTheDocument();
  });

  // DEFECT-FIX assertion: with no SSN the old code masked the literal fallback
  // string 'Unknown' and rendered `***-**-nown` on screen.
  it('uses the fully-masked fallback for a short or missing SSN', () => {
    renderTab({ ...APP, ssn: '' });
    expect(screen.getByText('***-**-****')).toBeInTheDocument();
  });

  it('joins the address and falls back to an em dash', () => {
    renderTab();
    // Frozen: the parts are joined with ', ' throughout, including before the ZIP.
    expect(screen.getByText('1 Main St, Austin, Texas, 78701')).toBeInTheDocument();

    cleanup();
    renderTab({ ...APP, street: '', city: '', state: '', zip: '' });
    expect(screen.getAllByText('--').length).toBeGreaterThan(0);
  });
});

describe('ApplicationTab license summary', () => {
  it('shows the license fields with their fallbacks', () => {
    renderTab();
    expect(screen.getByText('TX998877')).toBeInTheDocument();
    expect(screen.getByText('Texas')).toBeInTheDocument();
    expect(screen.getByText('A')).toBeInTheDocument();
  });

  it('defaults the class to A when unset (frozen behaviour)', () => {
    renderTab({ ...APP, cdlClass: '', cdlType: '' });
    expect(screen.getByText('A')).toBeInTheDocument();
  });

  it.each([
    [-5, 'EXPIRED'],
    [10, 'EXPIRING SOON'],
    [400, 'VALID'],
  ])('bands an expiry %i days away as %s', (offsetDays, expected) => {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    renderTab({ ...APP, cdlExpiration: d.toISOString() });
    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  it('shows no expiry band at all when there is no expiry date', () => {
    renderTab({ ...APP, cdlExpiration: null, cdlExpirationDate: null });
    for (const band of ['EXPIRED', 'EXPIRING SOON', 'VALID']) {
      expect(screen.queryByText(band)).toBeNull();
    }
  });
});

describe('ApplicationTab safety summary', () => {
  it('shows the clean-record state with its frozen copy', () => {
    renderTab();
    expect(screen.getByText('Clean Record')).toBeInTheDocument();
    expect(screen.getByText('No violations or accidents reported on this application.')).toBeInTheDocument();
  });

  it('counts violations and accidents in their headings', () => {
    renderTab({
      ...APP,
      violations: [{ charge: 'Speeding', date: '2024-02-01' }],
      accidents: [{ details: 'Rear-ended', date: '2023-06-01' }, { details: 'Minor', date: '2023-07-01' }],
    });
    expect(screen.getByText('Violations (1)')).toBeInTheDocument();
    expect(screen.getByText('Accidents (2)')).toBeInTheDocument();
    expect(screen.getByText('Speeding')).toBeInTheDocument();
  });

  it('falls back through the violation description fields', () => {
    renderTab({ ...APP, violations: [{ type: 'Type only' }, {}] });
    expect(screen.getByText('Type only')).toBeInTheDocument();
    expect(screen.getByText('Violation')).toBeInTheDocument();
  });
});

describe('ApplicationTab employment summary', () => {
  it('supports both legacy and current employer field names', () => {
    renderTab({
      ...APP,
      employers: [
        { companyName: 'New Co', address: '2 Rd', reasonForLeaving: 'Pay', position: 'Driver', startDate: '2020-01-01' },
        { name: 'Legacy Co', street: '3 Rd', reason: 'Moved', startDate: '2018-01-01', endDate: '2019-01-01' },
      ],
    });
    expect(screen.getByText('New Co')).toBeInTheDocument();
    expect(screen.getByText('Legacy Co')).toBeInTheDocument();
    expect(screen.getByText(/Reason: Pay/)).toBeInTheDocument();
    expect(screen.getByText(/Reason: Moved/)).toBeInTheDocument();
  });

  it('labels an open-ended job as Present', () => {
    renderTab({ ...APP, employers: [{ companyName: 'Now Co', startDate: '2022-03-01' }] });
    expect(screen.getByText(/Present/)).toBeInTheDocument();
  });

  it('shows the contact permission as text, never colour alone', () => {
    renderTab({ ...APP, employers: [{ companyName: 'A', mayContact: 'yes' }, { companyName: 'B', mayContact: 'no' }] });
    expect(screen.getByText('OK to Contact')).toBeInTheDocument();
    expect(screen.getByText('Do Not Contact')).toBeInTheDocument();
  });

  it('renders nothing for the timeline when there is no history', () => {
    renderTab();
    expect(screen.queryByText('Employment History')).toBeNull();
  });
});

describe('ApplicationTab consent summary', () => {
  it('hides the consent card entirely when nothing was agreed or signed', () => {
    renderTab();
    expect(screen.queryByText('Consent & Signature')).toBeNull();
  });

  it('treats agreed / yes / true as accepted', () => {
    renderTab({
      ...APP,
      'agree-electronic': 'agreed',
      'agree-background-check': 'yes',
      'agree-psp': true,
      'final-certification': '',
    });
    expect(screen.getByText('Consent & Signature')).toBeInTheDocument();
    expect(screen.getByText('Electronic Transaction Consent')).toBeInTheDocument();
    expect(screen.getByText('Final Certification')).toBeInTheDocument();
  });

  it('renders a data-url signature image with an accessible name', () => {
    renderTab({ ...APP, signature: 'data:image/png;base64,AAA', signatureDate: '2026-02-01' });
    expect(screen.getByAltText('Driver Signature')).toBeInTheDocument();
    expect(screen.getByText(/Signed on:/)).toBeInTheDocument();
  });

  it('does not render a non-data-url signature as an image', () => {
    renderTab({ ...APP, signature: 'https://example.com/sig.png' });
    expect(screen.queryByAltText('Driver Signature')).toBeNull();
  });
});

describe('ApplicationTab view toggle', () => {
  it('starts on the summary view', () => {
    renderTab();
    expect(screen.getByRole('button', { name: /summary view/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByTestId('schema-personal')).toBeNull();
  });

  it('switches to the full application view', () => {
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: /full application/i }));
    expect(screen.getByRole('button', { name: /full application/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByText('Clean Record')).toBeNull();
  });

  // DEFECT-FIX assertion (deliberate change, not a frozen contract): this tab
  // used to `return null` without application data, so the dossier's tab panel
  // was simply blank. A blank panel is not a page state — the user cannot tell
  // an empty record from a broken one.
  it('shows an announced empty state instead of a blank panel without application data', () => {
    render(<ApplicationTab appData={null} companyId="co-1" applicationId="app-1" />);
    expect(screen.getByRole('status')).toHaveTextContent('Application details are not available.');
  });

  it('renders no summary cards when there is no application data', () => {
    render(<ApplicationTab appData={null} companyId="co-1" applicationId="app-1" />);
    expect(screen.queryByText('Personal Information')).toBeNull();
    expect(screen.queryByRole('group', { name: 'Application view' })).toBeNull();
  });
});

describe('ApplicationTab pending changes', () => {
  it('summarises pending company edits with a before/after preview', () => {
    renderTab(APP, {
      changes: {
        pendingChanges: [
          { id: 'c1', fieldLabel: 'Phone', originalValue: '111', proposedValue: '222', status: 'pending' },
        ],
      },
    });
    expect(screen.getByText(/1 field\(s\) edited by company/)).toBeInTheDocument();
    expect(screen.getByText('111')).toBeInTheDocument();
    expect(screen.getByText('222')).toBeInTheDocument();
  });

  it('previews empty, object and long values without leaking raw data', () => {
    renderTab(APP, {
      changes: {
        pendingChanges: [
          { id: 'c1', fieldKey: 'a', originalValue: '', proposedValue: [1, 2, 3] },
          { id: 'c2', fieldKey: 'b', originalValue: { x: 1 }, proposedValue: 'y'.repeat(60) },
        ],
      },
    });
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByText('3 item(s)')).toBeInTheDocument();
    expect(screen.getByText('(updated)')).toBeInTheDocument();
    expect(screen.getByText(`${'y'.repeat(48)}…`)).toBeInTheDocument();
  });

  it('hides the banner when there are no pending changes', () => {
    renderTab();
    expect(screen.queryByText(/edited by company/)).toBeNull();
  });

  it('gates the edit action behind canEdit', () => {
    renderTab(APP, { canEdit: false });
    expect(screen.queryByRole('button', { name: /edit application/i })).toBeNull();

    cleanup();
    renderTab(APP, { canEdit: true });
    expect(screen.getByRole('button', { name: /edit application/i })).toBeInTheDocument();
  });
});


describe('ApplicationTab — which record it shows', () => {
  // The defect this replaces: the provenance banner said "preserved original"
  // while every view below it rendered the live, editable application document.
  const withPreserved = (appData = APP) => renderTab(appData, {
    submissionRecord: { record: PRESERVED, loading: false, error: null },
  });

  it('opens on the preserved original when one exists', () => {
    withPreserved();
    expect(screen.getByRole('button', { name: /As Submitted/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(/Preserved original submission/i)).toBeInTheDocument();
  });

  it('renders the preserved answers, not the live application document', () => {
    // The live record says Maria Elena Garcia with SSN ...6789; the frozen one
    // says Maria with SSN ...7777. The submitted view must show the frozen one.
    withPreserved();
    expect(screen.getByText('***-**-7777')).toBeInTheDocument();
    expect(screen.queryByText('***-**-6789')).toBeNull();
    expect(screen.queryByText('Maria Elena Garcia')).toBeNull();
  });

  it('never shows a full Social Security Number on screen, even from the record', () => {
    withPreserved();
    expect(screen.queryByText('555-66-7777')).toBeNull();
  });

  it('lays out repeating groups as labelled rows, never as raw objects', () => {
    withPreserved();
    expect(screen.getByText('Lone Star Logistics')).toBeInTheDocument();
    expect(screen.getByText('OTR Driver')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\[object Object\]/);
  });

  it('says a repeating group is empty rather than leaving a blank', () => {
    withPreserved();
    expect(screen.getByText('None recorded.')).toBeInTheDocument();
  });

  it('shows each agreement with its OWN evidence', () => {
    withPreserved();
    expect(screen.getByText('Accepted and signed by the applicant')).toBeInTheDocument();
    expect(screen.getByText('No acceptance was recorded for this agreement')).toBeInTheDocument();
  });

  it('labels the live views as the current record', () => {
    withPreserved();
    fireEvent.click(screen.getByRole('button', { name: /Summary View/i }));
    expect(screen.getByText(/current record, which company edits/i)).toBeInTheDocument();
    expect(screen.queryByText(/Preserved original submission/i)).toBeNull();
    // And it IS the live document now.
    expect(screen.getByText('Maria Elena Garcia')).toBeInTheDocument();
  });

  it('opens on the summary when nothing was preserved, and says so', () => {
    renderTab();
    expect(screen.getByRole('button', { name: /Summary View/i })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: /As Submitted/i }));
    expect(screen.getByText(/Nothing was preserved for this submission/i)).toBeInTheDocument();
  });

  it('never substitutes live data when the record is missing', () => {
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: /As Submitted/i }));
    expect(screen.queryByText('Maria Elena Garcia')).toBeNull();
    expect(screen.queryByText('***-**-6789')).toBeNull();
  });

  it('waits for the record rather than opening on live data and swapping', () => {
    // Defaulting to the summary during the read would show the live document
    // and then replace it with the frozen one — the one transition that must
    // not happen quietly on this screen.
    renderTab(APP, { submissionRecord: { record: null, loading: true, error: null } });
    expect(screen.getByRole('button', { name: /As Submitted/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(/Loading the preserved record/i)).toBeInTheDocument();
    expect(screen.queryByText('Maria Elena Garcia')).toBeNull();
  });
});
