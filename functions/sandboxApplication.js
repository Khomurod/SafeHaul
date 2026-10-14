/**
 * Super Admin tooling: list tenants, delete sandbox test apps, transfer SANDBOX -> real company.
 */

const functions = require('firebase-functions/v1');
const { db, storage } = require('./firebaseAdmin');
const { FieldValue } = require('firebase-admin/firestore');
const { assertCompanyAcceptingIntake } = require('./shared/companyTenant');
const { collectStoragePaths, deleteApplicationFiles } = require('./shared/applicationStorage');
const { ORIGINAL_PDF_PREFIX } = require('./shared/preserveApplicationPdf');

const SANDBOX_ID = 'SANDBOX';
/** Documents written per batch, under Firestore's 500. */
const COPY_BATCH = 400;
/**
 * What a transfer carries besides the record: the frozen submission, its
 * attempt claims (a redelivery then finds its snapshot instead of writing a
 * second) and the DQ entries, the preserved PDF's among them. Not the history:
 * an `activity_logs` or `activities` document created under the company sets
 * off its triggers, so an old sandbox callback would notify the company's
 * staff and test calls would count in its daily statistics.
 */
const CARRIED_SUBCOLLECTIONS = Object.freeze(['submission', 'submission_attempts', 'dq_files']);
const INACTIVE_STATUSES = ['inactive', 'suspended', 'disabled'];

function assertSuperAdmin(context) {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Sign in required.');
  }
  const token = context.auth.token || {};
  const gr = token.globalRole || (token.roles && token.roles.globalRole);
  if (gr !== 'super_admin') {
    throw new functions.https.HttpsError('permission-denied', 'Super Admin only.');
  }
}

function isTenantEligible(docId, data) {
  if (!data || docId === SANDBOX_ID) return false;
  if (data.isActive === false) return false;
  const st = typeof data.status === 'string' ? data.status.toLowerCase() : '';
  if (st !== '' && INACTIVE_STATUSES.includes(st)) return false;
  return true;
}

exports.listSandboxTenantCompanies = functions
  .runWith({ memory: '256MB' })
  .https.onCall(async (_data, context) => {
    assertSuperAdmin(context);
    const snap = await db.collection('companies').limit(500).get();
    const companies = [];
    snap.forEach((doc) => {
      const d = doc.data() || {};
      if (!isTenantEligible(doc.id, d)) return;
      companies.push({
        id: doc.id,
        companyName: d.companyName || doc.id,
        isActive: d.isActive !== false,
      });
    });
    companies.sort((a, b) => String(a.companyName || '').localeCompare(String(b.companyName || '')));
    return { companies };
  });

exports.deleteSandboxApplication = functions
  .runWith({ memory: '256MB' })
  .https.onCall(async (data, context) => {
    assertSuperAdmin(context);
    const applicationId = data?.applicationId;
    if (!applicationId || typeof applicationId !== 'string') {
      throw new functions.https.HttpsError('invalid-argument', 'applicationId required.');
    }
    const ref = db.collection('companies').doc(SANDBOX_ID).collection('applications').doc(applicationId);
    const snap = await ref.get();
    if (!snap.exists) {
      throw new functions.https.HttpsError('not-found', 'Application not found.');
    }
    const d = snap.data() || {};
    if (d.companyId !== SANDBOX_ID) {
      throw new functions.https.HttpsError('failed-precondition', 'Not a sandbox application.');
    }

    // The same best-effort Storage cleanup as deleteApplication, before the doc
    // is gone. A sandbox submission is public and its file fields are whatever
    // the browser sent, so only paths inside the sandbox's own tree are deleted:
    // a crafted path naming a real company's file is left alone.
    try {
      const ownTree = `companies/${SANDBOX_ID}/`;
      await deleteApplicationFiles({
        bucket: storage.bucket(),
        companyId: SANDBOX_ID,
        applicationId,
        paths: collectStoragePaths(d, SANDBOX_ID).filter((path) => path.startsWith(ownTree)),
      });
    } catch (err) {
      console.warn(`[deleteSandboxApplication] Storage cleanup partial failure for ${applicationId}: ${err?.message || err}`);
    }

    await db.recursiveDelete(ref);
    return { success: true };
  });

/** Where an application's preserved PDFs live under a company. */
const originalsPrefix = (companyId, applicationId) => `${ORIGINAL_PDF_PREFIX}/${companyId}/${applicationId}/`;

