// src/shared/utils/pdfGenerator.js
import { jsPDF } from "jspdf";
import { getFieldValue } from '@shared/utils/helpers';
import { PDF_CONFIG } from '@shared/utils/pdf/pdfConfig';
import { addTableHeader, addTableRow, addFullWidthText, checkPageBreak } from '@shared/utils/pdf/pdfHelpers';
import {
    addPageHeader,
    addAgreementHeader,
    addSignatureBlock,
    addHosTable,
    addEmploymentSection,
    addDrivingHistorySection,
    addCustomQuestionsSection,
    addAddressHistorySection
} from '@shared/utils/pdf/pdfSections';

// --- FULL LEGAL TEXT CONSTANTS ---

const TEXT_ELECTRONIC_SIG = `AGREEMENT TO CONDUCT TRANSACTION ELECTRONICALLY

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

const TEXT_FCRA_DISCLOSURE = `BACKGROUND CHECK DISCLOSURE AND AUTHORIZATION (FCRA)

In connection with your application for employment with Company ("Prospective Employer"), Prospective Employer, its employees, agents or contractors may obtain one or more reports regarding your credit, driving, and/or criminal background history from a consumer reporting agency.
These reports may include information regarding your character, general reputation, personal characteristics, mode of living, driving history, criminal history, and employment history.

AUTHORIZATION
I hereby authorize Prospective Employer to obtain the consumer reports described above about me.
I authorize, without reservation, any party or agency contacted by Prospective Employer to furnish the above-mentioned information.
I understand that I have the right to make a written request within a reasonable period of time to receive additional detailed information about the nature and scope of any investigation.
I acknowledge that I have received a copy of the summary of rights under the Fair Credit Reporting Act (FCRA).`;

const TEXT_PSP_DISCLOSURE = `IMPORTANT DISCLOSURE REGARDING BACKGROUND REPORTS FROM THE PSP Online Service

In connection with your application for employment with Company ("Prospective Employer"), Prospective Employer, its employees, agents or contractors may obtain one or more reports regarding your driving, and safety inspection history from the Federal Motor Carrier Safety Administration (FMCSA).
When the application for employment is submitted in connection with a driver position, Prospective Employer cannot obtain background reports from FMCSA unless you consent in writing.

AUTHORIZATION
I hereby authorize Prospective Employer to access the FMCSA Pre-Employment Screening Program (PSP) system to seek information regarding my commercial driving safety record and information regarding my safety inspection history.
I understand that I am authorizing the release of safety performance information including crash data from the previous five (5) years and inspection history from the previous three (3) years.
I understand that I have the right to review the information provided by the PSP system and to contest the accuracy of that information by submitting a request to the FMCSA DataQs system.`;

const TEXT_CLEARINGHOUSE_CONSENT = `GENERAL CONSENT FOR FULL QUERY OF THE FMCSA DRUG AND ALCOHOL CLEARINGHOUSE

I hereby provide consent to Company ("Prospective Employer") to conduct a full query of the FMCSA Commercial Driver's License Drug and Alcohol Clearinghouse (Clearinghouse) to determine whether drug or alcohol violation information about me exists in the Clearinghouse, and to release that information to Prospective Employer.
I understand that if the full query conducted by Prospective Employer indicates that drug or alcohol violation information about me exists in the Clearinghouse, FMCSA will disclose that information to Prospective Employer.
I further understand that if I refuse to provide consent for Prospective Employer to conduct a full query of the Clearinghouse, Prospective Employer must prohibit me from performing safety-sensitive functions, including driving a commercial motor vehicle, as required by FMCSA's drug and alcohol program regulations.`;

