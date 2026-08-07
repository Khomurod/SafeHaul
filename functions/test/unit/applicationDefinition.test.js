const {
  GATE_DEFAULT_HIDDEN,
  GATE_DEFAULT_REQUIRED,
  STANDARD_SECTIONS,
  buildApplicationDefinition,
  canonicalize,
  findFieldLabel,
  hashDefinition,
  normalizeCustomQuestion,
  resolveGate,
  snapshotCompanyDetails,
  visibleFields,
} = require('../../shared/applicationDefinition');

// Artificial company data only.
const company = (over = {}) => ({
  companyName: 'Artificial Freight Co',
  dba: 'AFC Logistics',
  dotNumber: '1234567',
  mcNumber: 'MC-987654',
  address: { street: '1 Test Way', city: 'Springfield', state: 'IL', zip: '62701' },
  contact: { email: 'hr@example.test', phone: '555-0100' },
  ...over,
});

const fieldById = (def, id) => visibleFields(def).find((f) => f.id === id);

describe('definition version is content-addressed', () => {
  it('gives identical settings the same version', () => {
    expect(buildApplicationDefinition({ company: company() }).version)
      .toBe(buildApplicationDefinition({ company: company() }).version);
  });

  it('changes the version when a custom question changes', () => {
    const before = buildApplicationDefinition({
      company: company({ customQuestions: [{ id: 'q1', label: 'Do you have a passport?' }] }),
    }).version;
    const after = buildApplicationDefinition({
      company: company({ customQuestions: [{ id: 'q1', label: 'Do you hold a valid passport?' }] }),
    }).version;
    expect(after).not.toBe(before);
  });

  it('changes the version when a company detail changes', () => {
    const before = buildApplicationDefinition({ company: company() }).version;
    const after = buildApplicationDefinition({ company: company({ dotNumber: '7654321' }) }).version;
    expect(after).not.toBe(before);
  });

  it('changes the version when a gate is reconfigured', () => {
    const before = buildApplicationDefinition({ company: company() }).version;
    const after = buildApplicationDefinition({
      company: company({ applicationConfig: { referralSource: { required: true, hidden: false } } }),
    }).version;
    expect(after).not.toBe(before);
  });

  it('is insensitive to key order, so two admins saving the same settings agree', () => {
    const a = { companyName: 'X', dotNumber: '1' };
    const b = { dotNumber: '1', companyName: 'X' };
    expect(hashDefinition({ company: a })).toBe(hashDefinition({ company: b }));
    expect(canonicalize({ b: 1, a: { d: 2, c: 3 } })).toEqual({ a: { c: 3, d: 2 }, b: 1 });
  });

  it('ignores any pre-existing version field when hashing', () => {
    const def = buildApplicationDefinition({ company: company() });
    expect(hashDefinition(def)).toBe(def.version);
  });
});

