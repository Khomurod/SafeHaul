// firestore.rules security, part 4 of 4: FUNC-005 driver application
// writes, SEC-003 recruiter links, SEC-004 guest creates, lead upload
// binding, application companyId binding, and the removed collections.
// Split from the original single-file `firestore.rules.security.test.js`;
// every test body is verbatim, and the shared harness (rules text, emulator
// gate, environment boot) lives in `firestoreRules.support.js`. The describe
// name is unchanged so every test's full name is identical to the original's.
import { afterAll, beforeAll, beforeEach, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { describeFirestore, createRulesTestEnv } from './firestoreRules.support.js';

let testEnv;

describeFirestore('firestore.rules security regressions', () => {
  beforeAll(async () => {
    testEnv = await createRulesTestEnv('applications');
  });

  afterAll(async () => {
    if (testEnv) {
      await testEnv.cleanup();
    }
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
  });

  const driverCtx = () =>
    testEnv.authenticatedContext('driver-1', { email: 'd@x.com', email_verified: true }).firestore();

  async function seedDriverApp(extra = {}) {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const adminDb = context.firestore();
      await setDoc(doc(adminDb, 'companies', 'co1', 'applications', 'driver-1'), {
        companyId: 'co1',
        applicantId: 'driver-1',
        driverId: 'driver-1',
        status: 'New Application',
        firstName: 'Al',
        phone: '111',
        createdAt: 'orig-created-at',
        ...extra,
      });
    });
  }

  it('FUNC-005 (1): first-time driver submission (deterministic id) succeeds', async () => {
    // Full create payload — create branch has no field allow-list.
    await assertSucceeds(
      setDoc(doc(driverCtx(), 'companies', 'co1', 'applications', 'driver-1'), {
        companyId: 'co1',
        applicantId: 'driver-1',
        driverId: 'driver-1',
        status: 'New Application',
        firstName: 'Al',
        confirmationNumber: 'ABC123',
        createdAt: 'first-write',
      }),
    );
  });

  it('FUNC-005 (2,3,8): re-submit/edit with create-only fields dropped succeeds and preserves recruiter status', async () => {
    // Recruiter has already advanced the pipeline + left a note.
    await seedDriverApp({ status: 'In Process' });
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(
        doc(context.firestore(), 'companies', 'co1', 'applications', 'driver-1', 'internal_notes', 'n1'),
        { text: 'called driver' },
      );
    });

    const driverDb = driverCtx();
    // Client-shaped re-submit: allow-listed fields only (NO status/createdAt/confirmationNumber).
    await assertSucceeds(
      updateDoc(doc(driverDb, 'companies', 'co1', 'applications', 'driver-1'), {
        phone: '222',
        signatureType: 'drawn',
        lifecycle: { status: 'pending' },
      }),
    );
    // (8) driver still cannot touch recruiter-owned internal notes.
    await assertFails(
      setDoc(doc(driverDb, 'companies', 'co1', 'applications', 'driver-1', 'internal_notes', 'n2'), { text: 'x' }),
    );
  });

  it('FUNC-005: driver cannot rewrite createdAt on update (why the client strips it)', async () => {
    await seedDriverApp();
    await assertFails(
      updateDoc(doc(driverCtx(), 'companies', 'co1', 'applications', 'driver-1'), { createdAt: 'tampered' }),
    );
  });

  it('FUNC-005 (4,5,6,7): driver cannot change companyId / assignedRecruiterId / status=Hired, nor delete', async () => {
    await seedDriverApp();
    const driverDb = driverCtx();
    // (4) companyId immutable
    await assertFails(
      updateDoc(doc(driverDb, 'companies', 'co1', 'applications', 'driver-1'), { companyId: 'co2' }),
    );
    // (5) recruiter assignment is not a driver-writable field
    await assertFails(
      updateDoc(doc(driverDb, 'companies', 'co1', 'applications', 'driver-1'), { assignedRecruiterId: 'rec-x' }),
    );
    // (6) cannot self-hire
    await assertFails(
      updateDoc(doc(driverDb, 'companies', 'co1', 'applications', 'driver-1'), { status: 'Hired' }),
    );
    // (7) cannot delete their application
    await assertFails(deleteDoc(doc(driverDb, 'companies', 'co1', 'applications', 'driver-1')));
  });

  // ===================================================================
  // SEC-003: recruiter links belong to exactly one company
  // ===================================================================

  it('SEC-003: company staff create/update ONLY their own company recruiter links', async () => {
    // Seed an existing link owned by company-b.
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const adminDb = context.firestore();
      await setDoc(doc(adminDb, 'recruiter_links', 'CODEB'), {
        userId: 'rec-b', companyId: 'company-b',
      });
      await setDoc(doc(adminDb, 'recruiter_links', 'CODEA'), {
        userId: 'rec-a', companyId: 'company-a',
      });
    });

    const staffA = testEnv.authenticatedContext('rec-a', {
      roles: { 'company-a': 'recruiter' },
    }).firestore();

    // (1) create a link for their OWN company -> allowed
    await assertSucceeds(
      setDoc(doc(staffA, 'recruiter_links', 'NEWA'), { userId: 'rec-a', companyId: 'company-a' }),
    );
    // (2) update their OWN company link -> allowed
    await assertSucceeds(
      updateDoc(doc(staffA, 'recruiter_links', 'CODEA'), { userId: 'rec-a2' }),
    );
    // (3) overwrite ANOTHER company's link -> DENIED
    await assertFails(
      updateDoc(doc(staffA, 'recruiter_links', 'CODEB'), { userId: 'rec-a' }),
    );
    // create for another company -> DENIED
    await assertFails(
      setDoc(doc(staffA, 'recruiter_links', 'NEWB'), { userId: 'rec-a', companyId: 'company-b' }),
    );
    // (4) change companyId on their own link -> DENIED (companyId immutable)
    await assertFails(
      updateDoc(doc(staffA, 'recruiter_links', 'CODEA'), { companyId: 'company-b' }),
    );
  });

  it('SEC-003: anyone (incl. unauthenticated guest) can resolve a recruiter link by reading it', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'recruiter_links', 'CODEA'), {
        userId: 'rec-a', companyId: 'company-a',
      });
    });
    // (5) public/guest resolve still works
    const guestDb = testEnv.unauthenticatedContext().firestore();
    await assertSucceeds(getDoc(doc(guestDb, 'recruiter_links', 'CODEA')));
  });

  // ===================================================================
  // SEC-004: no unauthenticated direct application creation
  // ===================================================================

  it('SEC-004: an unauthenticated guest cannot directly create an application document', async () => {
    const guestDb = testEnv.unauthenticatedContext().firestore();
    // Even with a well-formed, deterministic-id payload, the direct client write is denied.
    await assertFails(
      setDoc(doc(guestDb, 'companies', 'co1', 'applications', 'hash123'), {
        companyId: 'co1',
        applicantId: 'hash123',
        firstName: 'Spam',
        status: 'New Application',
      }),
    );
    // (6) fake/junk direct creation is likewise denied.
    await assertFails(
      setDoc(doc(guestDb, 'companies', 'co1', 'applications', 'junk1'), {
        companyId: 'co1', applicantId: 'junk1', status: 'Hired',
      }),
    );
  });

  it('SEC-004: authenticated applicant and company staff can still create applications', async () => {
    // Authenticated driver, deterministic id (applicationId === applicantId === uid).
    const driverDb = testEnv.authenticatedContext('driver-9', { email: 'd9@x.com', email_verified: true }).firestore();
    await assertSucceeds(
      setDoc(doc(driverDb, 'companies', 'co1', 'applications', 'driver-9'), {
        companyId: 'co1', applicantId: 'driver-9', driverId: 'driver-9', status: 'New Application',
      }),
    );

    // Company team manual entry (bypasses deterministic-id check, valid ATS status).
    const staffDb = testEnv.authenticatedContext('rec-1', { roles: { co1: 'recruiter' } }).firestore();
    await assertSucceeds(
      setDoc(doc(staffDb, 'companies', 'co1', 'applications', 'manual-1'), {
        companyId: 'co1', applicantId: 'manual-1', firstName: 'Walk', status: 'New Lead',
      }),
    );
  });

  // ===================================================================
  // Phase 7: lead upload/import must work for allowed roles (companyId-bound)
  // ===================================================================

  it('LEAD-UPLOAD: lead create requires the companyId field (tenant binding)', async () => {
    const adminDb = testEnv.authenticatedContext('admin-a', {
      roles: { 'company-a': 'company_admin' },
    }).firestore();

    // Missing companyId in the body -> DENIED by tenantCompanyIdMatches. This is
    // the regression that made bulk/quick lead creation fail; the client must
    // stamp companyId to match the path.
    await assertFails(
      setDoc(doc(adminDb, 'companies', 'company-a', 'leads', 'no-cid'), {
        firstName: 'Nomatch', status: 'New Lead',
      }),
    );
    // With companyId matching the path -> allowed.
    await assertSucceeds(
      setDoc(doc(adminDb, 'companies', 'company-a', 'leads', 'ok'), {
        companyId: 'company-a', firstName: 'Ok', status: 'New Lead',
      }),
    );
  });

  it('LEAD-UPLOAD: recruiter can create/import company-scoped leads, but not into another company', async () => {
    const recruiterA = testEnv.authenticatedContext('rec-a', {
      roles: { 'company-a': 'recruiter' },
    }).firestore();

    // Recruiter import into their OWN company (companyId matches path) -> allowed.
    await assertSucceeds(
      setDoc(doc(recruiterA, 'companies', 'company-a', 'leads', 'lead-a'), {
        companyId: 'company-a', firstName: 'Imported', status: 'New Lead',
      }),
    );
    // Into ANOTHER company -> denied (not company team of company-b).
    await assertFails(
      setDoc(doc(recruiterA, 'companies', 'company-b', 'leads', 'lead-b'), {
        companyId: 'company-b', firstName: 'CrossTenant', status: 'New Lead',
      }),
    );
    // Even writing a company-b lead under the company-a path (spoofed companyId) -> denied.
    await assertFails(
      setDoc(doc(recruiterA, 'companies', 'company-a', 'leads', 'spoof'), {
        companyId: 'company-b', firstName: 'Spoof', status: 'New Lead',
      }),
    );
  });

  // ===================================================================
  // APP-COMPANYID: application create must stamp companyId matching the path
  // (mirrors the leads tenant binding; blocks staff cross-tenant misfiling)
  // ===================================================================

  it('APP-COMPANYID: staff cannot create an application whose companyId != path', async () => {
    const staffA = testEnv.authenticatedContext('rec-a', {
      roles: { 'company-a': 'recruiter' },
    }).firestore();

    // (1) Spoofed companyId in the body (company-b) under the company-a path -> DENIED.
    await assertFails(
      setDoc(doc(staffA, 'companies', 'company-a', 'applications', 'spoof-1'), {
        companyId: 'company-b', applicantId: 'spoof-1', firstName: 'Spoof', status: 'New Lead',
      }),
    );
    // (2) Missing companyId entirely -> DENIED (tenant binding requires the field).
    await assertFails(
      setDoc(doc(staffA, 'companies', 'company-a', 'applications', 'nocid-1'), {
        applicantId: 'nocid-1', firstName: 'NoCid', status: 'New Lead',
      }),
    );
    // (3) Correct companyId matching the path -> ALLOWED (legit manual entry preserved).
    await assertSucceeds(
      setDoc(doc(staffA, 'companies', 'company-a', 'applications', 'ok-1'), {
        companyId: 'company-a', applicantId: 'ok-1', firstName: 'Ok', status: 'New Lead',
      }),
    );
  });

  it('APP-COMPANYID: driver deterministic-id create still binds companyId to the path', async () => {
    const driverDb = testEnv
      .authenticatedContext('driver-7', { email: 'd7@x.com', email_verified: true })
      .firestore();

    // Mismatched companyId on the deterministic-id path -> DENIED.
    await assertFails(
      setDoc(doc(driverDb, 'companies', 'company-a', 'applications', 'driver-7'), {
        companyId: 'company-b', applicantId: 'driver-7', driverId: 'driver-7', status: 'New Application',
      }),
    );
    // Matching companyId -> ALLOWED (unchanged legitimate self-submission).
    await assertSucceeds(
      setDoc(doc(driverDb, 'companies', 'company-a', 'applications', 'driver-7'), {
        companyId: 'company-a', applicantId: 'driver-7', driverId: 'driver-7', status: 'New Application',
      }),
    );
  });

  // ===================================================================
  // REMOVED-FEATURES: obsolete rules deleted -> Firestore default-deny applies
  // (public Job Board + driver Saved Jobs were removed in commit 5a4c8dd)
  // ===================================================================

  it('REMOVED: job_posts collection is fully default-denied (former public read is gone)', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'job_posts', 'post1'), {
        companyId: 'company-a', title: 'Legacy Job',
      });
    });

    const guestDb = testEnv.unauthenticatedContext().firestore();
    const staffA = testEnv.authenticatedContext('rec-a', { roles: { 'company-a': 'recruiter' } }).firestore();
    const superDb = testEnv.authenticatedContext('super-1', { globalRole: 'super_admin' }).firestore();

    // Previously `allow read: if true` — now denied for guest, staff, and super admin.
    await assertFails(getDoc(doc(guestDb, 'job_posts', 'post1')));
    await assertFails(getDoc(doc(staffA, 'job_posts', 'post1')));
    await assertFails(getDoc(doc(superDb, 'job_posts', 'post1')));
    // Previously company-team writable — now denied.
    await assertFails(setDoc(doc(staffA, 'job_posts', 'post2'), { companyId: 'company-a', title: 'New' }));
  });

  it('REMOVED: drivers/{id}/saved_jobs is default-denied even for the owner (drafts still work)', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'drivers', 'driver-1', 'saved_jobs', 'job1'), { title: 'Saved' });
    });

    const ownerDb = testEnv.authenticatedContext('driver-1').firestore();

    // Previously owner read/write — now denied (feature removed).
    await assertFails(getDoc(doc(ownerDb, 'drivers', 'driver-1', 'saved_jobs', 'job1')));
    await assertFails(setDoc(doc(ownerDb, 'drivers', 'driver-1', 'saved_jobs', 'job2'), { title: 'x' }));
    // Control: the still-active drafts subcollection remains owner-accessible.
    await assertSucceeds(setDoc(doc(ownerDb, 'drivers', 'driver-1', 'drafts', 'draft1'), { data: 1 }));
  });
});
