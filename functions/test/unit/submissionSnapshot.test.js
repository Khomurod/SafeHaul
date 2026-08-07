const { buildApplicationDefinition } = require('../../shared/applicationDefinition');
const {
  SNAPSHOT_SCHEMA_VERSION,
  buildAgreementRecords,
  buildCustomAnswers,
  buildSubmissionSnapshot,
  formatAnswerForDisplay,
  formatDateForDisplay,
  formatFileForDisplay,
  isBlank,
  wasPresented,
} = require('../../shared/submissionSnapshot');

// Artificial applicants, companies and questions only.
const SUBMITTED_AT = '2026-06-15T12:00:00.000Z';

const company = (over = {}) => ({
  companyName: 'Artificial Freight Co',
  dotNumber: '1234567',
  address: { street: '1 Test Way', city: 'Springfield', state: 'IL', zip: '62701' },
  contact: { email: 'hr@example.test', phone: '555-0100' },
  ...over,
});

const definition = (over = {}) => buildApplicationDefinition({ company: company(over) });

const acceptAll = (def, at = SUBMITTED_AT) =>
  def.agreements.reduce((acc, a) => {
    acc[a.id] = { accepted: true, acceptedAt: at, ip: '203.0.113.5', userAgent: 'Artificial UA' };
    return acc;
  }, {});

const snapshot = (over = {}) => {
  const def = over.definition || definition();
  return buildSubmissionSnapshot({
    definition: def,
    formData: { firstName: 'Ann', lastName: 'Adams', ...(over.formData || {}) },
    acceptances: over.acceptances !== undefined ? over.acceptances : acceptAll(def),
    signature: over.signature !== undefined ? over.signature : { image: 'data:image/png;base64,AAA', type: 'drawn', capturedAt: SUBMITTED_AT },
    submittedAt: SUBMITTED_AT,
    provenance: over.provenance,
  });
};

const answerFor = (snap, fieldId) =>
  snap.sections.flatMap((s) => s.answers).find((a) => a.fieldId === fieldId);

describe('snapshot shape and freezing', () => {
  it('records the schema, definition and agreement versions it was built from', () => {
    const def = definition();
    const snap = snapshot({ definition: def });
    expect(snap.schemaVersion).toBe(SNAPSHOT_SCHEMA_VERSION);
    expect(snap.frozen).toBe(true);
    expect(snap.definitionVersion).toBe(def.version);
    expect(snap.agreementVersion).toBe(def.agreementVersion);
    expect(snap.submittedAt).toBe(SUBMITTED_AT);
  });

  it('requires a definition', () => {
    expect(() => buildSubmissionSnapshot({})).toThrow(/requires an application definition/);
  });

  // The whole point: later edits to company settings must not reach history.
  it('freezes a copy of the company details rather than referencing them', () => {
    const snap = snapshot();
    expect(snap.company.companyName).toBe('Artificial Freight Co');
    expect(snap.company.dotNumber).toBe('1234567');
  });

  it('carries no raw company fields beyond the curated allowlist', () => {
    const def = buildApplicationDefinition({
      company: company({ stripeCustomerId: 'cus_123', teamMembers: [{ userId: 'u1' }] }),
    });
    const snap = snapshot({ definition: def });
    expect(snap.company.stripeCustomerId).toBeUndefined();
    expect(snap.company.teamMembers).toBeUndefined();
  });

  it('defaults submittedAt rather than leaving it unset', () => {
    const def = definition();
    const snap = buildSubmissionSnapshot({ definition: def, formData: {}, acceptances: {} });
    expect(typeof snap.submittedAt).toBe('string');
    expect(Number.isNaN(Date.parse(snap.submittedAt))).toBe(false);
  });
});

