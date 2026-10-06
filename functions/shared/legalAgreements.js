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
// WHERE EACH AGREEMENT IS SHOWN
// -----------------------------
// `presentedOn` names the wizard page: `consent` for the final agreements step,
// `drivingRecord` for the MVR authorization, which is answered Yes/No on the
// Motor Vehicle Record page. `resolveAgreementSet` returns the whole set; each
// page filters by placement, and the snapshot records all of them.
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

// There is deliberately NO `LEGACY_CLEARINGHOUSE_CONSENT`. The old consent
// screen presented three agreements; Clearinghouse consent was never among
// them, even though the old PDF printed a Clearinghouse page and signed it.
// Keeping frozen wording here would invite a reconstruction to attribute that
// page to a driver who was never asked.

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

const V1_MVR_AUTHORIZATION = `MOTOR VEHICLE RECORD (MVR) AUTHORIZATION

In connection with my application for employment with {{companyName}} ("Prospective Employer"), I authorize Prospective Employer, its employees, agents or contractors to obtain my motor vehicle record (driving record) from the driver licensing agency of every state in which I have held a driver's license during the past three (3) years, as permitted by 49 CFR 391.23 and applicable state law.

I understand that Prospective Employer will use this record to evaluate my qualifications to operate a commercial motor vehicle, and that, if I am hired, a copy of the record will be placed in my driver qualification file.

I understand that I have the right to review the information obtained and to dispute its accuracy with the state agency that issued it.`;

// ---------------------------------------------------------------------------
// v2 — current wording (2026-10-06).
//
// Three agreements change, each to a primary source. The other two keep their
// v1 body word for word: a set is versioned as a whole, so they move to v2
// unchanged.
//
// * PSP — FMCSA's mandatory Disclosure and Authorization language, word for
//   word: https://www.psp.fmcsa.dot.gov/PspApi/documents/PSPDisclosureandAuthorizationForm.pdf
//   ("LAST UPDATED 2/11/2016"). The form says the language "must be used in
//   whole, exactly as provided" and "must exist as one stand-alone document".
//   v1 was a paraphrase about a sixth of its length. The two blanks are the
//   carrier's name. The form's Date, Signature and printed-name lines are
//   collected electronically. Its closing NOTICEs speak to account holders, not
//   applicants, so they are not presented. `legalAgreements.test.js` pins the
//   words against the official text.
// * FCRA — a disclosure and authorization with nothing else in the document
//   (15 U.S.C. 1681b(b)(2)(A); Syed v. M-I, 9th Cir. 2017). v1's
//   authorization of third parties "without reservation", its investigative-report
//   rights sentence and its acknowledgement of a summary the app never gave are
//   dropped. The CFPB summary of rights a driver applying online must be given
//   (1681b(b)(2)(B)) is linked beside the document, not inside it.
// * Clearinghouse — FMCSA's sample "General Consent for Limited Queries", with
//   the scope the sample asks the employer to state. A full-query consent can
//   only be given by the driver inside the Clearinghouse (49 CFR 382.703(b), (d)),
//   so v1's "general consent for full query" granted nothing. The page now says
//   where the full-query consent is given.
// ---------------------------------------------------------------------------

const V2_FCRA_DISCLOSURE = `BACKGROUND CHECK DISCLOSURE AND AUTHORIZATION

{{companyName}} ("Prospective Employer") may obtain one or more consumer reports about you from a consumer reporting agency for employment purposes: to decide whether to hire you and, if you are hired, during your employment.

These reports may include information about your character, general reputation, personal characteristics, mode of living, driving record, criminal history and employment history.

AUTHORIZATION
I authorize Prospective Employer to obtain consumer reports about me for employment purposes, now and, if I am hired, at any time during my employment.`;