/**
 * Copies the application's preserved PDFs (the submission originals, which
 * carry the full SSN) to the target company's path, never over an object
 * already there: one is, from an earlier try of this transfer. Returns the
 * sandbox objects it copied.
 */
async function copyPreservedPdfs(bucket, applicationId, targetCompanyId) {
  const from = originalsPrefix(SANDBOX_ID, applicationId);
  const to = originalsPrefix(targetCompanyId, applicationId);
  const [files] = await bucket.getFiles({ prefix: from });
  for (const file of files) {
    try {
      await file.copy(bucket.file(`${to}${file.name.slice(from.length)}`), { preconditionOpts: { ifGenerationMatch: 0 } });
    } catch (err) {
      if (err?.code !== 412) throw err;
    }
  }
  return files;
}

/**
 * Copies the carried subcollections of the sandbox record under the target
 * record, with the tenant field and every preserved-PDF path pointed at the
 * target. By prefix: an entry whose sandbox PDF an earlier try already
 * deleted moves too.
 */
async function copySubcollections(sourceRef, destRef, applicationId, targetCompanyId) {
  const from = originalsPrefix(SANDBOX_ID, applicationId);
  const to = originalsPrefix(targetCompanyId, applicationId);
  const retarget = (data) => {
    const copy = { ...data };
    if (copy.companyId === SANDBOX_ID) copy.companyId = targetCompanyId;
    if (typeof copy.storagePath === 'string' && copy.storagePath.startsWith(from)) {
      copy.storagePath = `${to}${copy.storagePath.slice(from.length)}`;
    }
    return copy;
  };
  for (const name of CARRIED_SUBCOLLECTIONS) {
    const { docs } = await sourceRef.collection(name).get();
    for (let i = 0; i < docs.length; i += COPY_BATCH) {
      const batch = db.batch();
      for (const doc of docs.slice(i, i + COPY_BATCH)) {
        batch.set(destRef.collection(name).doc(doc.id), retarget(doc.data() || {}));
      }
      await batch.commit();
    }
  }
}

exports.transferSandboxApplication = functions
  .runWith({ memory: '512MB', timeoutSeconds: 60 })
  .https.onCall(async (data, context) => {
    assertSuperAdmin(context);
    const applicationId = data?.applicationId;
    const targetCompanyId = data?.targetCompanyId;
    if (!applicationId || typeof applicationId !== 'string' || !targetCompanyId || typeof targetCompanyId !== 'string') {
      throw new functions.https.HttpsError('invalid-argument', 'applicationId and targetCompanyId required.');
    }
    if (targetCompanyId === SANDBOX_ID) {
      throw new functions.https.HttpsError('invalid-argument', 'Choose a real tenant company.');
    }

    const target = await assertCompanyAcceptingIntake(db, targetCompanyId);
    const sourceRef = db.collection('companies').doc(SANDBOX_ID).collection('applications').doc(applicationId);
    const sourceSnap = await sourceRef.get();
    if (!sourceSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'Application not found.');
    }
    const payload = sourceSnap.data() || {};
    if (payload.companyId !== SANDBOX_ID) {
      throw new functions.https.HttpsError('failed-precondition', 'Not a sandbox application.');
    }

    const destRef = db.collection('companies').doc(targetCompanyId).collection('applications').doc(applicationId);
    const destSnap = await destRef.get();
    if (destSnap.exists) {
      throw new functions.https.HttpsError(
        'already-exists',
        'An application with this id already exists under the target company.'
      );
    }

    const companyName = target.companyName || targetCompanyId;
    const moved = {
      ...payload,
      companyId: targetCompanyId,
      companyName,
      status: 'New Application',
      transferredFromSandboxAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };

    // The copies first, then the sandbox PDFs go, then the company's record
    // appears and the sandbox record goes. A step that fails stops the transfer
    // with the sandbox record still there, and running it again finishes it, so
    // a finished transfer leaves no PDF with the full SSN that no record names.
    const bucket = storage.bucket();
    const sandboxPdfs = await copyPreservedPdfs(bucket, applicationId, targetCompanyId);
    await copySubcollections(sourceRef, destRef, applicationId, targetCompanyId);
    for (const file of sandboxPdfs) await file.delete();
    await destRef.set(moved);
    await db.recursiveDelete(sourceRef);

    return { success: true, companyId: targetCompanyId, companyName, applicationId };
  });
