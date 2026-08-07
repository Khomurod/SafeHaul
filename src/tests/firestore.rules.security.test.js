import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, documentId, getDoc, getDocs, query, setDoc, updateDoc, where } from 'firebase/firestore';

let testEnv;

const projectId = 'safehaul-rules-test';
const rules = readFileSync(resolve(process.cwd(), 'src/firestore.rules'), 'utf8');
const firestoreEmulatorHost = process.env.FIRESTORE_EMULATOR_HOST || '';
const hasFirestoreEmulator = firestoreEmulatorHost.includes(':');
const describeFirestore = hasFirestoreEmulator ? describe : describe.skip;

async function clearFirestore() {
  await testEnv.clearFirestore();
}

describeFirestore('firestore.rules security regressions', () => {
  beforeAll(async () => {
    const [host, portStr] = firestoreEmulatorHost.split(':');
    testEnv = await initializeTestEnvironment({
      projectId,
      firestore: { rules, host, port: Number(portStr) },
    });
  });

  afterAll(async () => {
    if (testEnv) {
      await testEnv.cleanup();
    }
  });

  beforeEach(async () => {
    await clearFirestore();
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

  it('blocks all client access to server-only ledgers (A6)', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const adminDb = context.firestore();
      await setDoc(doc(adminDb, 'rate_limits', 'k1'), { count: 1 });
      await setDoc(doc(adminDb, 'processing_status', 'app_co1_app1'), { processedAt: 1 });
      await setDoc(doc(adminDb, 'integrations_index', 'idx1'), { companyId: 'co1' });
      await setDoc(doc(adminDb, 'environment_audit_log', 'audit1'), { action: 'reveal', actorUid: 'super-1' });
    });

    const superDb = testEnv.authenticatedContext('super-1', {
      globalRole: 'super_admin',
    }).firestore();
    const adminDb = testEnv.authenticatedContext('admin-1', {
      roles: { co1: 'company_admin' },
    }).firestore();

    for (const db of [superDb, adminDb]) {
      await assertFails(getDoc(doc(db, 'rate_limits', 'k1')));
      await assertFails(getDoc(doc(db, 'processing_status', 'app_co1_app1')));
      await assertFails(getDoc(doc(db, 'integrations_index', 'idx1')));
      // The environment vault's audit trail is closed to Super Admins too: the
      // page reads it through a callable, so no client needs a direct read, and
      // no client can forge an entry.
      await assertFails(getDoc(doc(db, 'environment_audit_log', 'audit1')));
    }

    await assertFails(setDoc(doc(adminDb, 'rate_limits', 'k2'), { count: 9 }));
    await assertFails(setDoc(doc(adminDb, 'processing_status', 'x'), { processedAt: 2 }));
    await assertFails(setDoc(doc(adminDb, 'integrations_index', 'y'), { companyId: 'co1' }));
    await assertFails(setDoc(doc(superDb, 'environment_audit_log', 'forged'), { action: 'reveal' }));
  });

  it('blocks all client access to the shared AI platform collections', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const adminDb = context.firestore();
      await setDoc(doc(adminDb, 'ai_provider_config', 'groq'), { enabled: true, health: 'healthy' });
      await setDoc(doc(adminDb, 'ai_telemetry', 't1'), { providerId: 'groq', outcome: 'success' });
    });

    const superDb = testEnv.authenticatedContext('super-1', { globalRole: 'super_admin' }).firestore();
    const adminDb = testEnv.authenticatedContext('admin-1', { roles: { co1: 'company_admin' } }).firestore();
    const anonDb = testEnv.unauthenticatedContext().firestore();

    for (const db of [superDb, adminDb, anonDb]) {
      // Closed to Super Admins too: AI Integrations reads through a callable, so
      // no browser needs a direct read of which providers a deployment uses or
      // which of them are currently failing.
      await assertFails(getDoc(doc(db, 'ai_provider_config', 'groq')));
      await assertFails(getDoc(doc(db, 'ai_telemetry', 't1')));
    }

    await assertFails(setDoc(doc(superDb, 'ai_provider_config', 'groq'), { enabled: false }));
    await assertFails(setDoc(doc(adminDb, 'ai_telemetry', 'forged'), { providerId: 'groq' }));
  });

  it('blocks all client access to blog posts, including published ones', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const adminDb = context.firestore();
      await setDoc(doc(adminDb, 'blog_posts', '2026-08-02_industry-news'), {
        title: 'A published article',
        slug: 'a-published-article',
        status: 'published',
        publicationDate: '2026-08-02',
        generation: { providerId: 'groq', model: 'llama-3.3-70b-versatile' },
      });
      await setDoc(doc(adminDb, 'blog_posts', '2026-08-01_recruitment'), {
        title: 'A removed article',
        slug: 'a-removed-article',
        status: 'deleted',
        publicationDate: '2026-08-01',
      });
    });

    const superDb = testEnv.authenticatedContext('super-1', { globalRole: 'super_admin' }).firestore();
    const anonDb = testEnv.unauthenticatedContext().firestore();

    for (const db of [superDb, anonDb]) {
      // The article content is public, but the *document* is not: it carries
      // tombstones, source fingerprints and provider/model records. The public
      // surface is the server-rendered /news routes, which filter and strip.
      await assertFails(getDoc(doc(db, 'blog_posts', '2026-08-02_industry-news')));
      await assertFails(getDoc(doc(db, 'blog_posts', '2026-08-01_recruitment')));
    }

    // Publishing and deletion are server-side only.
    await assertFails(setDoc(doc(superDb, 'blog_posts', '2026-08-03_industry-news'), { title: 'Forged' }));
    await assertFails(setDoc(doc(anonDb, 'blog_posts', '2026-08-04_industry-news'), { title: 'Forged' }));
  });

  it('blocks lead update that changes companyId', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const adminDb = context.firestore();
      await setDoc(doc(adminDb, 'companies', 'company-a', 'leads', 'lead1'), {
        companyId: 'company-a',
        firstName: 'Alice',
        status: 'New Lead',
      });
    });

    const adminDb = testEnv.authenticatedContext('admin-a', {
      roles: { 'company-a': 'company_admin' },
    }).firestore();

    await assertFails(
      updateDoc(doc(adminDb, 'companies', 'company-a', 'leads', 'lead1'), {
        companyId: 'company-b',
      }),
    );
  });

  // ===================================================================
  // SEC-002: cross-company driver / staff profile reads
  // ===================================================================

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