const V2_PSP_DISCLOSURE = `IMPORTANT DISCLOSURE REGARDING BACKGROUND REPORTS FROM THE PSP Online Service

In connection with your application for employment with {{companyName}} (“Prospective Employer”), Prospective Employer, its employees, agents or contractors may obtain one or more reports regarding your driving, and safety inspection history from the Federal Motor Carrier Safety Administration (FMCSA).

When the application for employment is submitted in person, if the Prospective Employer uses any information it obtains from FMCSA in a decision to not hire you or to make any other adverse employment decision regarding you, the Prospective Employer will provide you with a copy of the report upon which its decision was based and a written summary of your rights under the Fair Credit Reporting Act before taking any final adverse action. If any final adverse action is taken against you based upon your driving history or safety report, the Prospective Employer will notify you that the action has been taken and that the action was based in part or in whole on this report.

When the application for employment is submitted by mail, telephone, computer, or other similar means, if the Prospective Employer uses any information it obtains from FMCSA in a decision to not hire you or to make any other adverse employment decision regarding you, the Prospective Employer must provide you within three business days of taking adverse action oral, written or electronic notification: that adverse action has been taken based in whole or in part on information obtained from FMCSA; the name, address, and the toll free telephone number of FMCSA; that the FMCSA did not make the decision to take the adverse action and is unable to provide you the specific reasons why the adverse action was taken; and that you may, upon providing proper identification, request a free copy of the report and may dispute with the FMCSA the accuracy or completeness of any information or report. If you request a copy of a driver record from the Prospective Employer who procured the report, then, within 3 business days of receiving your request, together with proper identification, the Prospective Employer must send or provide to you a copy of your report and a summary of your rights under the Fair Credit Reporting Act.

Neither the Prospective Employer nor the FMCSA contractor supplying the crash and safety information has the capability to correct any safety data that appears to be incorrect. You may challenge the accuracy of the data by submitting a request to https://dataqs.fmcsa.dot.gov. If you challenge crash or inspection information reported by a State, FMCSA cannot change or correct this data. Your request will be forwarded by the DataQs system to the appropriate State for adjudication.

Any crash or inspection in which you were involved will display on your PSP report. Since the PSP report does not report, or assign, or imply fault, it will include all Commercial Motor Vehicle (CMV) crashes where you were a driver or co-driver and where those crashes were reported to FMCSA, regardless of fault. Similarly, all inspections, with or without violations, appear on the PSP report. State citations associated with Federal Motor Carrier Safety Regulations (FMCSR) violations that have been adjudicated by a court of law will also appear, and remain, on a PSP report.

The Prospective Employer cannot obtain background reports from FMCSA without your authorization.

AUTHORIZATION

If you agree that the Prospective Employer may obtain such background reports, please read the following and sign below:

I authorize {{companyName}} (“Prospective Employer”) to access the FMCSA Pre-Employment Screening Program (PSP) system to seek information regarding my commercial driving safety record and information regarding my safety inspection history. I understand that I am authorizing the release of safety performance information including crash data from the previous five (5) years and inspection history from the previous three (3) years. I understand and acknowledge that this release of information may assist the Prospective Employer to make a determination regarding my suitability as an employee.

I further understand that neither the Prospective Employer nor the FMCSA contractor supplying the crash and safety information has the capability to correct any safety data that appears to be incorrect. I understand I may challenge the accuracy of the data by submitting a request to https://dataqs.fmcsa.dot.gov. If I challenge crash or inspection information reported by a State, FMCSA cannot change or correct this data. I understand my request will be forwarded by the DataQs system to the appropriate State for adjudication.

I understand that any crash or inspection in which I was involved will display on my PSP report. Since the PSP report does not report, or assign, or imply fault, I acknowledge it will include all CMV crashes where I was a driver or co-driver and where those crashes were reported to FMCSA, regardless of fault. Similarly, I understand all inspections, with or without violations, will appear on my PSP report, and State citations associated with FMCSR violations that have been adjudicated by a court of law will also appear, and remain, on my PSP report.

I have read the above Disclosure Regarding Background Reports provided to me by Prospective Employer and I understand that if I sign this Disclosure and Authorization, Prospective Employer may obtain a report of my crash and inspection history. I hereby authorize Prospective Employer and its employees, authorized agents, and/or affiliates to obtain the information authorized above.`;