describe('standard answers carry real labels', () => {
  it('labels every answer with human wording, never a field id', () => {
    for (const answer of snapshot().sections.flatMap((s) => s.answers)) {
      expect(answer.label).toBeTruthy();
      expect(answer.label).not.toBe(answer.fieldId);
    }
  });

  it('groups answers under the definition section titles', () => {
    const personal = snapshot().sections.find((s) => s.id === 'personal');
    expect(personal.title).toBe('Personal Information');
    expect(personal.answers.map((a) => a.fieldId)).toContain('firstName');
  });

  it('records the value and a display string', () => {
    const answer = answerFor(snapshot(), 'firstName');
    expect(answer.value).toBe('Ann');
    expect(answer.displayValue).toBe('Ann');
  });

  it('leaves an unanswered field null instead of inventing a placeholder', () => {
    const answer = answerFor(snapshot(), 'middleName');
    expect(answer.value).toBeNull();
    expect(answer.displayValue).toBeNull();
    expect(answer.presented).toBe(true);
  });

  // RULE 1: a hidden field was never asked, so it is not an unanswered question.
  it('omits fields the company hid', () => {
    const def = buildApplicationDefinition({
      company: company({ applicationConfig: { referralSource: { hidden: true, required: false } } }),
    });
    expect(answerFor(snapshot({ definition: def }), 'referralSource')).toBeUndefined();
  });

  // RULE 2: a conditional field whose condition was not met was never shown.
  it('marks an unmet conditional field as not presented, with no value', () => {
    const answer = answerFor(snapshot({ formData: { 'has-felony': 'no', felonyExplanation: 'leftover' } }), 'felonyExplanation');
    expect(answer.presented).toBe(false);
    expect(answer.value).toBeNull();
    expect(answer.displayValue).toBeNull();
  });

  it('records a conditional field once its condition is met', () => {
    const answer = answerFor(snapshot({
      formData: { 'has-felony': 'yes', felonyExplanation: 'Explained in full.' },
    }), 'felonyExplanation');
    expect(answer.presented).toBe(true);
    expect(answer.displayValue).toBe('Explained in full.');
  });

  it('matches a conditional value case-insensitively', () => {
    expect(wasPresented({ dependsOn: { field: 'x', equals: 'yes' } }, { x: 'YES' })).toBe(true);
    expect(wasPresented({ dependsOn: { field: 'x', equals: 'yes' } }, { x: 'no' })).toBe(false);
    expect(wasPresented({}, {})).toBe(true);
  });

  it('keeps the sensitive flag so renderers can apply the SSN policy', () => {
    const answer = answerFor(snapshot({ formData: { ssn: '123-45-6789' } }), 'ssn');
    expect(answer.sensitive).toBe(true);
    // Stored as truth; masking is the renderer's decision.
    expect(answer.value).toBe('123-45-6789');
  });
});

describe('display formatting never shows raw infrastructure values', () => {
  it('normalizes yes/no answers', () => {
    expect(formatAnswerForDisplay('yes')).toBe('Yes');
    expect(formatAnswerForDisplay('NO')).toBe('No');
    expect(formatAnswerForDisplay(true)).toBe('Yes');
    expect(formatAnswerForDisplay(false)).toBe('No');
  });

  it('formats dates for a US reader', () => {
    expect(formatDateForDisplay('2024-03-17')).toBe('03/17/2024');
    expect(formatDateForDisplay('2024-03')).toBe('03/2024');
    expect(formatDateForDisplay('sometime')).toBe('sometime');
    expect(formatDateForDisplay('')).toBeNull();
  });

  // A storage path or signed URL must never be shown as an answer.
  it('reduces a file answer to its filename', () => {
    expect(formatFileForDisplay('companies/co-a/applications/app-1/cdl-front.jpg')).toBe('cdl-front.jpg');
    expect(formatFileForDisplay('https://storage.example.test/o/cdl%20front.pdf?token=secret-abc'))
      .toBe('cdl front.pdf');
    expect(formatFileForDisplay({ name: 'medical-card.png' })).toBe('medical-card.png');
    expect(formatFileForDisplay({})).toBe('Uploaded file');
  });

  it('does not leak the token from a signed URL', () => {
    expect(formatFileForDisplay('https://x.test/o/f.pdf?token=secret-abc')).not.toContain('secret-abc');
  });

  it('joins multi-select answers', () => {
    expect(formatAnswerForDisplay(['A', 'B'])).toBe('A, B');
    expect(formatAnswerForDisplay([])).toBeNull();
  });

  it('reports blanks as null so each renderer need not invent a placeholder', () => {
    for (const value of [null, undefined, '', '   ', []]) {
      expect(isBlank(value)).toBe(true);
      expect(formatAnswerForDisplay(value)).toBeNull();
    }
  });

  it('keeps a zero as a real answer', () => {
    expect(isBlank(0)).toBe(false);
    expect(formatAnswerForDisplay(0)).toBe('0');
  });
});

