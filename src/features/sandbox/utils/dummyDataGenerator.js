/**
 * Magic Fill: made-up answers for the sandbox wizard, one page at a time. The
 * sandbox's 🧪 Magic Fill Step button asks for the page on screen and
 * `PublicApplyHandler` merges the patch into the answers (plain state, not
 * react-hook-form).
 *
 * The owner's pre-release walk presses it on every page
 * (`docs/RELEASE_CHECKLIST.md`), so each page's patch answers every question that
 * page requires, under the names and in the shapes the page stores today.
 * `dummyDataGenerator.walk.test.jsx` renders each page with the sandbox company's
 * settings and holds it to that: Magic Fill, then Continue.
 *
 * Dates are counted from today, so the licence is never expired and the employer
 * always covers the past three years.
 *
 * Left to the person, as on a real application: the MVR authorization on the
 * Motor Vehicle Record page, and the agreements, the certification and the
 * signature on the last page. Each is an acceptance of wording on screen that the
 * page records with its version, which a patch cannot honestly claim. A
 * company's own questions are left too (the sandbox company has none).
 *
 * The documents are made-up names with no stored file behind them: the licence
 * page counts them as attached and does not try to open them.
 */

/** A document the licence page counts as attached; nothing is stored for it. */
const madeUpDocument = (name) => ({ name: `sandbox-${name}` });

const pad = (number) => String(number).padStart(2, '0');

/**
 * @param {number} stepIndex — 0-based page index in the wizard. The seven pages
 *   Magic Fill answers come first in either order; the company's own questions,
 *   Review and Agreements follow them.
 * @returns {Record<string, unknown>} partial formData to merge
 */
export function getMagicFillPatchForStep(stepIndex) {
  const patch = [
    patchStep1Contact,
    patchStep2Qualifications,
    patchStep3License,
    patchStep4Violations,
    patchStep5Accidents,
    patchStep6Employment,
    patchStep7General,
  ][stepIndex];
  return patch ? patch(new Date()) : {};
}

function patchStep1Contact() {
  return {
    firstName: 'Jordan',
    lastName: 'McTest',
    phone: '5551234567',
    email: 'jordan.mctest@example.com',
    // The number the browser tests type: well formed, and no one's.
    ssn: '123-45-6789',
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
    'pre-employment-test-positive': 'no',
    'dot-return-to-duty': 'yes',
    'experience-years': '5+',
  };
}

function patchStep3License(today) {
  const year = today.getFullYear();
  return {
    cdlState: 'Texas',
    cdlClass: 'Class A',
    cdlNumber: 'TX12345678',
    cdlExpiration: `${year + 2}-12-31`,
    endorsements: 'T',
    'has-other-licenses': 'no',
    'cdl-front': madeUpDocument('cdl-front.png'),
    'cdl-back': madeUpDocument('cdl-back.png'),
    'medical-card-upload': madeUpDocument('medical-card.pdf'),
    medCardExpiration: `${year + 1}-06-30`,
    'has-twic': 'no',
  };
}

function patchStep4Violations() {
  return {
    'revoked-licenses': 'no',
    'driving-convictions': 'no',
    'drug-alcohol-convictions': 'no',
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

function patchStep6Employment(today) {
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
        // Month and year, as the page stores them: five years to this month.
        startDate: `${today.getFullYear() - 5}-01`,
        endDate: `${today.getFullYear()}-${pad(today.getMonth() + 1)}`,
        reasonForLeaving: 'Seeking new opportunity',
        supervisorName: 'Pat Lee',
        supervisorPhone: '2145550101',
        supervisorEmail: 'pat@acmetransport.test',
        mayContact: 'yes',
        subjectToFmcsrs: 'yes',
        subjectToDotTesting: 'yes',
      },
    ],
  };
}

function patchStep7General() {
  return {
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