const V2_CLEARINGHOUSE_CONSENT = `GENERAL CONSENT FOR LIMITED QUERIES OF THE FMCSA DRUG AND ALCOHOL CLEARINGHOUSE

I hereby provide consent to {{companyName}} to conduct limited queries of the FMCSA Commercial Driver's License Drug and Alcohol Clearinghouse (Clearinghouse) to determine whether drug or alcohol violation information about me exists in the Clearinghouse. This consent covers multiple limited queries for the duration of my employment with {{companyName}}.

I understand that if a limited query conducted by {{companyName}} indicates that drug or alcohol violation information about me exists in the Clearinghouse, FMCSA will not disclose that information to {{companyName}} without first obtaining additional specific consent from me.

I further understand that if I refuse to provide consent for {{companyName}} to conduct a limited query of the Clearinghouse, {{companyName}} must prohibit me from performing safety-sensitive functions, including driving a commercial motor vehicle, as required by FMCSA's drug and alcohol program regulations.`;

/**
 * What a v2 page presents beside the document, never inside it: a separate
 * document the law requires, or where the next consent is given. Frozen into
 * the snapshot with the text, so the PDF shows what was provided.
 */
const CFPB_SUMMARY_OF_RIGHTS = Object.freeze({
    label: 'A Summary of Your Rights Under the Fair Credit Reporting Act',
    url: 'https://files.consumerfinance.gov/f/documents/bcfp_consumer-rights-summary_2018-09.pdf',
    note: 'Provided with this disclosure. Please read it before you agree.',
});
const CLEARINGHOUSE_FULL_QUERY = Object.freeze({
    label: 'FMCSA Drug and Alcohol Clearinghouse',
    url: 'https://clearinghouse.fmcsa.dot.gov',
    note: 'Before you can drive for {{companyName}}, it must also run a full query of the Clearinghouse. You give that consent yourself, in the Clearinghouse, when {{companyName}} requests it.',
});

/**
 * Every agreement, keyed by stable id. `order` fixes presentation sequence so
 * the driver, the on-screen review and the PDF cannot disagree about it.
 *
 * `required: true` means the agreement may not be dropped from the set — the
 * FMCSA Clearinghouse consent in particular is mandatory under 49 CFR Part 382
 * subpart G and must always be presented.
 */
const AGREEMENTS = Object.freeze({
    /**
     * Presented on the Motor Vehicle Record step, not the consent step: the
     * applicant reads it where the Yes/No authorization question is asked, so
     * there is ONE MVR authorization in the whole application — this wording,
     * this version, this acceptance — instead of a consent radio on one page and
     * unrelated "MVR consent" concepts on others. `requiresSignature: false`
     * because the answer to the question is the authorization; the applicant's
     * signature at the end certifies the application as a whole.
     *
     * No `legacy-1`: before 2026-09-02 the step asked a bare Yes/No with two
     * sentences of prose and recorded no agreement, so no historical record can
     * be attributed to this wording.
     */
    mvrAuthorization: {
        id: 'mvrAuthorization',
        order: 0,
        required: true,
        requiresSignature: false,
        presentedOn: 'drivingRecord',
        title: 'MOTOR VEHICLE RECORD (MVR) AUTHORIZATION',
        versions: {
            v1: { body: V1_MVR_AUTHORIZATION },
            v2: { body: V1_MVR_AUTHORIZATION },
        },
    },
    electronicSignature: {
        id: 'electronicSignature',
        presentedOn: 'consent',
        order: 1,
        required: true,
        requiresSignature: true,
        title: 'AGREEMENT TO CONDUCT TRANSACTION ELECTRONICALLY',
        versions: {
            'legacy-1': { body: LEGACY_ELECTRONIC_SIG, legacy: true },
            v1: { body: V1_ELECTRONIC_SIG },
            v2: { body: V1_ELECTRONIC_SIG },
        },
    },
    fcraDisclosure: {
        id: 'fcraDisclosure',
        presentedOn: 'consent',
        order: 2,
        required: true,
        requiresSignature: true,
        title: 'BACKGROUND CHECK DISCLOSURE AND AUTHORIZATION',
        versions: {
            'legacy-1': { body: LEGACY_FCRA_DISCLOSURE, legacy: true },
            v1: { body: V1_FCRA_DISCLOSURE },
            v2: { body: V2_FCRA_DISCLOSURE, links: [CFPB_SUMMARY_OF_RIGHTS] },
        },
    },
    pspDisclosure: {
        id: 'pspDisclosure',
        presentedOn: 'consent',
        order: 3,
        required: true,
        requiresSignature: true,
        title: 'FMCSA PSP DISCLOSURE AND AUTHORIZATION',
        versions: {
            'legacy-1': { body: LEGACY_PSP_DISCLOSURE, legacy: true },
            v1: { body: V1_PSP_DISCLOSURE },
            v2: { body: V2_PSP_DISCLOSURE },
        },
    },
    clearinghouseConsent: {
        id: 'clearinghouseConsent',
        presentedOn: 'consent',
        order: 4,
        required: true,
        requiresSignature: true,
        // Not "full query": v2 is a limited-query consent, and a full-query
        // consent is given only in the Clearinghouse. v1 records keep the title
        // frozen in their own snapshots.
        title: 'FMCSA DRUG AND ALCOHOL CLEARINGHOUSE CONSENT',
        // DELIBERATELY NO `legacy-1`. The pre-modernization consent screen
        // presented exactly three agreements — electronic signature, FCRA and
        // PSP. It never asked for Clearinghouse consent, even though the old
        // browser PDF printed a Clearinghouse page and stamped the same
        // signature onto it. That page was an assertion the driver never made.
        //
        // Giving this agreement a `legacy-1` body would let a reconstruction
        // resurrect exactly that false claim. Its absence here is what makes a
        // historical record say, truthfully, that consent was never obtained.
        versions: {
            v1: { body: V1_CLEARINGHOUSE_CONSENT },
            v2: { body: V2_CLEARINGHOUSE_CONSENT, links: [CLEARINGHOUSE_FULL_QUERY] },
        },
    },
});