describe('custom answers never surface a question id as wording', () => {
  const withQuestions = () => buildApplicationDefinition({
    company: company({
      customQuestions: [
        { id: 'q1', label: 'Preferred route type?', type: 'dropdown', options: ['OTR', 'Regional'], required: true },
        { id: 'q2', label: 'Any restrictions?', type: 'paragraph' },
      ],
    }),
  });

  it('pairs each answer with its recorded wording', () => {
    const def = withQuestions();
    const snap = snapshot({ definition: def, formData: { customAnswers: { q1: 'OTR' } } });
    const a1 = snap.customAnswers.find((a) => a.questionId === 'q1');
    expect(a1.label).toBe('Preferred route type?');
    expect(a1.displayValue).toBe('OTR');
    expect(a1.unknownQuestion).toBe(false);
  });

  it('represents an unanswered question, so the record shows what was asked', () => {
    const def = withQuestions();
    const a2 = snapshot({ definition: def, formData: { customAnswers: { q1: 'OTR' } } })
      .customAnswers.find((a) => a.questionId === 'q2');
    expect(a2).toBeDefined();
    expect(a2.value).toBeNull();
  });

  // RULE 3: keeping the answer beats losing it, but the id is never a label.
  it('keeps an orphaned answer, flags it, and refuses to use the id as a label', () => {
    const def = withQuestions();
    const orphan = snapshot({
      definition: def,
      formData: { customAnswers: { 'deleted-question-uuid': 'Some answer' } },
    }).customAnswers.find((a) => a.questionId === 'deleted-question-uuid');

    expect(orphan.unknownQuestion).toBe(true);
    expect(orphan.label).toBeNull();
    expect(orphan.labelMissing).toBe(true);
    expect(orphan.displayValue).toBe('Some answer');
  });

  it('flags a question whose wording was never recorded', () => {
    const def = buildApplicationDefinition({ company: company({ customQuestions: [{ id: 'q9' }] }) });
    const a = snapshot({ definition: def, formData: { customAnswers: { q9: 'x' } } }).customAnswers[0];
    expect(a.labelMissing).toBe(true);
    expect(a.label).toBeNull();
  });

  it('yields an empty list when there are no questions and no answers', () => {
    expect(snapshot().customAnswers).toEqual([]);
    expect(buildCustomAnswers({ customQuestions: [] }, 'not-an-object')).toEqual([]);
  });
});

