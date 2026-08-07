// functions/shared/legalAgreements.js
//
// Canonical, VERSIONED registry of the legal agreements a driver is asked to
// read, accept and sign.
//
// WHY THIS EXISTS
// ---------------
// The agreement text used to live as string constants inside the PDF generator
// (src/shared/utils/pdfGenerator.js). Three things were wrong with that:
//
//   1. Editing the wording retroactively rewrote every historical PDF, so a
//      document could no longer be trusted to show what the driver actually
//      signed.
//   2. The generator stamped a signature block onto all four agreements
//      unconditionally, whether or not that agreement had been presented to or
//      accepted by the driver. The `agreements` value it was handed was
//      destructured and then never read.
//   3. Company interpolation was `text.replaceAll('Company', companyName)`,
//      which also rewrote the *defined term* in
//      `"We," "Us," and "Company" refer to the motor carrier...`, producing
//      sentences that no longer parsed.
//
// The registry fixes all three by making each agreement an immutable, versioned
// record. A submission stores the version id AND the exact rendered text it
// presented, so later edits here can never alter history.
//
// ADDING OR CHANGING AN AGREEMENT
// -------------------------------
// Never edit the body of a published version. Add a new version id instead.
// `legacy-1` in particular must never be touched: it is the forensic record of
// what pre-rebuild applications displayed, reconstructed from the generator
// constants and their substitution behaviour, and historical applications are
// attributed to it.

/**
 * Agreements are rendered by substituting explicit `{{companyName}}`
 * placeholders — never by blind word replacement.
 */
function renderAgreementBody(template, { companyName }) {
    const name = typeof companyName === 'string' && companyName.trim()
        ? companyName.trim()
        : '[COMPANY NAME NOT ON RECORD]';
    return String(template).replace(/\{\{companyName\}\}/g, name);
}

// ---------------------------------------------------------------------------
// legacy-1 — FROZEN FORENSIC RECORD. DO NOT EDIT.
//
// Verbatim copies of the constants that shipped in pdfGenerator.js, kept so
// historical applications can be attributed to the wording they were actually
// shown. `legacySubstitution` reproduces the old buggy `replaceAll` behaviour
// exactly, because faithfully representing what a driver saw matters more than
// showing them corrected prose after the fact.
// ---------------------------------------------------------------------------

const LEGACY_ELECTRONIC_SIG = `AGREEMENT TO CONDUCT TRANSACTION ELECTRONICALLY

1. DEFINITIONS.
"We," "Us," and "Company" refer to the motor carrier to which you are applying.
"You" and "Your" refer to the applicant. "Communication" means any application forms, disclosures, notices, responses, agreements, and other documents related to your application for employment.

2. SCOPE. You agree that we may provide you with any Communications in electronic format, and that we may discontinue sending paper Communications to you.
You agree that your electronic signature has the same legal effect as a manual signature.

3. CONSENT.
By signing this application electronically, you consent to receive and respond to Communications in electronic format.
You have the right to request paper copies of any Communication by contacting us directly.

4. WITHDRAWAL.
You may withdraw your consent to receive Communications electronically by providing written notice to us.
However, withdrawing consent may terminate the application process if we are unable to proceed with a paper-based application.

5. SYSTEM REQUIREMENTS. To access and retain the electronic Communications, you will need a device with internet access and a PDF reader.
I acknowledge that I have read, understand, and agree to the terms set forth above.`;

const LEGACY_FCRA_DISCLOSURE = `BACKGROUND CHECK DISCLOSURE AND AUTHORIZATION (FCRA)

In connection with your application for employment with Company ("Prospective Employer"), Prospective Employer, its employees, agents or contractors may obtain one or more reports regarding your credit, driving, and/or criminal background history from a consumer reporting agency.
These reports may include information regarding your character, general reputation, personal characteristics, mode of living, driving history, criminal history, and employment history.

AUTHORIZATION
I hereby authorize Prospective Employer to obtain the consumer reports described above about me.
I authorize, without reservation, any party or agency contacted by Prospective Employer to furnish the above-mentioned information.
I understand that I have the right to make a written request within a reasonable period of time to receive additional detailed information about the nature and scope of any investigation.
I acknowledge that I have received a copy of the summary of rights under the Fair Credit Reporting Act (FCRA).`;

const LEGACY_PSP_DISCLOSURE = `IMPORTANT DISCLOSURE REGARDING BACKGROUND REPORTS FROM THE PSP Online Service

In connection with your application for employment with Company ("Prospective Employer"), Prospective Employer, its employees, agents or contractors may obtain one or more reports regarding your driving, and safety inspection history from the Federal Motor Carrier Safety Administration (FMCSA).
When the application for employment is submitted in connection with a driver position, Prospective Employer cannot obtain background reports from FMCSA unless you consent in writing.

AUTHORIZATION
I hereby authorize Prospective Employer to access the FMCSA Pre-Employment Screening Program (PSP) system to seek information regarding my commercial driving safety record and information regarding my safety inspection history.
I understand that I am authorizing the release of safety performance information including crash data from the previous five (5) years and inspection history from the previous three (3) years.
I understand that I have the right to review the information provided by the PSP system and to contest the accuracy of that information by submitting a request to the FMCSA DataQs system.`;

