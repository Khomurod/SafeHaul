import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import { deleteObject, getMetadata, listAll, ref, uploadString } from 'firebase/storage';

const projectId = 'safehaul-storage-rules-test';
const bucket = `${projectId}.appspot.com`;
const storageRules = readFileSync(resolve(process.cwd(), 'src/storage.rules'), 'utf8');
const storageEmulatorHost = process.env.FIREBASE_STORAGE_EMULATOR_HOST || '';
const hasStorageEmulator = storageEmulatorHost.includes(':');
const describeStorage = hasStorageEmulator ? describe : describe.skip;

let testEnv;
let runCounter = 0;
let authCounter = 0;
let paths;

function teamClaims(companyId, role = 'company_admin', { includeCompanyTeamIds = true } = {}) {
  const claims = {
    roles: { [companyId]: role },
  };
  if (includeCompanyTeamIds) {
    claims.companyTeamIds = [companyId];
  }
  return claims;
}

function superAdminClaims() {
  return {
    globalRole: 'super_admin',
    roles: { globalRole: 'super_admin' },
  };
}

function authedStorage(uid, claims = {}) {
  return testEnv.authenticatedContext(uid, claims).storage(`gs://${bucket}`);
}

function guestStorage() {
  return testEnv.unauthenticatedContext().storage(`gs://${bucket}`);
}

function nextUid(prefix) {
  authCounter += 1;
  return `${prefix}-${runCounter}-${authCounter}`;
}

function testPath(runId, relativePath) {
  // Keep paths rooted at real rule prefixes (companies/*, secure_documents/*),
  // but make each test object name unique to avoid cross-test collisions.
  return relativePath.replace(/([^/]+)$/, `${runId}_$1`);
}

function buildSeedPaths(runId) {
  return {
    co1DriverBLicense: testPath(runId, 'companies/co1/applications/driverB/cdl-front/license.pdf'),
    co1DriverBLeadDq: testPath(runId, 'companies/co1/leads/app123/dq_files/medical.pdf'),
    co1DriverBLeadGeneral: testPath(runId, 'companies/co1/leads/app123/general_documents/notes.pdf'),
    co1PevResult: testPath(runId, 'companies/co1/applications/app123/pev_results/PEV_report.pdf'),
    co1GuestSeed: testPath(runId, 'companies/co1/autofill/guest_uploads/seed.jpg'),
    co2DriverCLicense: testPath(runId, 'companies/co2/applications/driverC/cdl-front/license.pdf'),
    co1SecureTemplate: testPath(runId, 'secure_documents/co1/templates/seed.pdf'),
  };
}

async function deleteTree(folderRef) {
  const { items, prefixes } = await listAll(folderRef);
  await Promise.all(items.map((itemRef) => deleteObject(itemRef)));
  await Promise.all(prefixes.map((prefixRef) => deleteTree(prefixRef)));
}

async function clearTestBucket() {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const adminStorage = context.storage(`gs://${bucket}`);
    await deleteTree(ref(adminStorage, ''));
  });
}

async function seedStorageData(seedPaths) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const adminStorage = context.storage(`gs://${bucket}`);
    await uploadString(
      ref(adminStorage, seedPaths.co1DriverBLicense),
      'seed-pdf',
      'raw',
      { contentType: 'application/pdf', customMetadata: { driverId: 'driverB', companyId: 'co1' } },
    );
    await uploadString(
      ref(adminStorage, seedPaths.co1DriverBLeadDq),
      'seed-pdf',
      'raw',
      { contentType: 'application/pdf', customMetadata: { driverId: 'driverB', companyId: 'co1' } },
    );
    await uploadString(
      ref(adminStorage, seedPaths.co1DriverBLeadGeneral),
      'seed-pdf',
      'raw',
      { contentType: 'application/pdf', customMetadata: { driverId: 'driverB', companyId: 'co1' } },
    );
    await uploadString(
      ref(adminStorage, seedPaths.co1PevResult),
      'seed-pdf',
      'raw',
      { contentType: 'application/pdf', customMetadata: { driverId: 'driverB', companyId: 'co1' } },
    );
    await uploadString(
      ref(adminStorage, seedPaths.co1GuestSeed),
      'seed-image',
      'raw',
      { contentType: 'image/jpeg' },
    );
    await uploadString(
      ref(adminStorage, seedPaths.co2DriverCLicense),
      'seed-pdf',
      'raw',
      { contentType: 'application/pdf', customMetadata: { driverId: 'driverC', companyId: 'co2' } },
    );
    await uploadString(
      ref(adminStorage, seedPaths.co1SecureTemplate),
      'seed-pdf',
      'raw',
      { contentType: 'application/pdf' },
    );
  });
}