describe('agreements: exact wording plus its own acceptance evidence', () => {
  it('captures all four agreements with the verbatim text presented', () => {
    const snap = snapshot();
    expect(snap.agreements.map((a) => a.id)).toEqual([
      'electronicSignature', 'fcraDisclosure', 'pspDisclosure', 'clearinghouseConsent',
    ]);
    for (const a of snap.agreements) {
      expect(a.body).toContain('Artificial Freight Co');
      expect(a.body.length).toBeGreaterThan(200);
    }
  });

  it('always includes the FMCSA Clearinghouse consent', () => {
    expect(snapshot().agreements.map((a) => a.id)).toContain('clearinghouseConsent');
  });

  it('records per-agreement acceptance separately, with its context', () => {
    const a = snapshot().agreements[0];
    expect(a.accepted).toBe(true);
    expect(a.acceptedAt).toBe(SUBMITTED_AT);
    expect(a.evidenceRecorded).toBe(true);
    expect(a.acceptanceContext).toEqual({ ip: '203.0.113.5', userAgent: 'Artificial UA' });
  });

  // RULE 4 — the defect this replaces: the PDF stamped a signature onto all four
  // agreements unconditionally.
  it('attaches no signature to an agreement with no acceptance evidence', () => {
    const def = definition();
    const partial = { [def.agreements[0].id]: { accepted: true, acceptedAt: SUBMITTED_AT } };
    const snap = snapshot({ definition: def, acceptances: partial });

    expect(snap.agreements[0].signature).not.toBeNull();
    for (const a of snap.agreements.slice(1)) {
      expect(a.accepted).toBe(false);
      expect(a.signature).toBeNull();
      expect(a.evidenceRecorded).toBe(false);
      expect(a.acceptanceContext).toBeNull();
      // The wording is still recorded — we know what was shown, not that it was accepted.
      expect(a.body).toBeTruthy();
    }
  });

  it('attaches no signature when acceptance is explicitly refused', () => {
    const def = definition();
    const refused = def.agreements.reduce((acc, a) => {
      acc[a.id] = { accepted: false };
      return acc;
    }, {});
    const snap = snapshot({ definition: def, acceptances: refused });
    for (const a of snap.agreements) {
      expect(a.accepted).toBe(false);
      expect(a.signature).toBeNull();
      // Evidence exists (a recorded refusal) even though acceptance is false.
      expect(a.evidenceRecorded).toBe(true);
    }
  });

  it('attaches no signature when none was captured, even if accepted', () => {
    for (const a of snapshot({ signature: null }).agreements) {
      expect(a.accepted).toBe(true);
      expect(a.signature).toBeNull();
    }
  });

  it('marks legacy wording so a reconstructed record can be labelled', () => {
    const def = buildApplicationDefinition({ company: company(), agreementVersion: 'legacy-1' });
    const snap = snapshot({ definition: def });
    expect(snap.agreements.every((a) => a.legacyWording === true)).toBe(true);
    expect(snapshot().agreements.every((a) => a.legacyWording === false)).toBe(true);
  });

  it('throws rather than substituting wording for an unknown version', () => {
    expect(() => buildAgreementRecords({
      definition: { company: { companyName: 'X' }, agreements: [{ id: 'fcraDisclosure', version: 'v99' }] },
    })).toThrow(/Unknown version/);
  });

  it('tolerates missing acceptances entirely', () => {
    const snap = snapshot({ acceptances: undefined });
    expect(snap.agreements.every((a) => a.evidenceRecorded === true)).toBe(true);
    const none = snapshot({ acceptances: {} });
    expect(none.agreements.every((a) => a.signature === null)).toBe(true);
  });
});

describe('employment coverage is captured as computed at submission', () => {
  it('records an incomplete three-year history with its gaps', () => {
    const snap = snapshot({ formData: { employers: [{ startDate: '2026-01', endDate: 'Present' }] } });
    expect(snap.employmentCoverage.isComplete).toBe(false);
    expect(snap.employmentCoverage.requiredMonths).toBe(36);
    expect(snap.employmentCoverage.gaps.length).toBeGreaterThan(0);
  });

  it('records a complete history as complete', () => {
    const snap = snapshot({ formData: { employers: [{ startDate: '2020-01', endDate: 'Present' }] } });
    expect(snap.employmentCoverage.isComplete).toBe(true);
    expect(snap.employmentCoverage.gaps).toEqual([]);
  });

  it('counts unemployment, schooling and military toward coverage', () => {
    const snap = snapshot({
      formData: {
        employers: [{ startDate: '2025-01', endDate: 'Present' }],
        unemploymentPeriods: [{ startDate: '2023-07', endDate: '2024-12', type: 'unemployment' }],
      },
    });
    expect(snap.employmentCoverage.isComplete).toBe(true);
    expect(snap.employmentCoverage.accountedKinds).toContain('unemployment');
  });

  it('uses submittedAt as the reference, so the value cannot drift later', () => {
    const snap = snapshot({ formData: { employers: [{ startDate: '2023-07', endDate: '2026-06' }] } });
    expect(snap.employmentCoverage.windowStart).toBe('2023-07');
    expect(snap.employmentCoverage.windowEnd).toBe('2026-06');
    expect(snap.employmentCoverage.isComplete).toBe(true);
  });
});

describe('provenance distinguishes a live submission from a reconstruction', () => {
  it('defaults to a live submission', () => {
    expect(snapshot().provenance).toEqual({ source: 'submission', notes: [] });
  });

  it('records a reconstruction and its caveats', () => {
    const snap = snapshot({
      provenance: { source: 'reconstructed', notes: ['Per-agreement acceptance was not captured at submission.', null] },
    });
    expect(snap.provenance.source).toBe('reconstructed');
    expect(snap.provenance.notes).toEqual(['Per-agreement acceptance was not captured at submission.']);
  });
});