export function generateApplicationPDF(pdfData) {
    if (!pdfData) {
        console.error("Generate PDF: Missing data");
        return;
    }

    // Robust Destructuring with Defaults
    const { applicant = {}, agreements = [], company = {} } = pdfData;

    const companyProfile = company || {
        companyName: "[COMPANY NAME NOT FOUND]",
        address: {},
        contact: {}
    };

    const companyName = companyProfile?.companyName || "[COMPANY NAME]";
    const applicantName = `${getFieldValue(applicant?.['firstName'])} ${getFieldValue(applicant?.['lastName'])}`;

    const doc = new jsPDF('p', 'mm', 'a4');
    let y = PDF_CONFIG.MARGIN;

    // --- 1. Header (DOT Compliant) ---
    y = addPageHeader(doc, companyProfile);

    // --- 2. Personal Information ---
    y = addTableHeader(doc, y, "Personal Information");
    y = addTableRow(doc, y, "First Name:", applicant?.['firstName']);
    y = addTableRow(doc, y, "Middle Name:", applicant?.['middleName']);
    y = addTableRow(doc, y, "Last Name:", applicant?.['lastName']);
    y = addTableRow(doc, y, "Suffix:", applicant?.['suffix']);
    y = addTableRow(doc, y, "Known by Other Name:", applicant?.['known-by-other-name']);
    if (applicant?.['known-by-other-name'] === 'yes') {
        y = addTableRow(doc, y, "Other Name(s):", applicant?.otherName);
    }
    // DOT Requirement: Full SSN must be visible
    y = addTableRow(doc, y, "Social Security Number:", applicant?.ssn ? applicant.ssn : "Not Provided");
    y = addTableRow(doc, y, "Date of Birth:", applicant?.dob);

    // --- 3. Address History ---
    y = addAddressHistorySection(doc, y, applicant);

    // --- 4. General Qualifications ---
    y = addTableHeader(doc, y, "General Qualifications");
    y = addTableRow(doc, y, "Position Applied For:", applicant?.positionApplyingTo);
    y = addTableRow(doc, y, "Legal to Work in U.S.:", applicant?.['legal-work']);
    y = addTableRow(doc, y, "English Fluency:", applicant?.['english-fluency']);
    y = addTableRow(doc, y, "Years of CDL Experience:", applicant?.['experience-years'] || applicant?.experience);
    y = addTableRow(doc, y, "Drug Test History:", applicant?.['drug-test-positive']);
    if (applicant?.['drug-test-positive'] === 'yes') {
        y = addTableRow(doc, y, "Drug Test Explanation:", applicant?.['drug-test-explanation']);
    }
    y = addTableRow(doc, y, "DOT Return to Duty:", applicant?.['dot-return-to-duty']);

    // --- 5. License & Credentials ---
    y = addTableHeader(doc, y, "License & Credentials");
    y = addTableRow(doc, y, "License Number:", applicant?.cdlNumber);
    y = addTableRow(doc, y, "License State:", applicant?.cdlState);
    y = addTableRow(doc, y, "License Class:", applicant?.cdlClass);
    y = addTableRow(doc, y, "Expiration Date:", applicant?.cdlExpiration);
    y = addTableRow(doc, y, "Endorsements:", applicant?.endorsements || 'None');

    y = addTableRow(doc, y, "Has TWIC Card:", applicant?.['has-twic']);
    if (applicant?.['has-twic'] === 'yes') {
        y = addTableRow(doc, y, "TWIC Expiration:", applicant?.twicExpiration);
    }

    // --- 6. Driving Record (Violations & Accidents) ---
    // Safe access to arrays
    y = addDrivingHistorySection(doc, y, applicant?.violations || [], applicant?.accidents || []);

    // --- 7. Employment History ---
    y = addEmploymentSection(doc, y, applicant?.employers || []);

    // --- 8. Education & Military ---
    y = addTableHeader(doc, y, "Education & Military");

    // Schools
    if (applicant?.schools && applicant.schools.length > 0) {
        applicant.schools.forEach((s, i) => {
            y = addTableRow(doc, y, `School #${i + 1}`, `${s.name || 'N/A'} (${s.location || 'N/A'}) - ${s.dates || 'N/A'}`);
        });
    } else {
        y = addTableRow(doc, y, "Education", "No driving schools listed.");
    }

    // Military
    if (applicant?.military && applicant.military.length > 0) {
        applicant.military.forEach((m, i) => {
            y = addTableRow(doc, y, `Military #${i + 1}`, `${m.branch} (${m.rank}) | ${m.start} - ${m.end} | Hon: ${m.honorable}`);
        });
    } else {
        y = addTableRow(doc, y, "Military", "No military service listed.");
    }

    // --- 9. Custom Questions ---
    y = addCustomQuestionsSection(doc, y, applicant?.customAnswers || {});

    // --- 10. HOS & Misc ---
    y = addTableHeader(doc, y, "Hours of Service & Misc");
    if (applicant?.driverInitials) y = addTableRow(doc, y, "Driver Initials:", applicant.driverInitials);
    if (applicant?.ein) y = addTableRow(doc, y, "EIN / Business:", `${applicant.ein} / ${applicant.businessName}`);

    const ec1 = applicant?.ec1Name ? `${applicant.ec1Name} (${applicant.ec1Relationship}) - ${applicant.ec1Phone}` : 'N/A';
    y = addTableRow(doc, y, "Contact #1:", ec1);

    if (applicant?.ec2Name) {
        y = addTableRow(doc, y, "Contact #2:", `${applicant.ec2Name} (${applicant.ec2Relationship}) - ${applicant.ec2Phone}`);
    }

    y = addTableRow(doc, y, "Felony Conviction:", applicant?.['has-felony']);
    if (applicant?.['has-felony'] === 'yes') {
        y = addTableRow(doc, y, "Felony Explanation:", applicant?.felonyExplanation);
    }

    // HOS Table
    y = checkPageBreak(doc, y, 30);
    y += PDF_CONFIG.SECTION_GAP;
    doc.setFont(PDF_CONFIG.FONT.BOLD, "bold");
    doc.setFontSize(10);
    doc.text("Total hours worked during the immediately preceding 7 days:", PDF_CONFIG.MARGIN, y);
    y += PDF_CONFIG.LINE_HEIGHT;
    y = addHosTable(doc, y, applicant);

    // --- 11. Agreements & Signature (FULL TEXT) ---

    const replaceCompany = (text) => text.replaceAll('Company', companyName).replaceAll('Prospective Employer', companyName);

    const standardAgreements = [
        {
            title: "AGREEMENT TO CONDUCT TRANSACTION ELECTRONICALLY",
            text: replaceCompany(TEXT_ELECTRONIC_SIG)
        },
        {
            title: "BACKGROUND CHECK DISCLOSURE AND AUTHORIZATION",
            text: replaceCompany(TEXT_FCRA_DISCLOSURE)
        },
        {
            title: "FMCSA PSP DISCLOSURE AND AUTHORIZATION",
            text: replaceCompany(TEXT_PSP_DISCLOSURE)
        },
        {
            title: "FMCSA CLEARINGHOUSE FULL QUERY CONSENT",
            text: replaceCompany(TEXT_CLEARINGHOUSE_CONSENT)
        }
    ];

    standardAgreements.forEach(agreement => {
        doc.addPage();
        y = PDF_CONFIG.MARGIN;
        y = addAgreementHeader(doc, y, agreement.title, companyName);
        y = addFullWidthText(doc, y, agreement.text);

        y = addSignatureBlock(doc, y, applicant);
    });

    // --- Footer ---
    const pageCount = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFont(PDF_CONFIG.FONT.NORMAL, "normal");
        doc.setFontSize(9);
        doc.setTextColor(100, 100, 100);
        doc.text(applicantName, PDF_CONFIG.MARGIN, PDF_CONFIG.PAGE_HEIGHT - 10);
        doc.text(`Page ${i} of ${pageCount}`, PDF_CONFIG.PAGE_WIDTH - PDF_CONFIG.MARGIN, PDF_CONFIG.PAGE_HEIGHT - 10, { align: 'right' });
    }

    doc.save(`Application-${getFieldValue(applicant?.['lastName'])}-${getFieldValue(applicant?.['firstName'])}.pdf`);
}