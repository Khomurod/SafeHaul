/**
 * Company-specific legal wording — versioned, content-addressed, immutable.
 *
 * The property under test: once an applicant has been shown version X of a
 * company's wording, nothing a super admin does later can change what version X
 * says, and nothing a client can send can make a submission claim a version the
 * company never published.
 */
const {
  applyCompanyWording,
  companyVersionId,
  isCompanyVersion,
  normalizeWordingDoc,
  normalizeWordingDocs,
  publishWordingVersion,
  resolveAgreementVersions,
  resolveCompanyAgreement,
  revertToPlatformWording,
} = require('../../shared/companyAgreementWording');
const { resolveAgreementSet } = require('../../shared/legalAgreements');
const { buildApplicationDefinition } = require('../../shared/applicationDefinition');
const { buildSubmissionSnapshot } = require('../../shared/submissionSnapshot');

const FIRST = 'I authorize {{companyName}} to obtain my motor vehicle record from every state where I have held a licence in the past three years.';
const SECOND = 'Second wording: I authorize {{companyName}} to obtain my motor vehicle record, and I understand my right to dispute it.';
const CO = { companyName: 'Artificial Freight Co' };

describe('publishing', () => {
  it('assigns a content-addressed company version and points the company at it', () => {
    const doc = publishWordingVersion(null, 'mvrAuthorization', FIRST, { createdBy: 'sa-1', now: '2026-09-02T00:00:00Z' });
    expect(doc.currentVersion).toBe(companyVersionId('mvrAuthorization', FIRST));
    expect(isCompanyVersion(doc.currentVersion)).toBe(true);
    expect(doc.versions[doc.currentVersion]).toMatchObject({ body: FIRST, createdBy: 'sa-1', createdAt: '2026-09-02T00:00:00Z' });
  });

  it('adds a version and moves the pointer; the earlier version is untouched', () => {
    const first = publishWordingVersion(null, 'mvrAuthorization', FIRST, { now: '2026-09-02T00:00:00Z' });
    const second = publishWordingVersion(first, 'mvrAuthorization', SECOND, { now: '2026-09-03T00:00:00Z' });
    expect(Object.keys(second.versions)).toHaveLength(2);
    expect(second.versions[first.currentVersion].body).toBe(FIRST);
    expect(second.currentVersion).toBe(companyVersionId('mvrAuthorization', SECOND));
  });

  it('republishing identical text re-uses the version rather than minting a duplicate', () => {
    const first = publishWordingVersion(null, 'mvrAuthorization', FIRST, { now: '2026-09-02T00:00:00Z' });
    const again = publishWordingVersion(first, 'mvrAuthorization', `${FIRST}\r\n`, { now: '2026-09-09T00:00:00Z' });
    expect(Object.keys(again.versions)).toHaveLength(1);
    expect(again.versions[first.currentVersion].createdAt).toBe('2026-09-02T00:00:00Z');
  });

  it('refuses text that is empty, too short, too long, or for an unknown agreement', () => {
    expect(() => publishWordingVersion(null, 'mvrAuthorization', '')).toThrow(/at least/);
    expect(() => publishWordingVersion(null, 'mvrAuthorization', 'x'.repeat(20001))).toThrow(/at most/);
    expect(() => publishWordingVersion(null, 'notAnAgreement', FIRST)).toThrow(/Unknown legal agreement/);
  });

  it('reverting keeps the history and clears the pointer', () => {
    const first = publishWordingVersion(null, 'mvrAuthorization', FIRST, { now: '2026-09-02T00:00:00Z' });
    const reverted = revertToPlatformWording(first, 'mvrAuthorization');
    expect(reverted.currentVersion).toBeNull();
    expect(reverted.versions[first.currentVersion].body).toBe(FIRST);
    expect(revertToPlatformWording(null, 'mvrAuthorization')).toBeNull();
  });
});

describe('reading a stored document', () => {
  it('drops a version whose id does not match its own text — it was never shown to anyone', () => {
    const good = publishWordingVersion(null, 'fcraDisclosure', FIRST);
    const tampered = {
      currentVersion: good.currentVersion,
      versions: { ...good.versions, 'c-000000000000': { body: 'Forged wording that nobody was ever shown by anybody at all.' } },
    };
    const doc = normalizeWordingDoc('fcraDisclosure', tampered);
    expect(Object.keys(doc.versions)).toEqual([good.currentVersion]);
  });

  it('drops an edited version body, because the hash no longer matches', () => {
    const good = publishWordingVersion(null, 'fcraDisclosure', FIRST);
    const edited = { currentVersion: good.currentVersion, versions: { [good.currentVersion]: { body: `${FIRST} (quietly edited)` } } };
    expect(normalizeWordingDoc('fcraDisclosure', edited)).toBeNull();
  });

  it('clears a pointer to a version that does not exist', () => {
    const good = publishWordingVersion(null, 'fcraDisclosure', FIRST);
    const doc = normalizeWordingDoc('fcraDisclosure', { ...good, currentVersion: 'c-ffffffffffff' });
    expect(doc.currentVersion).toBeNull();
  });

  it('ignores unknown agreements and malformed documents', () => {
    expect(normalizeWordingDocs({ bogus: { versions: {} }, mvrAuthorization: 'nope', fcraDisclosure: null })).toEqual({});
  });
});