/** Version every NEW submission presents. Historical records keep their own. */
const CURRENT_AGREEMENT_VERSION = 'v2';

/**
 * Versions a NEW submission may legitimately claim to have displayed.
 *
 * Derived from the registry rather than hardcoded, and deliberately excludes
 * every `legacy: true` version: those are the frozen record of wording that is
 * no longer shown to anyone, so a fresh submission claiming one would be
 * attributing a signature to retired text.
 */
function submittableVersions() {
    const versions = new Set();
    for (const agreement of Object.values(AGREEMENTS)) {
        for (const [version, entry] of Object.entries(agreement.versions)) {
            if (!entry.legacy) versions.add(version);
        }
    }
    return versions;
}

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
        // Which page of the application shows it: `consent` (the final
        // agreements step) or `drivingRecord` (the MVR step).
        presentedOn: agreement.presentedOn || 'consent',
        legacy: Boolean(entry.legacy),
        links: renderAgreementLinks(entry.links, { companyName }),
    };
}

/**
 * A version's companion links, presented beside the document and never inside
 * it, with the carrier named in their notes.
 */
function renderAgreementLinks(links, { companyName } = {}) {
    return (Array.isArray(links) ? links : []).map((link) => ({
        label: link.label,
        url: link.url,
        note: link.note ? renderAgreementBody(link.note, { companyName }) : null,
    }));
}

/**
 * The full ordered agreement set to present for a submission.
 *
 * @param {object} opts
 * @param {string} opts.companyName Carrier name substituted into the text.
 * @param {string} [opts.version]   Defaults to CURRENT_AGREEMENT_VERSION.
 */
function resolveAgreementSet({ companyName, version = CURRENT_AGREEMENT_VERSION } = {}) {
    // Only agreements that EXIST at this version. An agreement introduced after
    // a historical submission was made was not part of that submission's set,
    // and including it would invite a record that claims consent for wording
    // nobody was ever shown.
    return requiredAgreementIds()
        .filter((id) => Boolean(AGREEMENTS[id].versions[version]))
        .map((id) => resolveAgreement(id, version, { companyName }));
}

module.exports = {
    AGREEMENTS,
    CURRENT_AGREEMENT_VERSION,
    legacySubstitution,
    renderAgreementBody,
    renderAgreementLinks,
    requiredAgreementIds,
    submittableVersions,
    resolveAgreement,
    resolveAgreementSet,
};
