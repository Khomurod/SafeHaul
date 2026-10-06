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
  it('always presents all five agreements in a fixed order', () => {
    expect(requiredAgreementIds()).toEqual(['mvrAuthorization', 'electronicSignature', 'fcraDisclosure', 'pspDisclosure', 'clearinghouseConsent']);
  });

  // ONE MVR authorization in the whole application: read and answered on the
  // Motor Vehicle Record step, never a second time on the consent step.
  it('presents the MVR authorization on the driving-record step, answered Yes/No rather than signed', () => {
    const mvr = resolveAgreementSet(CO).find((a) => a.id === 'mvrAuthorization');
    expect(mvr.presentedOn).toBe('drivingRecord');
    expect(mvr.requiresSignature).toBe(false);
    expect(mvr.body).toContain('Artificial Freight Co');
    expect(mvr.body).toContain('49 CFR 391.23');
    expect(AGREEMENTS.mvrAuthorization.versions['legacy-1']).toBeUndefined();
  });

  // 49 CFR Part 382 subpart G: the Clearinghouse full-query consent is mandatory.
  it('includes the FMCSA Clearinghouse consent, and marks it required', () => {
    expect(AGREEMENTS.clearinghouseConsent.required).toBe(true);
    const ids = resolveAgreementSet(CO).map((a) => a.id);
    expect(ids).toContain('clearinghouseConsent');
  });

  it('marks every consent-step agreement as needing a signature', () => {
    const consentStep = resolveAgreementSet(CO).filter((a) => a.presentedOn === 'consent');
    expect(consentStep).toHaveLength(4);
    expect(consentStep.every((a) => a.requiresSignature)).toBe(true);
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

describe('v2 — each changed agreement follows its primary source', () => {
  const { createHash } = require('crypto');
  const v2 = (id) => resolveAgreement(id, 'v2', CO);
  const { submittableVersions } = require('../../shared/legalAgreements');

  it('presents FMCSA\'s mandatory PSP language word for word, the carrier in both blanks', () => {
    // https://www.psp.fmcsa.dot.gov/PspApi/documents/PSPDisclosureandAuthorizationForm.pdf
    // ("LAST UPDATED 2/11/2016"), from "IMPORTANT DISCLOSURE" to "authorized
    // above.", with its two blanks as "_" and whitespace folded. The language
    // "must be used in whole, exactly as provided", so any edit changes this hash.
    const template = AGREEMENTS.pspDisclosure.versions.v2.body;
    const folded = template
      .replace(/\{\{companyName\}\}/g, '_')
      .replace(/\s+/g, ' ')
      .trim();
    expect(createHash('sha256').update(folded, 'utf8').digest('hex'))
      .toBe('c6ffbcd14c36a0948f405f81f33be18f2151546a5fd0b334284f2272c263a222');
    expect(template.match(/\{\{companyName\}\}/g)).toHaveLength(2);
    expect(v2('pspDisclosure').body.startsWith('IMPORTANT DISCLOSURE REGARDING BACKGROUND REPORTS FROM THE PSP Online Service')).toBe(true);
    expect(v2('pspDisclosure').body).toContain('I authorize Artificial Freight Co (“Prospective Employer”)');
  });

  it('keeps the FCRA document to the disclosure and its authorization, and links the summary of rights beside it', () => {
    const fcra = v2('fcraDisclosure');
    expect(fcra.body).toContain('AUTHORIZATION');
    // What a stand-alone disclosure must not carry, and v1 did.
    expect(fcra.body).not.toMatch(/without reservation|release|acknowledge|summary of rights/i);
    expect(fcra.links).toEqual([{
      label: 'A Summary of Your Rights Under the Fair Credit Reporting Act',
      url: 'https://files.consumerfinance.gov/f/documents/bcfp_consumer-rights-summary_2018-09.pdf',
      note: 'Provided with this disclosure. Please read it before you agree.',
    }]);
  });

  it('asks only for the limited-query consent the Clearinghouse accepts outside itself', () => {
    const consent = v2('clearinghouseConsent');
    expect(consent.body).toMatch(/^GENERAL CONSENT FOR LIMITED QUERIES/);
    expect(consent.body).toContain('This consent covers multiple limited queries for the duration of my employment with Artificial Freight Co.');
    expect(consent.body).not.toMatch(/full query/i);
    expect(consent.title).toBe('FMCSA DRUG AND ALCOHOL CLEARINGHOUSE CONSENT');
    const [where] = consent.links;
    expect(where.url).toBe('https://clearinghouse.fmcsa.dot.gov');
    expect(where.note).toContain('Artificial Freight Co, it must also run a full query');
  });

  it('moves the unchanged MVR authorization and electronic-signature agreement to v2 word for word', () => {
    for (const id of ['mvrAuthorization', 'electronicSignature']) {
      expect(v2(id).body).toBe(resolveAgreement(id, 'v1', CO).body);
      expect(v2(id).links).toEqual([]);
    }
  });

  it('is the current version, while v1 stays submittable for an application accepted before it', () => {
    expect(CURRENT_AGREEMENT_VERSION).toBe('v2');
    expect(submittableVersions()).toEqual(new Set(['v1', 'v2']));
    expect(resolveAgreement('fcraDisclosure', 'v1', CO).links).toEqual([]);
  });
});