describe('what the applicant is shown and what the record binds to', () => {
  const wording = () => normalizeWordingDocs({
    mvrAuthorization: publishWordingVersion(null, 'mvrAuthorization', FIRST, { now: '2026-09-02T00:00:00Z' }),
  });

  it('applies the company wording only where it is published, with the carrier name filled in', () => {
    const set = applyCompanyWording(resolveAgreementSet(CO), wording(), CO);
    const mvr = set.find((a) => a.id === 'mvrAuthorization');
    expect(mvr.companyWording).toBe(true);
    expect(mvr.body).toBe(FIRST.replace('{{companyName}}', CO.companyName));
    expect(mvr.presentedOn).toBe('drivingRecord');
    expect(set.find((a) => a.id === 'fcraDisclosure').version).toBe('v1');
  });

  it('honours the version the applicant was shown, not the one published since', () => {
    const first = publishWordingVersion(null, 'mvrAuthorization', FIRST, { now: '2026-09-02T00:00:00Z' });
    const second = publishWordingVersion(first, 'mvrAuthorization', SECOND, { now: '2026-09-03T00:00:00Z' });
    const docs = normalizeWordingDocs({ mvrAuthorization: second });
    const versions = resolveAgreementVersions({
      platformVersion: 'v1',
      acceptances: { mvrAuthorization: { accepted: true, version: first.currentVersion } },
      wordingDocs: docs,
    });
    expect(versions.mvrAuthorization).toBe(first.currentVersion);
    expect(resolveCompanyAgreement('mvrAuthorization', first.currentVersion, docs, CO).body).toContain('past three years');
  });

  it('refuses a company version the company never published', () => {
    const versions = resolveAgreementVersions({
      platformVersion: 'v1',
      acceptances: { mvrAuthorization: { accepted: true, version: 'c-deadbeefcafe' } },
      wordingDocs: wording(),
    });
    // Falls back to the company's current wording — never to the forged id.
    expect(versions.mvrAuthorization).toBe(wording().mvrAuthorization.currentVersion);
    expect(resolveCompanyAgreement('mvrAuthorization', 'c-deadbeefcafe', wording(), CO)).toBeNull();
  });

  it('uses the platform version for agreements the company has not customised', () => {
    const versions = resolveAgreementVersions({ platformVersion: 'v1', acceptances: {}, wordingDocs: wording() });
    expect(versions.fcraDisclosure).toBe('v1');
    expect(versions.clearinghouseConsent).toBe('v1');
  });

  it('the snapshot freezes the company text under the company version, and later publishing cannot change it', () => {
    const first = publishWordingVersion(null, 'mvrAuthorization', FIRST, { now: '2026-09-02T00:00:00Z' });
    const docsAtSubmission = normalizeWordingDocs({ mvrAuthorization: first });
    const definition = buildApplicationDefinition({
      company: { companyName: CO.companyName },
      agreementVersion: 'v1',
      agreementVersions: resolveAgreementVersions({
        platformVersion: 'v1',
        acceptances: { mvrAuthorization: { accepted: true, version: first.currentVersion } },
        wordingDocs: docsAtSubmission,
      }),
    });
    const snapshot = buildSubmissionSnapshot({
      definition,
      formData: { 'consent-mvr': 'yes' },
      acceptances: { mvrAuthorization: { accepted: true, acceptedAt: '2026-09-02T10:00:00Z', version: first.currentVersion } },
      companyWording: docsAtSubmission,
      submittedAt: '2026-09-02T10:00:00Z',
    });
    const record = snapshot.agreements.find((a) => a.id === 'mvrAuthorization');
    expect(record.version).toBe(first.currentVersion);
    expect(record.companyWording).toBe(true);
    expect(record.accepted).toBe(true);
    expect(record.body).toBe(FIRST.replace('{{companyName}}', CO.companyName));

    // The company publishes new wording afterwards. The frozen record is a
    // separate object; re-resolving the OLD version still yields the OLD text.
    const second = publishWordingVersion(first, 'mvrAuthorization', SECOND, { now: '2026-09-03T00:00:00Z' });
    const later = normalizeWordingDocs({ mvrAuthorization: second });
    expect(resolveCompanyAgreement('mvrAuthorization', first.currentVersion, later, CO).body).toBe(record.body);
    // And the platform agreements in the same snapshot are unaffected.
    expect(snapshot.agreements.find((a) => a.id === 'fcraDisclosure').version).toBe('v1');
  });
});