describe('standard field gates mirror the company settings UI', () => {
  it('applies each documented default when a company has configured nothing', () => {
    const def = buildApplicationDefinition({ company: company() });
    const all = def.sections.flatMap((s) => s.fields);

    for (const [gate, expectedRequired] of Object.entries(GATE_DEFAULT_REQUIRED)) {
      const field = all.find((f) => f.gate === gate);
      expect(field).toBeDefined();
      expect(field.hidden).toBe(Boolean(GATE_DEFAULT_HIDDEN[gate]));
      expect(field.required).toBe(expectedRequired);
    }
  });

  it('keeps opt-in gates out of the visible set until a company enables them', () => {
    const def = buildApplicationDefinition({ company: company() });
    expect(visibleFields(def).some((f) => f.gate === 'emergencyContacts')).toBe(false);

    const optedIn = buildApplicationDefinition({
      company: company({ applicationConfig: { emergencyContacts: { hidden: false, required: false } } }),
    });
    expect(visibleFields(optedIn).some((f) => f.gate === 'emergencyContacts')).toBe(true);
  });

  it('reads the legacy showEmergencyContacts boolean', () => {
    const legacy = buildApplicationDefinition({
      company: company({ applicationConfig: { showEmergencyContacts: true } }),
    });
    expect(visibleFields(legacy).some((f) => f.gate === 'emergencyContacts')).toBe(true);
  });

  it('never records a hidden field as required', () => {
    const def = buildApplicationDefinition({
      company: company({ applicationConfig: { ssn: { hidden: true, required: true } } }),
    });
    const ssn = def.sections.flatMap((sec) => sec.fields).find((f) => f.id === 'ssn');
    expect(ssn).toMatchObject({ hidden: true, required: false });
  });

  it('honours an explicit required override', () => {
    const def = buildApplicationDefinition({
      company: company({ applicationConfig: { medCardUpload: { required: true } } }),
    });
    expect(fieldById(def, 'medical-card-upload').required).toBe(true);
  });

  it('drops hidden fields from the visible set without deleting them from the record', () => {
    const def = buildApplicationDefinition({
      company: company({ applicationConfig: { referralSource: { hidden: true, required: false } } }),
    });
    expect(fieldById(def, 'referralSource')).toBeUndefined();
    // Still inventoried, so the definition remains a complete description.
    const all = def.sections.flatMap((s) => s.fields);
    expect(all.find((f) => f.id === 'referralSource').hidden).toBe(true);
  });

  it('treats an ungated field as always collected and never required by config', () => {
    expect(resolveGate({}, null)).toEqual({ hidden: false, required: false, gated: false });
    expect(fieldById(buildApplicationDefinition({ company: company() }), 'firstName').gate).toBeNull();
  });

  it('marks SSN and the SSC upload as sensitive so consumers can apply a policy', () => {
    const def = buildApplicationDefinition({ company: company() });
    expect(fieldById(def, 'ssn').sensitive).toBe(true);
    expect(fieldById(def, 'ssc-upload').sensitive).toBe(true);
  });

  it('records conditional fields with the condition that reveals them', () => {
    const def = buildApplicationDefinition({ company: company() });
    expect(fieldById(def, 'felonyExplanation').dependsOn).toEqual({ field: 'has-felony', equals: 'yes' });
  });
});

