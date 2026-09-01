// firestore.rules security, part 1 of 4: driver privilege escalation,
// cross-tenant membership and lead binding, ATS assignment fields, and the
// signing-request/template contracts.
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
    testEnv = await createRulesTestEnv('tenancy');
  });

  afterAll(async () => {
    if (testEnv) {
      await testEnv.cleanup();
    }
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
  });

  it('blocks driver privilege escalation fields but allows safe profile fields', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const adminDb = context.firestore();
      await setDoc(doc(adminDb, 'companies', 'co1', 'applications', 'app1'), {
        companyId: 'co1',
        applicantId: 'driver-1',
        driverId: 'driver-1',
        status: 'New Application',
        phone: '1111111111',
        firstName: 'Alice',
      });
    });

    const driverDb = testEnv.authenticatedContext('driver-1', {
      email: 'driver@example.com',
      email_verified: true,
    }).firestore();

    await assertSucceeds(updateDoc(doc(driverDb, 'companies', 'co1', 'applications', 'app1'), {
      phone: '2222222222',
      signatureType: 'drawn',
    }));

    await assertFails(updateDoc(doc(driverDb, 'companies', 'co1', 'applications', 'app1'), {
      status: 'Hired',
      backgroundCheckPassed: true,
    }));
  });

  it('prevents cross-tenant membership hijacking on update', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const adminDb = context.firestore();
      await setDoc(doc(adminDb, 'memberships', 'mem1'), {
        userId: 'target-user',
        companyId: 'company-b',
        role: 'recruiter',
      });
    });

    const rogueAdminDb = testEnv.authenticatedContext('admin-a', {
      roles: { 'company-a': 'company_admin' },
    }).firestore();

    await assertFails(updateDoc(doc(rogueAdminDb, 'memberships', 'mem1'), {
      companyId: 'company-a',
      role: 'company_admin',
    }));
  });

  it('reads dq_files only via in-document owner markers', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const adminDb = context.firestore();
      await setDoc(doc(adminDb, 'companies', 'co1', 'applications', 'app1', 'dq_files', 'f1'), {
        fileName: 'med-card.pdf',
        ownerUserIds: ['driver-1'],
      });
      await setDoc(doc(adminDb, 'companies', 'co1', 'applications', 'app2', 'dq_files', 'f2'), {
        fileName: 'cdl.pdf',
        ownerUserIds: ['driver-2'],
      });
    });

    const ownerDb = testEnv.authenticatedContext('driver-1').firestore();
    const otherDb = testEnv.authenticatedContext('driver-3').firestore();

    await assertSucceeds(getDoc(doc(ownerDb, 'companies', 'co1', 'applications', 'app1', 'dq_files', 'f1')));
    await assertFails(getDoc(doc(otherDb, 'companies', 'co1', 'applications', 'app2', 'dq_files', 'f2')));
  });

  it('allows company admin ATS status + assignee writes on applications', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const adminDb = context.firestore();
      await setDoc(doc(adminDb, 'companies', 'co1', 'applications', 'app1'), {
        companyId: 'co1',
        applicantId: 'driver-1',
        driverId: 'driver-1',
        status: 'New Application',
        phone: '1111111111',
        firstName: 'Alice',
      });
    });

    const companyAdminDb = testEnv.authenticatedContext('admin-1', {
      roles: { co1: 'company_admin' },
    }).firestore();

    await assertSucceeds(
      updateDoc(doc(companyAdminDb, 'companies', 'co1', 'applications', 'app1'), {
        status: 'Contact Attempt 1',
        assignedTo: 'admin-1',
        assignedToName: 'Admin One',
      }),
    );

    await assertFails(
      updateDoc(doc(companyAdminDb, 'companies', 'co1', 'applications', 'app1'), {
        status: 'Invalid Fake Status',
      }),
    );
  });

  it('blocks drivers from manipulating ATS assignment fields', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const adminDb = context.firestore();
      await setDoc(doc(adminDb, 'companies', 'co1', 'applications', 'app1'), {
        companyId: 'co1',
        applicantId: 'driver-1',
        driverId: 'driver-1',
        status: 'New Application',
        phone: '1111111111',
      });
    });

    const driverDb = testEnv.authenticatedContext('driver-1', {
      email: 'driver@example.com',
      email_verified: true,
    }).firestore();

    await assertFails(
      updateDoc(doc(driverDb, 'companies', 'co1', 'applications', 'app1'), {
        assignedTo: 'admin-1',
        assignedToName: 'Admin',
      }),
    );

    await assertFails(
      updateDoc(doc(driverDb, 'companies', 'co1', 'applications', 'app1'), {
        status: 'Hired',
      }),
    );
  });

  it('blocks lead create with mismatched companyId in document body', async () => {
    const adminDb = testEnv.authenticatedContext('admin-a', {
      roles: { 'company-a': 'company_admin' },
    }).firestore();

    await assertFails(
      setDoc(doc(adminDb, 'companies', 'company-a', 'leads', 'lead1'), {
        companyId: 'company-b',
        firstName: 'Cross',
        lastName: 'Tenant',
        status: 'New Lead',
      }),
    );
  });

  it('allows company team to create signing_requests and secrets token', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const adminDb = context.firestore();
      await setDoc(doc(adminDb, 'companies', 'company-a'), { companyName: 'Co A' });
    });

    const adminDb = testEnv.authenticatedContext('admin-a', {
      roles: { 'company-a': 'company_admin' },
    }).firestore();

    await assertSucceeds(
      setDoc(doc(adminDb, 'companies', 'company-a', 'signing_requests', 'req1'), {
        companyId: 'company-a',
        status: 'sent',
        recipientName: 'Signer',
        title: 'Test Doc',
      }),
    );

    await assertSucceeds(
      setDoc(doc(adminDb, 'companies', 'company-a', 'signing_requests', 'req1', 'secrets', 'token'), {
        accessToken: 'secret-token-value',
      }),
    );
  });

  it('blocks client read of signing request secrets token', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const adminDb = context.firestore();
      await setDoc(doc(adminDb, 'companies', 'company-a', 'signing_requests', 'req1', 'secrets', 'token'), {
        accessToken: 'secret-token-value',
      });
    });

    const adminDb = testEnv.authenticatedContext('admin-a', {
      roles: { 'company-a': 'company_admin' },
    }).firestore();

    await assertFails(
      getDoc(doc(adminDb, 'companies', 'company-a', 'signing_requests', 'req1', 'secrets', 'token')),
    );
  });

  it('lets any company team member save/edit E-Docs templates, but only admins delete', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const adminDb = context.firestore();
      await setDoc(doc(adminDb, 'companies', 'company-a'), { companyName: 'Co A' });
      // Seed a template to exercise update + delete paths.
      await setDoc(doc(adminDb, 'companies', 'company-a', 'templates', 'tmpl-seed'), {
        companyId: 'company-a', title: 'Seed', fields: [],
      });
    });

    const hrDb = testEnv.authenticatedContext('hr-a', {
      roles: { 'company-a': 'hr_user' },
    }).firestore();
    const recruiterDb = testEnv.authenticatedContext('rec-a', {
      roles: { 'company-a': 'recruiter' },
    }).firestore();
    const adminDb = testEnv.authenticatedContext('admin-a', {
      roles: { 'company-a': 'company_admin' },
    }).firestore();
    const crossTenantDb = testEnv.authenticatedContext('admin-b', {
      roles: { 'company-b': 'company_admin' },
    }).firestore();

    // hr_user can CREATE (this is the E-Docs "Save Template" regression).
    await assertSucceeds(
      setDoc(doc(hrDb, 'companies', 'company-a', 'templates', 'tmpl-hr'), {
        companyId: 'company-a', title: 'Offer Letter', fields: [],
      }),
    );
    // recruiter can UPDATE.
    await assertSucceeds(
      updateDoc(doc(recruiterDb, 'companies', 'company-a', 'templates', 'tmpl-seed'), {
        title: 'Seed (edited)',
      }),
    );
    // hr_user / recruiter CANNOT delete (admin-only, mirrors signing_requests).
    await assertFails(
      deleteDoc(doc(hrDb, 'companies', 'company-a', 'templates', 'tmpl-seed')),
    );
    // company_admin CAN delete.
    await assertSucceeds(
      deleteDoc(doc(adminDb, 'companies', 'company-a', 'templates', 'tmpl-hr')),
    );
    // Cross-tenant write is still blocked.
    await assertFails(
      setDoc(doc(crossTenantDb, 'companies', 'company-a', 'templates', 'tmpl-evil'), {
        companyId: 'company-a', title: 'Evil', fields: [],
      }),
    );
  });

  it('blocks driver from updating another users signing request', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const adminDb = context.firestore();
      await setDoc(doc(adminDb, 'companies', 'company-a', 'signing_requests', 'req1'), {
        companyId: 'company-a',
        status: 'sent',
        recipientId: 'driver-b',
        recipientName: 'Driver B',
      });
    });

    const driverADb = testEnv.authenticatedContext('driver-a', { roles: {} }).firestore();

    await assertFails(
      updateDoc(doc(driverADb, 'companies', 'company-a', 'signing_requests', 'req1'), {
        status: 'signed',
        signatureData: { signed: true },
      }),
    );
  });

});
