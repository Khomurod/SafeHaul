const {
  AGREEMENTS,
  CURRENT_AGREEMENT_VERSION,
  legacySubstitution,
  renderAgreementBody,
  requiredAgreementIds,
  resolveAgreement,
  resolveAgreementSet,
} = require('../../shared/legalAgreements');

// Artificial carrier names only.
const CO = { companyName: 'Artificial Freight Co' };

/**
 * The agreements the pre-modernization consent screen actually presented, in
 * order. The Clearinghouse consent is deliberately absent: it was added by the
 * preservation work, so no historical submission can have accepted it.
 */
const LEGACY_PRESENTED_IDS = ['electronicSignature', 'fcraDisclosure', 'pspDisclosure'];

describe('agreement set completeness — no required agreement may go missing', () => {
  it('always presents all four agreements in a fixed order', () => {
    expect(requiredAgreementIds()).toEqual([
      'electronicSignature', 'fcraDisclosure', 'pspDisclosure', 'clearinghouseConsent',
    ]);
  });

  // 49 CFR Part 382 subpart G: the Clearinghouse full-query consent is mandatory.
  it('includes the FMCSA Clearinghouse consent, and marks it required', () => {
    expect(AGREEMENTS.clearinghouseConsent.required).toBe(true);
    const ids = resolveAgreementSet(CO).map((a) => a.id);
    expect(ids).toContain('clearinghouseConsent');
  });

  it('marks every presented agreement as needing a signature', () => {
    expect(resolveAgreementSet(CO).every((a) => a.requiresSignature)).toBe(true);
  });

  it('resolves the set at the current version by default', () => {
    expect(resolveAgreementSet(CO).every((a) => a.version === CURRENT_AGREEMENT_VERSION)).toBe(true);
  });
});

describe('company interpolation — the naive replaceAll bug is gone', () => {
  it('substitutes explicit placeholders only', () => {
    expect(renderAgreementBody('Consent to {{companyName}} for a query.', CO))
      .toBe('Consent to Artificial Freight Co for a query.');
  });

  // THE BUG: replaceAll('Company', name) also rewrote the DEFINED TERM, turning
  // '"We," "Us," and "Company" refer to...' into a sentence that no longer parsed.
  it('leaves the defined term "Company" intact in v1', () => {
    const body = resolveAgreement('electronicSignature', 'v1', CO).body;
    expect(body).toContain('"We," "Us," and "Company" refer to Artificial Freight Co');
    expect(body).not.toContain('"Artificial Freight Co" refer to');
  });

  it('names the carrier in every v1 agreement and leaves no placeholder behind', () => {
    for (const a of resolveAgreementSet(CO)) {
      expect(a.body).toContain('Artificial Freight Co');
      expect(a.body).not.toContain('{{companyName}}');
    }
  });

  it('states plainly when the carrier name is not on record rather than rendering a blank', () => {
    const body = renderAgreementBody('Consent to {{companyName}}.', { companyName: '   ' });
    expect(body).toBe('Consent to [COMPANY NAME NOT ON RECORD].');
  });
});