const LEGACY_CLEARINGHOUSE_CONSENT = `GENERAL CONSENT FOR FULL QUERY OF THE FMCSA DRUG AND ALCOHOL CLEARINGHOUSE

I hereby provide consent to Company ("Prospective Employer") to conduct a full query of the FMCSA Commercial Driver's License Drug and Alcohol Clearinghouse (Clearinghouse) to determine whether drug or alcohol violation information about me exists in the Clearinghouse, and to release that information to Prospective Employer.
I understand that if the full query conducted by Prospective Employer indicates that drug or alcohol violation information about me exists in the Clearinghouse, FMCSA will disclose that information to Prospective Employer.
I further understand that if I refuse to provide consent for Prospective Employer to conduct a full query of the Clearinghouse, Prospective Employer must prohibit me from performing safety-sensitive functions, including driving a commercial motor vehicle, as required by FMCSA's drug and alcohol program regulations.`;

/**
 * The old generator's substitution, preserved bug-for-bug so a reconstructed
 * historical document matches what was actually rendered at the time.
 */
function legacySubstitution(text, { companyName }) {
    const name = companyName || '[COMPANY NAME]';
    return String(text).split('Company').join(name).split('Prospective Employer').join(name);
}

// ---------------------------------------------------------------------------
// v1 — current wording.
//
// Same legal substance as legacy-1; the only changes are mechanical:
// `{{companyName}}` placeholders where the carrier is named, and the defined
// term `"Company"` left intact instead of being overwritten. No obligation,
// authorization or right has been added, removed or reworded.
// ---------------------------------------------------------------------------

const V1_ELECTRONIC_SIG = `AGREEMENT TO CONDUCT TRANSACTION ELECTRONICALLY

1. DEFINITIONS.
"We," "Us," and "Company" refer to {{companyName}}, the motor carrier to which you are applying.
"You" and "Your" refer to the applicant. "Communication" means any application forms, disclosures, notices, responses, agreements, and other documents related to your application for employment.

2. SCOPE. You agree that we may provide you with any Communications in electronic format, and that we may discontinue sending paper Communications to you.
You agree that your electronic signature has the same legal effect as a manual signature.

3. CONSENT.
By signing this application electronically, you consent to receive and respond to Communications in electronic format.
You have the right to request paper copies of any Communication by contacting us directly.

4. WITHDRAWAL.
You may withdraw your consent to receive Communications electronically by providing written notice to us.
However, withdrawing consent may terminate the application process if we are unable to proceed with a paper-based application.

5. SYSTEM REQUIREMENTS. To access and retain the electronic Communications, you will need a device with internet access and a PDF reader.
I acknowledge that I have read, understand, and agree to the terms set forth above.`;

const V1_FCRA_DISCLOSURE = `BACKGROUND CHECK DISCLOSURE AND AUTHORIZATION (FCRA)

In connection with your application for employment with {{companyName}} ("Prospective Employer"), Prospective Employer, its employees, agents or contractors may obtain one or more reports regarding your credit, driving, and/or criminal background history from a consumer reporting agency.
These reports may include information regarding your character, general reputation, personal characteristics, mode of living, driving history, criminal history, and employment history.

AUTHORIZATION
I hereby authorize Prospective Employer to obtain the consumer reports described above about me.
I authorize, without reservation, any party or agency contacted by Prospective Employer to furnish the above-mentioned information.
I understand that I have the right to make a written request within a reasonable period of time to receive additional detailed information about the nature and scope of any investigation.
I acknowledge that I have received a copy of the summary of rights under the Fair Credit Reporting Act (FCRA).`;

const V1_PSP_DISCLOSURE = `IMPORTANT DISCLOSURE REGARDING BACKGROUND REPORTS FROM THE PSP Online Service

In connection with your application for employment with {{companyName}} ("Prospective Employer"), Prospective Employer, its employees, agents or contractors may obtain one or more reports regarding your driving, and safety inspection history from the Federal Motor Carrier Safety Administration (FMCSA).
When the application for employment is submitted in connection with a driver position, Prospective Employer cannot obtain background reports from FMCSA unless you consent in writing.

AUTHORIZATION
I hereby authorize Prospective Employer to access the FMCSA Pre-Employment Screening Program (PSP) system to seek information regarding my commercial driving safety record and information regarding my safety inspection history.
I understand that I am authorizing the release of safety performance information including crash data from the previous five (5) years and inspection history from the previous three (3) years.
I understand that I have the right to review the information provided by the PSP system and to contest the accuracy of that information by submitting a request to the FMCSA DataQs system.`;