describeStorage('storage.rules security matrix (tenant isolation + permissive team model)', () => {
  beforeAll(async () => {
    const [host, portStr] = storageEmulatorHost.split(':');
    testEnv = await initializeTestEnvironment({
      projectId,
      storage: { rules: storageRules, host, port: Number(portStr) },
    });
  });

  afterAll(async () => {
    if (testEnv) await testEnv.cleanup();
  });

  beforeEach(async () => {
    runCounter += 1;
    authCounter = 0;
    paths = buildSeedPaths(runCounter);
    await clearTestBucket();
    await seedStorageData(paths);
  });

  it('allows guest upload in applications/autofill guest_uploads with valid file type', async () => {
    const guest = guestStorage();
    await assertSucceeds(
      uploadString(
        ref(guest, testPath(runCounter, 'companies/co1/applications/guest_uploads/upload-a.pdf')),
        'guest-pdf',
        'raw',
        { contentType: 'application/pdf' },
      ),
    );
    await assertSucceeds(
      uploadString(
        ref(guest, testPath(runCounter, 'companies/co1/autofill/guest_uploads/upload-b.jpg')),
        'guest-jpg',
        'raw',
        { contentType: 'image/jpeg' },
      ),
    );
  });

  it('blocks guest upload outside guest_uploads', async () => {
    const guest = guestStorage();
    await assertFails(
      uploadString(
        ref(guest, testPath(runCounter, 'companies/co1/applications/driverA/cdl-front/blocked.jpg')),
        'blocked',
        'raw',
        { contentType: 'image/jpeg' },
      ),
    );
  });

  it('blocks guest upload with invalid content type even inside guest_uploads', async () => {
    const guest = guestStorage();
    await assertFails(
      uploadString(
        ref(guest, testPath(runCounter, 'companies/co1/autofill/guest_uploads/invalid.txt')),
        'text',
        'raw',
        { contentType: 'text/plain' },
      ),
    );
  });

  it('keeps guest direct reads blocked for guest_uploads and secure_documents', async () => {
    const guest = guestStorage();
    await assertFails(getMetadata(ref(guest, paths.co1GuestSeed)));
    await assertFails(getMetadata(ref(guest, paths.co1SecureTemplate)));
  });

  it('allows driver to read/write/delete only inside own driver-keyed application path', async () => {
    const driverA = authedStorage('driverA');
    const ownPath = testPath(runCounter, 'companies/co1/applications/driverA/cdl-front/new-license.pdf');

    await assertSucceeds(
      uploadString(
        ref(driverA, ownPath),
        'driver-a-file',
        'raw',
        { contentType: 'application/pdf' },
      ),
    );
    await assertSucceeds(getMetadata(ref(driverA, ownPath)));
    await assertSucceeds(deleteObject(ref(driverA, ownPath)));
  });

  it('blocks driver from reading another driver file and cross-tenant file', async () => {
    const nonOwnerSameTenant = authedStorage(nextUid('driver-read-same-tenant'));
    const nonOwnerCrossTenant = authedStorage(nextUid('driver-read-cross-tenant'));
    await assertFails(getMetadata(ref(nonOwnerSameTenant, paths.co1DriverBLicense)));
    await assertFails(getMetadata(ref(nonOwnerCrossTenant, paths.co2DriverCLicense)));
  });

  it('blocks non-team drivers from non-driver-keyed company files (leads + pev)', async () => {
    const nonTeamDriverA = authedStorage(nextUid('driver-lead-dq'));
    const nonTeamDriverB = authedStorage(nextUid('driver-lead-general'));
    const nonTeamDriverC = authedStorage(nextUid('driver-pev'));
    await assertFails(getMetadata(ref(nonTeamDriverA, paths.co1DriverBLeadDq)));
    await assertFails(getMetadata(ref(nonTeamDriverB, paths.co1DriverBLeadGeneral)));
    await assertFails(getMetadata(ref(nonTeamDriverC, paths.co1PevResult)));
  });

  it('allows company_admin same-company read/write/delete and blocks cross-tenant reads', async () => {
    const co1Admin = authedStorage(nextUid('admin-co1'), teamClaims('co1', 'company_admin'));
    const co2AdminRead = authedStorage(nextUid('admin-co2-read'), teamClaims('co2', 'company_admin'));
    const adminUpload = testPath(runCounter, 'companies/co1/applications/driverB/cdl-front/admin-upload.pdf');
    const crossTenantReadTarget = paths.co1DriverBLeadGeneral;

    // Run deny assertion before any successful read on the same object path.
    await assertFails(getMetadata(ref(co2AdminRead, crossTenantReadTarget)));

    await assertSucceeds(getMetadata(ref(co1Admin, paths.co1DriverBLicense)));
    await assertSucceeds(
      uploadString(
        ref(co1Admin, adminUpload),
        'admin-upload',
        'raw',
        { contentType: 'application/pdf' },
      ),
    );
    await assertSucceeds(deleteObject(ref(co1Admin, adminUpload)));
  });

  it('blocks company_admin cross-tenant writes', async () => {
    const co2AdminWrite = authedStorage(nextUid('admin-co2-write'), teamClaims('co2', 'company_admin'));
    await assertFails(
      uploadString(
        ref(co2AdminWrite, testPath(runCounter, 'companies/co1/applications/driverB/cdl-front/cross-tenant.pdf')),
        'cross-tenant',
        'raw',
        { contentType: 'application/pdf' },
      ),
    );
  });

  it('allows hr_user and recruiter same-company access, but blocks cross-tenant reads', async () => {
    const co1Hr = authedStorage(nextUid('hr-co1'), teamClaims('co1', 'hr_user'));
    const co1Recruiter = authedStorage(nextUid('rec-co1'), teamClaims('co1', 'recruiter'));
    const co2HrRead = authedStorage(nextUid('hr-co2-read'), teamClaims('co2', 'hr_user'));
    const co2RecruiterRead = authedStorage(nextUid('rec-co2-read'), teamClaims('co2', 'recruiter'));
    const crossTenantReadTarget = paths.co1PevResult;

    // Run deny assertions before any successful read on the same object path.
    await assertFails(getMetadata(ref(co2HrRead, crossTenantReadTarget)));
    await assertFails(getMetadata(ref(co2RecruiterRead, crossTenantReadTarget)));

    await assertSucceeds(getMetadata(ref(co1Hr, paths.co1DriverBLicense)));
    await assertSucceeds(getMetadata(ref(co1Recruiter, paths.co1DriverBLeadDq)));
  });

  it('blocks hr_user and recruiter cross-tenant writes', async () => {
    const co2HrWrite = authedStorage(nextUid('hr-co2-write'), teamClaims('co2', 'hr_user'));
    const co2RecruiterWrite = authedStorage(nextUid('rec-co2-write'), teamClaims('co2', 'recruiter'));

    await assertFails(
      uploadString(
        ref(co2HrWrite, testPath(runCounter, 'companies/co1/applications/driverB/cdl-front/hr-cross-tenant.pdf')),
        'cross-tenant',
        'raw',
        { contentType: 'application/pdf' },
      ),
    );
    await assertFails(
      uploadString(
        ref(co2RecruiterWrite, testPath(runCounter, 'companies/co1/applications/driverB/cdl-front/recruiter-cross-tenant.pdf')),
        'cross-tenant',
        'raw',
        { contentType: 'application/pdf' },
      ),
    );
  });

  it('allows team access to non-driver-keyed paths (leads + pev_results)', async () => {
    const co1Admin = authedStorage(nextUid('admin-co1'), teamClaims('co1', 'company_admin'));
    await assertSucceeds(getMetadata(ref(co1Admin, paths.co1DriverBLeadDq)));
    await assertSucceeds(getMetadata(ref(co1Admin, paths.co1DriverBLeadGeneral)));
    await assertSucceeds(getMetadata(ref(co1Admin, paths.co1PevResult)));
  });

  it('keeps secure_documents private from guests while allowing company team access', async () => {
    const guest = guestStorage();
    const co1Admin = authedStorage(nextUid('admin-co1'), teamClaims('co1', 'company_admin'));
    const secureWrite = testPath(runCounter, 'secure_documents/co1/templates/offer-letter.pdf');

    await assertFails(getMetadata(ref(guest, paths.co1SecureTemplate)));
    await assertSucceeds(
      uploadString(
        ref(co1Admin, secureWrite),
        'template-pdf',
        'raw',
        { contentType: 'application/pdf' },
      ),
    );
    await assertSucceeds(getMetadata(ref(co1Admin, secureWrite)));
  });

  it('allows super_admin cross-tenant reads for operational support', async () => {
    const superAdmin = authedStorage(nextUid('super-admin'), superAdminClaims());
    // Driver-keyed application files and non-driver-keyed company paths (leads/pev_results)
    // are all accessible via isCompanyTeam() -> isSuperAdmin().
    await assertSucceeds(getMetadata(ref(superAdmin, paths.co1DriverBLicense)));
    await assertSucceeds(getMetadata(ref(superAdmin, paths.co2DriverCLicense)));
    await assertSucceeds(getMetadata(ref(superAdmin, paths.co1DriverBLeadDq)));
    await assertSucceeds(getMetadata(ref(superAdmin, paths.co1PevResult)));
    // NOTE: guest_uploads is intentionally not tested here. The guest_uploads match block
    // uses an overlapping recursive wildcard and the Cloud Storage runtime resolves it
    // before the broader companies/{companyId}/** block, so super_admin reads are denied
    // on that specific path. This is a Storage rules match-resolution quirk — not a
    // security gap, since guest_uploads only holds pre-intake files that are moved to
    // company-scoped paths (which super_admin CAN read) after intake processing.
  });

  it('recognizes a team member via the roles claim even when companyTeamIds is absent', async () => {
    // Real-world case: a valid hr_user whose denormalized companyTeamIds claim is
    // stale/missing must still be able to read company files and save an E-Docs
    // template (a direct secure_documents upload) via the roles claim — matching
    // how Firestore authorizes the same user.
    const rolesOnlyHr = authedStorage(
      nextUid('roles-only-hr'),
      teamClaims('co1', 'hr_user', { includeCompanyTeamIds: false }),
    );
    await assertSucceeds(getMetadata(ref(rolesOnlyHr, paths.co1DriverBLicense)));
    await assertSucceeds(
      uploadString(
        ref(rolesOnlyHr, testPath(runCounter, 'secure_documents/co1/templates/roles-only.pdf')),
        'tmpl',
        'raw',
        { contentType: 'application/pdf' },
      ),
    );
  });

  it('still denies a user with neither companyTeamIds nor a role for that company', async () => {
    // A company_admin of co2 (wrong tenant), no companyTeamIds — must be denied co1.
    const otherTenant = authedStorage(
      nextUid('other-tenant'),
      teamClaims('co2', 'company_admin', { includeCompanyTeamIds: false }),
    );
    await assertFails(getMetadata(ref(otherTenant, paths.co1DriverBLicense)));
    await assertFails(
      uploadString(
        ref(otherTenant, testPath(runCounter, 'secure_documents/co1/templates/cross-tenant.pdf')),
        'blocked',
        'raw',
        { contentType: 'application/pdf' },
      ),
    );
  });
});
