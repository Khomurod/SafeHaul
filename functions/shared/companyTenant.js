/**
 * Validates companies/{companyId} exists and is accepting intake (applications/uploads).
 */

const functions = require('firebase-functions/v1');

const INACTIVE_STATUSES = ['inactive', 'suspended', 'disabled'];

/**
 * @param {FirebaseFirestore.Firestore} db
 * @param {string} companyId
 * @returns {Promise<FirebaseFirestore.DocumentData>}
 */
const SANDBOX_COMPANY_ID = 'SANDBOX';

async function assertCompanyAcceptingIntake(db, companyId) {
  if (!companyId || typeof companyId !== 'string') {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid company.');
  }

  // Public ATS sandbox: no real tenant required; guest submit uses this id for test applications.
  if (companyId === SANDBOX_COMPANY_ID) {
    return {
      companyName: 'SafeHaul Sandbox (Testing)',
      isActive: true,
      applicationConfig: {
        cdlUpload: { hidden: false, required: true },
        medCardUpload: { hidden: false, required: true },
        showEmergencyContacts: false,
      },
    };
  }

  const snap = await db.collection('companies').doc(companyId).get();
  if (!snap.exists) {
    throw new functions.https.HttpsError('not-found', 'Company not found.');
  }

  const d = snap.data() || {};

  if (d.isActive === false) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'This company is not accepting applications.'
    );
  }

  const st = typeof d.status === 'string' ? d.status.toLowerCase() : '';
  if (st !== '' && INACTIVE_STATUSES.includes(st)) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'This company is not accepting applications.'
    );
  }

  return d;
}

module.exports = { assertCompanyAcceptingIntake };
