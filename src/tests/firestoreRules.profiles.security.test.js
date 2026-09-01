// firestore.rules security, part 3 of 4: SEC-002 profile visibility (who
// may read whose user document) and the immutable submission snapshot.
// Split from the original single-file `firestore.rules.security.test.js`;
// every test body is verbatim, and the shared harness (rules text, emulator
// gate, environment boot) lives in `firestoreRules.support.js`. The describe
// name is unchanged so every test's full name is identical to the original's.
import { afterAll, beforeAll, beforeEach, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, documentId, getDoc, getDocs, query, setDoc, updateDoc, where } from 'firebase/firestore';
import { describeFirestore, createRulesTestEnv } from './firestoreRules.support.js';

let testEnv;

describeFirestore('firestore.rules security regressions', () => {
  beforeAll(async () => {
    testEnv = await createRulesTestEnv('profiles');
  });

  afterAll(async () => {
    if (testEnv) {
      await testEnv.cleanup();
    }
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
  });

  it('SEC-002: staff read a driver profile ONLY when they share a company', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const adminDb = context.firestore();
      await setDoc(doc(adminDb, 'drivers', 'driver-a'), {
        personalInfo: { firstName: 'Ann' }, companyIds: ['company-a'],
      });
      await setDoc(doc(adminDb, 'drivers', 'driver-b'), {
        personalInfo: { firstName: 'Bob' }, companyIds: ['company-b'],
      });
      // Legacy profile with no companyIds field (pre-backfill) must NOT be readable by staff.
      await setDoc(doc(adminDb, 'drivers', 'driver-legacy'), {
        personalInfo: { firstName: 'Old' },
      });
    });

    const recruiterA = testEnv.authenticatedContext('rec-a', {
      roles: { 'company-a': 'recruiter' },
      companyTeamIds: ['company-a'],
    }).firestore();

    // (1) connected to company-a -> allowed
    await assertSucceeds(getDoc(doc(recruiterA, 'drivers', 'driver-a')));
    // (2) company-b only -> DENIED
    await assertFails(getDoc(doc(recruiterA, 'drivers', 'driver-b')));
    // legacy / no companyIds -> DENIED until backfilled
    await assertFails(getDoc(doc(recruiterA, 'drivers', 'driver-legacy')));
  });

  it('SEC-002: driver reads own profile; super admin reads any profile', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const adminDb = context.firestore();
      await setDoc(doc(adminDb, 'drivers', 'driver-b'), {
        personalInfo: { firstName: 'Bob' }, companyIds: ['company-b'],
      });
    });
    const ownerDb = testEnv.authenticatedContext('driver-b').firestore();
    const superDb = testEnv.authenticatedContext('super-1', { globalRole: 'super_admin' }).firestore();

    // (4) owner reads own profile
    await assertSucceeds(getDoc(doc(ownerDb, 'drivers', 'driver-b')));
    // (5) super admin reads any profile
    await assertSucceeds(getDoc(doc(superDb, 'drivers', 'driver-b')));
  });

  it('SEC-002: staff read a teammate user ONLY when they share a company', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const adminDb = context.firestore();
      await setDoc(doc(adminDb, 'users', 'user-a'), { name: 'A', email: 'a@x.com', companyIds: ['company-a'] });
      await setDoc(doc(adminDb, 'users', 'user-b'), { name: 'B', email: 'b@x.com', companyIds: ['company-b'] });
    });

    const recruiterA = testEnv.authenticatedContext('rec-a', {
      roles: { 'company-a': 'recruiter' },
      companyTeamIds: ['company-a'],
    }).firestore();

    // teammate in same company -> allowed
    await assertSucceeds(getDoc(doc(recruiterA, 'users', 'user-a')));
    // (3) company-B-only staff user -> DENIED
    await assertFails(getDoc(doc(recruiterA, 'users', 'user-b')));
  });

  // Why "Manage Team & Links" showed valid members as "Unknown / No Email": the
  // browser resolved each row by reading users/{membership.userId} directly, and
  // that read depends on TWO server-maintained things being present. When either is
  // absent the read is denied, and the modal silently rendered a placeholder member.
  //
  // These cases are the denial itself, reproduced. The fix does not loosen any of
  // them — `listCompanyTeam` resolves identity with the Admin SDK instead, so the
  // roster no longer depends on this read succeeding from a browser.
  it('SEC-002: a company admin is DENIED a teammate profile that has no companyIds', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const adminDb = context.firestore();
      await setDoc(doc(adminDb, 'users', 'mate-ok'), {
        name: 'Ann', email: 'ann@x.com', companyIds: ['company-a'],
      });
      // Profile predating SEC-002 / never rewritten since: no companyIds field.
      await setDoc(doc(adminDb, 'users', 'mate-legacy'), { name: 'Old', email: 'old@x.com' });
      // What onMembershipWrite used to write for a member holding a role outside
      // its staff allowlist: an EMPTY companyIds, which intersects nothing.
      await setDoc(doc(adminDb, 'users', 'mate-empty'), {
        name: 'Empty', email: 'empty@x.com', companyIds: [],
      });
    });

    const adminA = testEnv.authenticatedContext('admin-a', {
      roles: { 'company-a': 'company_admin' },
      companyTeamIds: ['company-a'],
    }).firestore();

    // Healthy record -> readable, which is why SOME rows always rendered correctly.
    await assertSucceeds(getDoc(doc(adminA, 'users', 'mate-ok')));
    // Missing companyIds -> denied. Rendered as "Unknown / No Email".
    await assertFails(getDoc(doc(adminA, 'users', 'mate-legacy')));
    // Empty companyIds -> denied for the same reason.
    await assertFails(getDoc(doc(adminA, 'users', 'mate-empty')));
  });

  it('SEC-002: a reader whose token lacks companyTeamIds is DENIED every teammate', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users', 'mate-ok'), {
        name: 'Ann', email: 'ann@x.com', companyIds: ['company-a'],
      });
    });

    // A company admin holding a token minted before the companyTeamIds claim
    // existed (i.e. not refreshed since). The teammate's profile is perfectly
    // healthy; the READER is what makes the read fail — so the whole roster
    // collapsed to placeholders except the caller's own row.
    const staleAdmin = testEnv.authenticatedContext('admin-stale', {
      roles: { 'company-a': 'company_admin' },
    }).firestore();

    await assertFails(getDoc(doc(staleAdmin, 'users', 'mate-ok')));
    // ...but their OWN profile is still readable via isOwner, which is exactly the
    // "some users display correctly" symptom.
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users', 'admin-stale'), { name: 'Self', email: 'self@x.com' });
    });
    await assertSucceeds(getDoc(doc(staleAdmin, 'users', 'admin-stale')));
  });

  it('SEC-002: user reads own profile but cannot self-edit companyIds', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const adminDb = context.firestore();
      await setDoc(doc(adminDb, 'users', 'user-a'), { name: 'A', email: 'a@x.com', companyIds: ['company-a'] });
    });
    const ownerDb = testEnv.authenticatedContext('user-a', { roles: {} }).firestore();

    await assertSucceeds(getDoc(doc(ownerDb, 'users', 'user-a')));
    await assertSucceeds(updateDoc(doc(ownerDb, 'users', 'user-a'), { name: 'A renamed' }));
    // Privilege field: a user must NOT grant themselves cross-company visibility.
    await assertFails(updateDoc(doc(ownerDb, 'users', 'user-a'), { companyIds: ['company-a', 'company-b'] }));
  });

  it('SEC-002: staff cannot dump all users, but a same-company documentId-in query works', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const adminDb = context.firestore();
      await setDoc(doc(adminDb, 'users', 'user-a1'), { name: 'A1', companyIds: ['company-a'] });
      await setDoc(doc(adminDb, 'users', 'user-a2'), { name: 'A2', companyIds: ['company-a'] });
      await setDoc(doc(adminDb, 'users', 'user-b1'), { name: 'B1', companyIds: ['company-b'] });
    });

    const recruiterA = testEnv.authenticatedContext('rec-a', {
      roles: { 'company-a': 'recruiter' },
      companyTeamIds: ['company-a'],
    }).firestore();

    // Full-collection enumeration (would leak other tenants) -> DENIED
    await assertFails(getDocs(collection(recruiterA, 'users')));
    // Constrained teammate lookup over same-company member ids -> allowed
    await assertSucceeds(
      getDocs(query(collection(recruiterA, 'users'), where(documentId(), 'in', ['user-a1', 'user-a2']))),
    );
  });

  it('SEC-002: same-company staff can still read application docs (detail view unaffected)', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const adminDb = context.firestore();
      await setDoc(doc(adminDb, 'companies', 'company-a', 'applications', 'app1'), {
        companyId: 'company-a', applicantId: 'driver-a', driverId: 'driver-a',
        firstName: 'Ann', status: 'New Application',
      });
    });
    const recruiterA = testEnv.authenticatedContext('rec-a', {
      roles: { 'company-a': 'recruiter' },
      companyTeamIds: ['company-a'],
    }).firestore();
    // (6) application detail view for same-company staff still works
    await assertSucceeds(getDoc(doc(recruiterA, 'companies', 'company-a', 'applications', 'app1')));
  });

  // ===================================================================
  // SUBMISSION SNAPSHOT — immutability and tenant separation
  //
  // The snapshot is the frozen record of what the driver saw, answered, accepted
  // and signed. Its immutability is enforced here, not merely intended: if any
  // client could write it, a later edit to questions, company details or legal
  // wording could rewrite a signed record.
  // ===================================================================

  async function seedSnapshot(companyId = 'company-a', ownerId = 'driver-a') {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const adminDb = context.firestore();
      await setDoc(doc(adminDb, 'companies', companyId, 'applications', 'app1'), {
        companyId, applicantId: ownerId, driverId: ownerId, firstName: 'Ann',
      });
      await setDoc(doc(adminDb, 'companies', companyId, 'applications', 'app1', 'submission', 'v1'), {
        // Owner ids are stamped by the writer so the owner-read helper can match.
        applicantId: ownerId, driverId: ownerId,
        frozen: true, definitionVersion: 'abc123', agreementVersion: 'v1',
        company: { companyName: 'Artificial Freight Co' },
      });
    });
  }

  const snapshotRef = (db, companyId = 'company-a') =>
    doc(db, 'companies', companyId, 'applications', 'app1', 'submission', 'v1');

  const staffOf = (companyId, role = 'recruiter') => testEnv.authenticatedContext(`staff-${companyId}`, {
    roles: { [companyId]: role },
    companyTeamIds: [companyId],
  }).firestore();

  it('SNAPSHOT: same-company staff can read the submission snapshot', async () => {
    await seedSnapshot();
    await assertSucceeds(getDoc(snapshotRef(staffOf('company-a'))));
  });

  it('SNAPSHOT: the owning driver can read their own snapshot', async () => {
    await seedSnapshot();
    const owner = testEnv.authenticatedContext('driver-a').firestore();
    await assertSucceeds(getDoc(snapshotRef(owner)));
  });

  it('SNAPSHOT: a different driver cannot read someone else\'s snapshot', async () => {
    await seedSnapshot();
    const other = testEnv.authenticatedContext('driver-b').firestore();
    await assertFails(getDoc(snapshotRef(other)));
  });

  it('SNAPSHOT: staff of another company cannot read it (tenant separation)', async () => {
    await seedSnapshot();
    await assertFails(getDoc(snapshotRef(staffOf('company-b'), 'company-a')));
  });

  it('SNAPSHOT: a super admin can read it', async () => {
    await seedSnapshot();
    const superDb = testEnv.authenticatedContext('super-1', { globalRole: 'super_admin' }).firestore();
    await assertSucceeds(getDoc(snapshotRef(superDb)));
  });

  it('SNAPSHOT: nobody can create, update or delete it from a client', async () => {
    await seedSnapshot();

    // A company admin — the most privileged tenant role — still cannot write.
    const admin = staffOf('company-a', 'company_admin');
    await assertFails(setDoc(snapshotRef(admin), { frozen: true, tampered: true }));
    await assertFails(updateDoc(snapshotRef(admin), { agreementVersion: 'v2' }));
    await assertFails(deleteDoc(snapshotRef(admin)));

    // The owning driver cannot rewrite what they signed either.
    const owner = testEnv.authenticatedContext('driver-a').firestore();
    await assertFails(updateDoc(snapshotRef(owner), { 'company.companyName': 'Renamed Co' }));
    await assertFails(deleteDoc(snapshotRef(owner)));
  });

  it('SNAPSHOT: not even a super admin can edit a signed record from a client', async () => {
    await seedSnapshot();
    const superDb = testEnv.authenticatedContext('super-1', { globalRole: 'super_admin' }).firestore();
    await assertFails(updateDoc(snapshotRef(superDb), { agreementVersion: 'v2' }));
    await assertFails(deleteDoc(snapshotRef(superDb)));
  });

  it('SNAPSHOT: a new version cannot be forged alongside the original', async () => {
    await seedSnapshot();
    const admin = staffOf('company-a', 'company_admin');
    await assertFails(setDoc(
      doc(admin, 'companies', 'company-a', 'applications', 'app1', 'submission', 'v2'),
      { frozen: true, definitionVersion: 'forged' },
    ));
  });

  // ===================================================================
  // FUNC-005: logged-in driver re-submit / edit of their own application
  // ===================================================================
});
