// firestore.rules security, part 2 of 4: the default-denied server-only
// collections — ledgers, the AI platform, unfinished applications, blog,
// landing settings, captured leads — and lead companyId immutability.
// Split from the original single-file `firestore.rules.security.test.js`;
// every test body is verbatim, and the shared harness (rules text, emulator
// gate, environment boot) lives in `firestoreRules.support.js`. The describe
// name is unchanged so every test's full name is identical to the original's.
import { afterAll, beforeAll, beforeEach, it } from 'vitest';
import { assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { describeFirestore, createRulesTestEnv } from './firestoreRules.support.js';

let testEnv;

describeFirestore('firestore.rules security regressions', () => {
  beforeAll(async () => {
    testEnv = await createRulesTestEnv('lockdown');
  });

  afterAll(async () => {
    if (testEnv) {
      await testEnv.cleanup();
    }
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
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
      await setDoc(doc(adminDb, 'ai_routing_config', 'order'), { providerIds: ['gemini', 'groq'] });
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
      await assertFails(getDoc(doc(db, 'ai_routing_config', 'order')));
    }

    await assertFails(setDoc(doc(superDb, 'ai_provider_config', 'groq'), { enabled: false }));
    await assertFails(setDoc(doc(adminDb, 'ai_telemetry', 'forged'), { providerId: 'groq' }));

    // The routing order decides which vendor every AI request in the platform
    // reaches first. A client that could write it would control that directly,
    // bypassing `setAiProviderPriority` and its super-admin, recent-auth and
    // rate-limit guards — so this is closed to Super Admins in the browser too.
    await assertFails(setDoc(doc(superDb, 'ai_routing_config', 'order'), { providerIds: ['groq'] }));
    await assertFails(setDoc(doc(anonDb, 'ai_routing_config', 'order'), { providerIds: ['groq'] }));
  });

  it('blocks all client access to unfinished applications and their audit trail', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const adminDb = context.firestore();
      await setDoc(doc(adminDb, 'companies/co1/application_drafts/abc123'), {
        companyId: 'co1',
        contactEmail: 'dana@example.test',
        identityKey: 'f'.repeat(64),
        formData: { firstName: 'Dana', dob: '1988-03-11' },
        lastStep: 3,
      });
      await setDoc(doc(adminDb, 'companies/co1/application_draft_audit/a1'), {
        action: 'resume_match_attempted',
        outcome: 'matched',
      });
    });

    const superDb = testEnv.authenticatedContext('super-1', { globalRole: 'super_admin' }).firestore();
    const teamDb = testEnv.authenticatedContext('admin-1', { roles: { co1: 'company_admin' } }).firestore();
    const anonDb = testEnv.unauthenticatedContext().firestore();

    for (const db of [superDb, teamDb, anonDb]) {
      // Closed to company staff too, not only to guests. A draft holds a real
      // person's name, date of birth, address and licence details before they
      // have signed anything, and the resume flow is a deliberate,
      // rate-limited, audited path rather than a query anyone can run.
      await assertFails(getDoc(doc(db, 'companies/co1/application_drafts/abc123')));
      await assertFails(getDoc(doc(db, 'companies/co1/application_draft_audit/a1')));
    }

    // And no client may write one either: a forged draft is a way to plant data
    // that a returning applicant would then be shown as their own.
    await assertFails(setDoc(doc(anonDb, 'companies/co1/application_drafts/forged'), {
      companyId: 'co1', formData: { firstName: 'Attacker' },
    }));
    await assertFails(setDoc(doc(teamDb, 'companies/co1/application_drafts/abc123'), { lastStep: 9 }));
    await assertFails(setDoc(doc(superDb, 'companies/co1/application_draft_audit/forged'), {
      action: 'resume_match_attempted',
    }));
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

  it('blocks all client access to the landing-page settings, including Super Admins', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const adminDb = context.firestore();
      await setDoc(doc(adminDb, 'platform_settings', 'landing_page'), {
        telegram: {
          enabled: true,
          // Ciphertext, but the point stands: a credential a browser can fetch
          // is a credential that can leave the browser.
          botTokenCipher: 'aabbcc:ddeeff',
          chatIdCipher: '112233:445566',
          // Deliberately zero-entropy. It still matches the /^[a-f0-9]{12}$/
          // shape a real fingerprint has, but a fixture with real-looking
          // entropy next to a `botToken…` key is what the secret scanner is
          // built to flag — and it is right to, so the fixture gives it
          // nothing to find.
          botTokenFingerprint: 'ffffffffffff',
        },
      });
    });

    const superDb = testEnv.authenticatedContext('super-1', { globalRole: 'super_admin' }).firestore();
    const anonDb = testEnv.unauthenticatedContext().firestore();

    for (const db of [superDb, anonDb]) {
      // Super Admin is deliberately included. Nothing reads this collection now —
      // its screen retired with the marketing site — but the documents still hold
      // encrypted Telegram credentials, so a direct read hands over the ciphertext.
      await assertFails(getDoc(doc(db, 'platform_settings', 'landing_page')));
      await assertFails(setDoc(doc(db, 'platform_settings', 'landing_page'), { telegram: { enabled: false } }));
    }
  });

  it('blocks all client access to captured landing leads', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const adminDb = context.firestore();
      await setDoc(doc(adminDb, 'landing_leads', 'lead-a'), {
        fullName: 'Dana Whitfield',
        workEmail: 'dana@example.test',
        stage: 'contact',
        // The completion secret is stored as a digest; a client that could read
        // this document could replay it against the public endpoint.
        completionTokenHash: 'f'.repeat(64),
        delivery: { status: 'pending', attempts: 0 },
      });
    });

    const superDb = testEnv.authenticatedContext('super-1', { globalRole: 'super_admin' }).firestore();
    const companyDb = testEnv.authenticatedContext('user-1', { roles: { 'company-a': 'company_admin' } }).firestore();
    const anonDb = testEnv.unauthenticatedContext().firestore();

    for (const db of [superDb, companyDb, anonDb]) {
      await assertFails(getDoc(doc(db, 'landing_leads', 'lead-a')));
      // A forged lead would put an arbitrary message in front of the sales team.
      await assertFails(setDoc(doc(db, 'landing_leads', 'forged'), { fullName: 'Forged' }));
    }
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

});
