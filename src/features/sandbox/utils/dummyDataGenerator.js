/**
 * Realistic dummy patches per wizard step (matches PublicApplyHandler + Stepper order).
 * Guest form uses plain React state, not react-hook-form — parent merges these objects.
 */

/** Minimal valid PNG data URL (long enough for Step9 signature length check). Same idea as E2E. */
export const SANDBOX_SIGNATURE_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAHgAAAAUCAYAAABwR4+JAAAAAXNSR0IArs4c6QAAAO5JREFUaEPt1zEOgjAURdEtjPEEXoCLcAuuYfQAroJzMJ5BG8kpXAxwsf96YfNQfGrJ1zR56Qvw/6MQQxgkNC+CP+zr79WD4QxR2jEfSxO93Jt0NdRnM6xQ81YeJX1FW/EMubQIq4B15xTCg+0haEoQO4jYl3mRr6z4nQ18fpwevUJj2wkfjmaB2YRQ4c2tw+Zx0AMmN7cN6wEJxS3R+lAk4lHCAZ8YULvXLiP9hCV7dAW8hJw4YZSUdBBQ+J0F6sN2W3/8c2kP4aK8e5zQ3VCfN8bYQ9xH+Hh2BV9AE2Lh5ws6gN95AAAAAElFTkSuQmCC';

const PLACEHOLDER_BLOB = {
  name: 'sandbox-placeholder.pdf',
  url: 'https://example.com/sandbox-upload-placeholder',
  storagePath: 'companies/SANDBOX/applications/sandbox-placeholder/file.pdf',
};

/**
 * @param {number} stepIndex — 0-based index in the active Stepper pageConfig
 * @param {{ hasCustomQuestions: boolean }} opts
 * @returns {Record<string, unknown>} partial formData to merge
 */
export function getMagicFillPatchForStep(stepIndex, opts = { hasCustomQuestions: false }) {
  const { hasCustomQuestions } = opts;

  // With DynamicQuestionsStep: indices 0–6 base steps, 7 = custom, 8 = review, 9 = consent.
  if (hasCustomQuestions) {
    if (stepIndex === 0) return patchStep1Contact();
    if (stepIndex === 1) return patchStep2Qualifications();
    if (stepIndex === 2) return patchStep3License();
    if (stepIndex === 3) return patchStep4Violations();
    if (stepIndex === 4) return patchStep5Accidents();
    if (stepIndex === 5) return patchStep6Employment();
    if (stepIndex === 6) return patchStep7General();
    if (stepIndex === 7) return patchCustomQuestions();
    if (stepIndex === 8) return patchStep8Review();
    if (stepIndex === 9) return patchStep9Consent();
    return {};
  }

  if (stepIndex === 0) return patchStep1Contact();
  if (stepIndex === 1) return patchStep2Qualifications();
  if (stepIndex === 2) return patchStep3License();
  if (stepIndex === 3) return patchStep4Violations();
  if (stepIndex === 4) return patchStep5Accidents();
  if (stepIndex === 5) return patchStep6Employment();
  if (stepIndex === 6) return patchStep7General();
  if (stepIndex === 7) return patchStep8Review();
  if (stepIndex === 8) return patchStep9Consent();
  return {};
}

function patchStep1Contact() {
  return {
    firstName: 'Jordan',
    lastName: 'McTest',
    phone: '5551234567',
    email: 'jordan.mctest@example.com',
    dob: '1990-05-15',
    street: '1001 Commerce Dr',
    city: 'Austin',
    state: 'Texas',
    zip: '78701',
    'residence-3-years': 'yes',
    'known-by-other-name': 'no',
    middleName: '',
    'sms-consent': 'yes',
  };
}

function patchStep2Qualifications() {
  return {
    'legal-work': 'yes',
    'english-fluency': 'yes',
    'drug-test-positive': 'no',
    'dot-return-to-duty': 'yes',
    'experience-years': '5+',
  };
}

function patchStep3License() {
  return {
    'cdl-class': 'Class A',
    licenseNumber: 'TX12345678',
    cdlState: 'Texas',
    cdlIssue: { month: '1', day: '15', year: '2018' },
    cdlExpiration: { month: '12', day: '31', year: '2028' },
    endorsements: 'T',
    restrictions: 'None',
    'medical-certificate': 'yes',
    'self-certify-type': 'not_applicable',
    'cdl-front': { ...PLACEHOLDER_BLOB, name: 'cdl-front.png' },
    'cdl-back': { ...PLACEHOLDER_BLOB, name: 'cdl-back.png' },
    'medical-card-upload': { ...PLACEHOLDER_BLOB, name: 'medical.pdf' },
  };
}

function patchStep4Violations() {
  return {
    'has-violations': 'no',
    violations: [],
  };
}

function patchStep5Accidents() {
  return {
    'has-accidents': 'no',
    accidents: [],
  };
}

function patchStep6Employment() {
  return {
    employers: [
      {
        companyName: 'Acme Transport LLC',
        dotNumber: '1234567',
        address: '200 Industrial Pkwy',
        city: 'Dallas',
        state: 'Texas',
        phone: '2145550100',
        companyEmail: 'hr@acmetransport.test',
        position: 'OTR Driver',
        startDate: { month: '3', day: '1', year: '2020' },
        endDate: { month: '6', day: '30', year: '2024' },
        reasonForLeaving: 'Seeking new opportunity',
        supervisorName: 'Pat Lee',
        supervisorPhone: '2145550101',
        supervisorEmail: 'pat@acmetransport.test',
        mayContact: 'yes',
      },
    ],
  };
}

function patchStep7General() {
  return {
    'employment-gap': 'no',
    'has-felony': 'no',
    positionType: 'companyDriver',
    expStraightTruckMiles: '0-25k',
    expStraightTruckExp: '1',
    expSemiTrailerMiles: '100k+',
    expSemiTrailerExp: '5+',
    expTwoTrailersMiles: '0-25k',
    expTwoTrailersExp: '0-6 months',
  };
}

function patchCustomQuestions() {
  return {
    customQuestionResponses: {},
  };
}

function patchStep8Review() {
  return {};
}

function patchStep9Consent() {
  return {
    'agree-electronic': 'agreed',
    'agree-background-check': 'agreed',
    'agree-psp': 'agreed',
    'final-certification': 'agreed',
    signature: SANDBOX_SIGNATURE_DATA_URL,
    signatureType: 'drawn',
    signatureDate: new Date().toISOString(),
  };
}
