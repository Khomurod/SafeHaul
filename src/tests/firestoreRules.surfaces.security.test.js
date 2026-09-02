// firestore.rules security, strengthening pass (RU-1): negative and positive
// coverage for client-reachable surfaces the original 1106-line suite never
// touched — token-gated documents, the company messaging/campaign
// subcollections, notifications' split write rules, the email config, the
// team roster and the encrypted integrations. Every assertion pins the rules
// AS THEY ARE TODAY; this suite is the owner-required safety net for RU-2.
// The shared harness lives in `firestoreRules.support.js`; the describe name
// matches the sibling suites deliberately.
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
    testEnv = await createRulesTestEnv('surfaces');
  });

  afterAll(async () => {
    if (testEnv) {
      await testEnv.cleanup();
    }
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
  });

  const superCtx = () => testEnv.authenticatedContext('super-1', { globalRole: 'super_admin' }).firestore();
  const teamOf = (companyId, role = 'recruiter') => testEnv.authenticatedContext(`staff-${companyId}-${role}`, {
    roles: { [companyId]: role },
    companyTeamIds: [companyId],
  }).firestore();
  const guestCtx = () => testEnv.unauthenticatedContext().firestore();

  async function seed(path, data = { seeded: true }) {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), ...path), data);
    });
  }

  it('SURFACE: verification_requests are super-admin read-only, never client-writable', async () => {
    await seed(['verification_requests', 'tok-1'], { employerIndex: 0 });
    await seed(['verification_requests', 'tok-1', 'responses', 'r1'], { answer: 'yes' });

    await assertSucceeds(getDoc(doc(superCtx(), 'verification_requests', 'tok-1')));
    await assertSucceeds(getDoc(doc(superCtx(), 'verification_requests', 'tok-1', 'responses', 'r1')));
    await assertFails(getDoc(doc(teamOf('company-a'), 'verification_requests', 'tok-1')));
    await assertFails(getDoc(doc(guestCtx(), 'verification_requests', 'tok-1')));
    await assertFails(setDoc(doc(superCtx(), 'verification_requests', 'tok-2'), { forged: true }));
    await assertFails(setDoc(doc(superCtx(), 'verification_requests', 'tok-1', 'responses', 'r2'), { forged: true }));
  });

  it('SURFACE: change_reviews are super-admin read-only, never client-writable', async () => {
    await seed(['change_reviews', 'tok-9'], { applicationId: 'app-1' });

    await assertSucceeds(getDoc(doc(superCtx(), 'change_reviews', 'tok-9')));
    await assertFails(getDoc(doc(teamOf('company-a'), 'change_reviews', 'tok-9')));
    await assertFails(setDoc(doc(superCtx(), 'change_reviews', 'tok-9'), { resolved: true }));
  });

  it('SURFACE: public_profiles read publicly but writable by nobody, super admin included', async () => {
    await seed(['public_profiles', 'company-a'], { name: 'Sanitized Co' });

    await assertSucceeds(getDoc(doc(guestCtx(), 'public_profiles', 'company-a')));
    await assertFails(setDoc(doc(superCtx(), 'public_profiles', 'company-a'), { name: 'Edited' }));
  });

  it('SURFACE: message_templates read by team, written only by the company admin', async () => {
    await seed(['companies', 'company-a', 'message_templates', 't1'], { body: 'hello' });

    await assertSucceeds(getDoc(doc(teamOf('company-a'), 'companies', 'company-a', 'message_templates', 't1')));
    await assertFails(getDoc(doc(teamOf('company-b'), 'companies', 'company-a', 'message_templates', 't1')));
    await assertFails(setDoc(doc(teamOf('company-a'), 'companies', 'company-a', 'message_templates', 't2'), { body: 'x' }));
    await assertSucceeds(setDoc(doc(teamOf('company-a', 'company_admin'), 'companies', 'company-a', 'message_templates', 't2'), { body: 'x' }));
  });

  it('SURFACE: bulk_sessions are tenant-bound and their logs are client read-only', async () => {
    await seed(['companies', 'company-a', 'bulk_sessions', 's1'], { status: 'running' });
    await seed(['companies', 'company-a', 'bulk_sessions', 's1', 'logs', 'l1'], { sent: 1 });

    const team = teamOf('company-a');
    await assertSucceeds(getDoc(doc(team, 'companies', 'company-a', 'bulk_sessions', 's1')));
    await assertSucceeds(updateDoc(doc(team, 'companies', 'company-a', 'bulk_sessions', 's1'), { status: 'done' }));
    await assertFails(getDoc(doc(teamOf('company-b'), 'companies', 'company-a', 'bulk_sessions', 's1')));
    await assertSucceeds(getDoc(doc(team, 'companies', 'company-a', 'bulk_sessions', 's1', 'logs', 'l1')));
    await assertFails(setDoc(doc(team, 'companies', 'company-a', 'bulk_sessions', 's1', 'logs', 'l2'), { sent: 2 }));
  });

  it('SURFACE: campaign_drafts are tenant-bound', async () => {
    await seed(['companies', 'company-a', 'campaign_drafts', 'd1'], { step: 2 });

    await assertSucceeds(updateDoc(doc(teamOf('company-a'), 'companies', 'company-a', 'campaign_drafts', 'd1'), { step: 3 }));
    await assertFails(getDoc(doc(teamOf('company-b'), 'companies', 'company-a', 'campaign_drafts', 'd1')));
  });

  it('SURFACE: stats_daily and internal_stats are client read-only, super admin included', async () => {
    await seed(['companies', 'company-a', 'stats_daily', '2026-09-01'], { hires: 2 });
    await seed(['companies', 'company-a', 'internal_stats', 'kpis'], { open: 4 });

    const team = teamOf('company-a');
    await assertSucceeds(getDoc(doc(team, 'companies', 'company-a', 'stats_daily', '2026-09-01')));
    await assertSucceeds(getDoc(doc(team, 'companies', 'company-a', 'internal_stats', 'kpis')));
    await assertFails(setDoc(doc(team, 'companies', 'company-a', 'stats_daily', '2026-09-02'), { hires: 9 }));
    await assertFails(setDoc(doc(superCtx(), 'companies', 'company-a', 'internal_stats', 'kpis'), { open: 0 }));
  });

  it('SURFACE: notifications split by verb — team reads/updates, only admins create/delete', async () => {
    await seed(['companies', 'company-a', 'notifications', 'n1'], { read: false });

    const recruiter = teamOf('company-a');
    const admin = teamOf('company-a', 'company_admin');
    await assertSucceeds(getDoc(doc(recruiter, 'companies', 'company-a', 'notifications', 'n1')));
    await assertSucceeds(updateDoc(doc(recruiter, 'companies', 'company-a', 'notifications', 'n1'), { read: true }));
    await assertFails(setDoc(doc(recruiter, 'companies', 'company-a', 'notifications', 'n2'), { read: false }));
    await assertFails(deleteDoc(doc(recruiter, 'companies', 'company-a', 'notifications', 'n1')));
    await assertSucceeds(setDoc(doc(admin, 'companies', 'company-a', 'notifications', 'n2'), { read: false }));
    await assertSucceeds(deleteDoc(doc(admin, 'companies', 'company-a', 'notifications', 'n1')));
    await assertFails(getDoc(doc(teamOf('company-b'), 'companies', 'company-a', 'notifications', 'n2')));
  });

  it('SURFACE: the email config is admin-only — a recruiter of the SAME company cannot read it', async () => {
    await seed(['companies', 'company-a', 'system_settings', 'email_config'], { host: 'smtp.example.test' });

    await assertSucceeds(getDoc(doc(teamOf('company-a', 'company_admin'), 'companies', 'company-a', 'system_settings', 'email_config')));
    await assertFails(getDoc(doc(teamOf('company-a'), 'companies', 'company-a', 'system_settings', 'email_config')));
    await assertFails(getDoc(doc(teamOf('company-b', 'company_admin'), 'companies', 'company-a', 'system_settings', 'email_config')));
    await assertFails(getDoc(doc(guestCtx(), 'companies', 'company-a', 'system_settings', 'email_config')));
  });

  it('SURFACE: the team roster reads for the team, writes only for admins', async () => {
    await seed(['companies', 'company-a', 'team', 'user-1'], { role: 'recruiter' });

    await assertSucceeds(getDoc(doc(teamOf('company-a'), 'companies', 'company-a', 'team', 'user-1')));
    await assertFails(setDoc(doc(teamOf('company-a'), 'companies', 'company-a', 'team', 'user-1'), { role: 'company_admin' }));
    await assertSucceeds(setDoc(doc(teamOf('company-a', 'company_admin'), 'companies', 'company-a', 'team', 'user-1'), { role: 'recruiter' }));
    await assertFails(getDoc(doc(teamOf('company-b'), 'companies', 'company-a', 'team', 'user-1')));
  });

  it('SURFACE: integrations are admin read/update, but create and delete stay super-admin-only', async () => {
    await seed(['companies', 'company-a', 'integrations', 'sms_provider'], { defaultNumber: '+15550100' });

    const admin = teamOf('company-a', 'company_admin');
    await assertSucceeds(getDoc(doc(admin, 'companies', 'company-a', 'integrations', 'sms_provider')));
    await assertSucceeds(updateDoc(doc(admin, 'companies', 'company-a', 'integrations', 'sms_provider'), { defaultNumber: '+15550101' }));
    await assertFails(getDoc(doc(teamOf('company-a'), 'companies', 'company-a', 'integrations', 'sms_provider')));
    await assertFails(setDoc(doc(admin, 'companies', 'company-a', 'integrations', 'email_provider'), { host: 'x' }));
    await assertFails(deleteDoc(doc(admin, 'companies', 'company-a', 'integrations', 'sms_provider')));
    await assertSucceeds(setDoc(doc(superCtx(), 'companies', 'company-a', 'integrations', 'email_provider'), { host: 'x' }));
  });

  // Company-specific legal wording is versioned by content hash, and the
  // guarantee that "publishing only ever adds a version" holds only if no
  // client can touch the documents at all. There is deliberately no rule for
  // this subcollection: default deny, for every role, both directions. Reads
  // and writes go through `listCompanyAgreementWording` and the super-admin
  // publish/revert callables.
  it('SURFACE: company legal wording is unreachable from every client — read and write, super admin included', async () => {
    await seed(['companies', 'company-a', 'legal_agreements', 'fcraDisclosure'], { currentVersion: 'c-1', versions: {} });

    for (const ctx of [guestCtx(), teamOf('company-a'), teamOf('company-a', 'company_admin'), superCtx()]) {
      await assertFails(getDoc(doc(ctx, 'companies', 'company-a', 'legal_agreements', 'fcraDisclosure')));
      await assertFails(setDoc(doc(ctx, 'companies', 'company-a', 'legal_agreements', 'mvrAuthorization'), { currentVersion: 'c-2', versions: {} }));
      await assertFails(updateDoc(doc(ctx, 'companies', 'company-a', 'legal_agreements', 'fcraDisclosure'), { currentVersion: 'c-9' }));
      await assertFails(deleteDoc(doc(ctx, 'companies', 'company-a', 'legal_agreements', 'fcraDisclosure')));
    }
  });
});