const V1_CLEARINGHOUSE_CONSENT = `GENERAL CONSENT FOR FULL QUERY OF THE FMCSA DRUG AND ALCOHOL CLEARINGHOUSE

I hereby provide consent to {{companyName}} ("Prospective Employer") to conduct a full query of the FMCSA Commercial Driver's License Drug and Alcohol Clearinghouse (Clearinghouse) to determine whether drug or alcohol violation information about me exists in the Clearinghouse, and to release that information to Prospective Employer.
I understand that if the full query conducted by Prospective Employer indicates that drug or alcohol violation information about me exists in the Clearinghouse, FMCSA will disclose that information to Prospective Employer.
I further understand that if I refuse to provide consent for Prospective Employer to conduct a full query of the Clearinghouse, Prospective Employer must prohibit me from performing safety-sensitive functions, including driving a commercial motor vehicle, as required by FMCSA's drug and alcohol program regulations.`;

/**
 * Every agreement, keyed by stable id. `order` fixes presentation sequence so
 * the driver, the on-screen review and the PDF cannot disagree about it.
 *
 * `required: true` means the agreement may not be dropped from the set — the
 * FMCSA Clearinghouse consent in particular is mandatory under 49 CFR Part 382
 * subpart G and must always be presented.
 */
const AGREEMENTS = Object.freeze({
    electronicSignature: {
        id: 'electronicSignature',
        order: 1,
        required: true,
        requiresSignature: true,
        title: 'AGREEMENT TO CONDUCT TRANSACTION ELECTRONICALLY',
        versions: {
            'legacy-1': { body: LEGACY_ELECTRONIC_SIG, legacy: true },
            v1: { body: V1_ELECTRONIC_SIG },
        },
    },
    fcraDisclosure: {
        id: 'fcraDisclosure',
        order: 2,
        required: true,
        requiresSignature: true,
        title: 'BACKGROUND CHECK DISCLOSURE AND AUTHORIZATION',
        versions: {
            'legacy-1': { body: LEGACY_FCRA_DISCLOSURE, legacy: true },
            v1: { body: V1_FCRA_DISCLOSURE },
        },
    },
    pspDisclosure: {
        id: 'pspDisclosure',
        order: 3,
        required: true,
        requiresSignature: true,
        title: 'FMCSA PSP DISCLOSURE AND AUTHORIZATION',
        versions: {
            'legacy-1': { body: LEGACY_PSP_DISCLOSURE, legacy: true },
            v1: { body: V1_PSP_DISCLOSURE },
        },
    },
    clearinghouseConsent: {
        id: 'clearinghouseConsent',
        order: 4,
        required: true,
        requiresSignature: true,
        title: 'FMCSA CLEARINGHOUSE FULL QUERY CONSENT',
        versions: {
            'legacy-1': { body: LEGACY_CLEARINGHOUSE_CONSENT, legacy: true },
            v1: { body: V1_CLEARINGHOUSE_CONSENT },
        },
    },
});

/** Version every NEW submission presents. Historical records keep their own. */
const CURRENT_AGREEMENT_VERSION = 'v1';

/** Agreement ids that must always be presented, in presentation order. */
function requiredAgreementIds() {
    return Object.values(AGREEMENTS)
        .filter((a) => a.required)
        .sort((a, b) => a.order - b.order)
        .map((a) => a.id);
}

/**
 * Resolve one agreement at a specific version into the exact text to present.
 *
 * @returns {{id, version, title, body, requiresSignature, legacy: boolean}}
 * @throws {Error} on an unknown agreement or version — silently falling back
 *   would risk showing a driver different wording than we recorded.
 */
function resolveAgreement(agreementId, version, { companyName } = {}) {
    const agreement = AGREEMENTS[agreementId];
    if (!agreement) throw new Error(`Unknown legal agreement: ${agreementId}`);

    const entry = agreement.versions[version];
    if (!entry) throw new Error(`Unknown version "${version}" for agreement ${agreementId}`);

    const body = entry.legacy
        ? legacySubstitution(entry.body, { companyName })
        : renderAgreementBody(entry.body, { companyName });

    return {
        id: agreement.id,
        version,
        title: agreement.title,
        body,
        requiresSignature: agreement.requiresSignature,
        legacy: Boolean(entry.legacy),
    };
}

/**
 * The full ordered agreement set to present for a submission.
 *
 * @param {object} opts
 * @param {string} opts.companyName Carrier name substituted into the text.
 * @param {string} [opts.version]   Defaults to CURRENT_AGREEMENT_VERSION.
 */
function resolveAgreementSet({ companyName, version = CURRENT_AGREEMENT_VERSION } = {}) {
    return requiredAgreementIds().map((id) => resolveAgreement(id, version, { companyName }));
}

module.exports = {
    AGREEMENTS,
    CURRENT_AGREEMENT_VERSION,
    legacySubstitution,
    renderAgreementBody,
    requiredAgreementIds,
    resolveAgreement,
    resolveAgreementSet,
};