describe('legacy-1 is a frozen forensic record of what old applications displayed', () => {
  it('reproduces the old substitution bug-for-bug, including the defined term', () => {
    // Faithfulness beats correctness here: this is what the driver actually saw.
    const body = resolveAgreement('electronicSignature', 'legacy-1', CO).body;
    expect(body).toContain('"We," "Us," and "Artificial Freight Co" refer to the motor carrier');
    expect(body).not.toContain('{{companyName}}');
  });

  it('replaces both legacy tokens, as the old generator did', () => {
    expect(legacySubstitution('Company and Prospective Employer', CO))
      .toBe('Artificial Freight Co and Artificial Freight Co');
  });

  it('falls back to the old placeholder when no name is available', () => {
    expect(legacySubstitution('Company', {})).toBe('[COMPANY NAME]');
  });

  it('flags legacy resolutions so consumers can label reconstructed history', () => {
    expect(resolveAgreement('fcraDisclosure', 'legacy-1', CO).legacy).toBe(true);
    expect(resolveAgreement('fcraDisclosure', 'v1', CO).legacy).toBe(false);
  });

  it('offers legacy-1 for every agreement the old consent screen presented', () => {
    for (const id of LEGACY_PRESENTED_IDS) {
      expect(() => resolveAgreement(id, 'legacy-1', CO)).not.toThrow();
    }
  });

  it('has NO legacy-1 for the Clearinghouse consent, which was never presented', () => {
    // The pre-modernization consent screen showed three agreements. The old
    // browser PDF nevertheless printed a Clearinghouse page and stamped the
    // driver's signature on it — an assertion they never made.
    //
    // Refusing to resolve `clearinghouseConsent` at legacy-1 is what stops a
    // reconstruction from reviving that false claim. If someone adds a
    // legacy-1 body here, this test fails and says why.
    expect(() => resolveAgreement('clearinghouseConsent', 'legacy-1', CO)).toThrow(/Unknown version/);
  });

  it('leaves the Clearinghouse consent out of the legacy set entirely', () => {
    const legacyIds = resolveAgreementSet({ ...CO, version: 'legacy-1' }).map((a) => a.id);
    expect(legacyIds).toEqual(LEGACY_PRESENTED_IDS);
    expect(legacyIds).not.toContain('clearinghouseConsent');
  });
});

describe('legal substance is identical between legacy-1 and v1', () => {
  // Only mechanical changes were allowed. Every way of naming the carrier is
  // normalised to one token, so what remains to compare is the actual terms:
  // if any obligation, authorization or right had been added, removed or
  // reworded, these assertions would fail.
  const normalise = (text) => text
    .split('Artificial Freight Co').join('«CO»')
    .split('Prospective Employer').join('«CO»')
    .split('Company').join('«CO»')
    .replace(/\s+/g, ' ')
    .trim();

  // The DEFINITIONS clause is the one clause that legitimately differs, because
  // fixing the defined-term bug necessarily changes its shape:
  //   legacy-1: "We," "Us," and "«CO»" refer to the motor carrier ...
  //   v1:       "We," "Us," and "«CO»" refer to «CO», the motor carrier ...
  // Both identify the same carrier; v1 additionally keeps "Company" as a defined
  // term instead of overwriting it. Collapse that one difference, and nothing else.
  const collapseDefinitionsClause = (text) =>
    text.replace('refer to «CO», the motor carrier', 'refer to the motor carrier');

  it.each(LEGACY_PRESENTED_IDS)('%s carries the same terms in both versions', (id) => {
    const legacy = normalise(resolveAgreement(id, 'legacy-1', CO).body);
    const current = collapseDefinitionsClause(normalise(resolveAgreement(id, 'v1', CO).body));
    expect(current).toBe(legacy);
  });

  // Assert the one intended delta explicitly, so it can never drift unnoticed.
  it('names the carrier in the v1 DEFINITIONS clause while keeping the defined term', () => {
    const legacy = resolveAgreement('electronicSignature', 'legacy-1', CO).body;
    const current = resolveAgreement('electronicSignature', 'v1', CO).body;

    expect(legacy).toContain('"Artificial Freight Co" refer to the motor carrier to which you are applying');
    expect(current).toContain('"Company" refer to Artificial Freight Co, the motor carrier to which you are applying');
  });
});

describe('unknown ids and versions fail loudly', () => {
  // Falling back silently could show a driver wording we did not record.
  it('throws on an unknown agreement', () => {
    expect(() => resolveAgreement('notAnAgreement', 'v1', CO)).toThrow(/Unknown legal agreement/);
  });

  it('throws on an unknown version', () => {
    expect(() => resolveAgreement('fcraDisclosure', 'v99', CO)).toThrow(/Unknown version/);
  });
});