describe('every standard field carries human wording', () => {
  // The defect this prevents: a field with no label falls back to its id, which
  // is how internal identifiers reached users.
  it('has a non-empty label for every field in every section', () => {
    for (const section of STANDARD_SECTIONS) {
      expect(section.title).toBeTruthy();
      for (const field of section.fields) {
        expect(typeof field.label).toBe('string');
        expect(field.label.trim().length).toBeGreaterThan(0);
        expect(field.label).not.toBe(field.id);
      }
    }
  });

  it('uses unique field ids across all sections', () => {
    const ids = STANDARD_SECTIONS.flatMap((s) => s.fields.map((f) => f.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('resolves a label by id for renderers', () => {
    const def = buildApplicationDefinition({ company: company() });
    expect(findFieldLabel(def, 'cdlNumber')).toBe('License Number');
    expect(findFieldLabel(def, 'not-a-field')).toBeNull();
  });
});

describe('custom questions never surface their ids as wording', () => {
  it('normalizes a complete question', () => {
    expect(normalizeCustomQuestion({
      id: 'q1', label: 'Preferred route type?', type: 'dropdown',
      required: true, options: ['OTR', 'Regional'], helpText: 'Pick one',
    }, 0)).toMatchObject({
      id: 'q1', order: 1, label: 'Preferred route type?', labelMissing: false,
      type: 'dropdown', required: true, options: ['OTR', 'Regional'], helpText: 'Pick one',
    });
  });

  // THE BUG: the PDF used the question id as its label.
  it('reports a missing label as null and flags it, never falling back to the id', () => {
    const q = normalizeCustomQuestion({ id: '8f14e45f-ea0a-4c1b-9f2d-000000000000' }, 0);
    expect(q.label).toBeNull();
    expect(q.labelMissing).toBe(true);
    expect(q.label).not.toBe(q.id);
  });

  it('treats a blank or whitespace label as missing', () => {
    expect(normalizeCustomQuestion({ id: 'q1', label: '   ' }, 0).labelMissing).toBe(true);
  });

  it('preserves author order', () => {
    const def = buildApplicationDefinition({
      company: company({ customQuestions: [{ id: 'a', label: 'First' }, { id: 'b', label: 'Second' }] }),
    });
    expect(def.customQuestions.map((q) => [q.order, q.label])).toEqual([[1, 'First'], [2, 'Second']]);
  });

  it('drops blank options and tolerates a non-array', () => {
    expect(normalizeCustomQuestion({ id: 'q', options: ['A', '  ', null, 'B'] }, 0).options).toEqual(['A', 'B']);
    expect(normalizeCustomQuestion({ id: 'q', options: 'nope' }, 0).options).toEqual([]);
  });

  it('defaults the type rather than leaving it unset', () => {
    expect(normalizeCustomQuestion({ id: 'q' }, 0).type).toBe('shortAnswer');
  });

  it('survives a null or non-object entry', () => {
    expect(normalizeCustomQuestion(null, 3)).toMatchObject({ id: null, order: 4, labelMissing: true });
  });

  it('yields an empty list when the company has no questions', () => {
    expect(buildApplicationDefinition({ company: company() }).customQuestions).toEqual([]);
    expect(buildApplicationDefinition({ company: company({ customQuestions: 'nope' }) }).customQuestions).toEqual([]);
  });
});

describe('company details are an allowlist, not a database dump', () => {
  it('captures exactly the curated fields', () => {
    expect(snapshotCompanyDetails(company())).toEqual({
      companyName: 'Artificial Freight Co',
      dba: 'AFC Logistics',
      dotNumber: '1234567',
      mcNumber: 'MC-987654',
      address: { street: '1 Test Way', city: 'Springfield', state: 'IL', zip: '62701' },
      contact: { email: 'hr@example.test', phone: '555-0100' },
    });
  });

  it('excludes unrelated company fields so raw values cannot leak into a PDF', () => {
    const snap = snapshotCompanyDetails(company({
      appSlug: 'artificial-co-123', teamMembers: [{ userId: 'u1' }], stripeCustomerId: 'cus_123',
    }));
    expect(snap.appSlug).toBeUndefined();
    expect(snap.teamMembers).toBeUndefined();
    expect(snap.stripeCustomerId).toBeUndefined();
  });

  it('normalizes missing values to null instead of undefined or empty strings', () => {
    expect(snapshotCompanyDetails({ companyName: '  ' })).toEqual({
      companyName: null, dba: null, dotNumber: null, mcNumber: null,
      address: { street: null, city: null, state: null, zip: null },
      contact: { email: null, phone: null },
    });
  });

  it('coerces a numeric DOT number to a string', () => {
    expect(snapshotCompanyDetails({ dotNumber: 1234567 }).dotNumber).toBe('1234567');
  });

  it('tolerates a missing company entirely', () => {
    expect(() => buildApplicationDefinition({})).not.toThrow();
    expect(buildApplicationDefinition({}).company.companyName).toBeNull();
  });
});

describe('agreements are referenced by id and version', () => {
  it('records all four required agreements at the current version', () => {
    const def = buildApplicationDefinition({ company: company() });
    expect(def.agreements.map((a) => a.id)).toEqual([
      'electronicSignature', 'fcraDisclosure', 'pspDisclosure', 'clearinghouseConsent',
    ]);
    expect(def.agreements.every((a) => a.version === def.agreementVersion)).toBe(true);
  });

  it('always includes the FMCSA Clearinghouse consent', () => {
    const ids = buildApplicationDefinition({ company: company() }).agreements.map((a) => a.id);
    expect(ids).toContain('clearinghouseConsent');
  });

  it('can be pinned to a historical agreement version', () => {
    const def = buildApplicationDefinition({ company: company(), agreementVersion: 'legacy-1' });
    expect(def.agreementVersion).toBe('legacy-1');
    expect(def.agreements.every((a) => a.version === 'legacy-1')).toBe(true);
  });

  it('does NOT embed agreement text — that belongs to the submission snapshot', () => {
    const def = buildApplicationDefinition({ company: company() });
    expect(def.agreements.every((a) => a.body === undefined)).toBe(true);
  });
});
