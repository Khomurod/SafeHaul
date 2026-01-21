// src/shared/utils/pdf/pdfSections.js
import { PDF_CONFIG } from './pdfConfig';
import { checkPageBreak, addTableHeader, addTableRow } from './pdfHelpers';
import { getFieldValue } from '../helpers';

export function addPageHeader(doc, companyData) {
    let y = PDF_CONFIG.MARGIN;
    const name = getFieldValue(companyData?.companyName);
    const street = getFieldValue(companyData?.address?.street);
    const cityStateZip = `${getFieldValue(companyData?.address?.city)}, ${getFieldValue(companyData?.address?.state)} ${getFieldValue(companyData?.address?.zip)}`;
    const phone = getFieldValue(companyData?.contact?.phone);

    // Official DOT-style Header
    doc.setFont(PDF_CONFIG.FONT.BOLD, "bold");
    doc.setFontSize(16);
    doc.text("DRIVER'S APPLICATION FOR EMPLOYMENT", PDF_CONFIG.PAGE_WIDTH / 2, y, { align: 'center' });

    y += PDF_CONFIG.LINE_HEIGHT;
    doc.setFontSize(10);
    doc.setFont(PDF_CONFIG.FONT.NORMAL, "normal");
    doc.text("In compliance with Federal and State Equal Employment Opportunity Laws", PDF_CONFIG.PAGE_WIDTH / 2, y, { align: 'center' });

    y += PDF_CONFIG.LINE_HEIGHT * 1.5;

    // Company Info Block (Left Aligned)
    doc.setFont(PDF_CONFIG.FONT.BOLD, "bold");
    doc.setFontSize(12);
    doc.text(name, PDF_CONFIG.MARGIN, y);

    doc.setFont(PDF_CONFIG.FONT.NORMAL, "normal");
    doc.setFontSize(10);
    y += PDF_CONFIG.LINE_HEIGHT;
    doc.text(street, PDF_CONFIG.MARGIN, y);
    y += PDF_CONFIG.LINE_HEIGHT;
    doc.text(cityStateZip, PDF_CONFIG.MARGIN, y);
    y += PDF_CONFIG.LINE_HEIGHT;
    doc.text(`Phone: ${phone}`, PDF_CONFIG.MARGIN, y);

    // Meta-data (Right Aligned)
    let tempY = PDF_CONFIG.MARGIN + (PDF_CONFIG.LINE_HEIGHT * 2.5);
    const today = new Date();
    const dateStr = today.toLocaleDateString("en-US", { year: 'numeric', month: 'long', day: 'numeric' });

    doc.setFontSize(9);
    doc.text("49 CFR 391.21 Compliant", PDF_CONFIG.PAGE_WIDTH - PDF_CONFIG.MARGIN, tempY, { align: 'right' });
    tempY += PDF_CONFIG.LINE_HEIGHT;
    doc.text(`Generated: ${dateStr}`, PDF_CONFIG.PAGE_WIDTH - PDF_CONFIG.MARGIN, tempY, { align: 'right' });

    y += PDF_CONFIG.LINE_HEIGHT;
    doc.setDrawColor(0);
    doc.setLineWidth(0.5);
    doc.line(PDF_CONFIG.MARGIN, y, PDF_CONFIG.PAGE_WIDTH - PDF_CONFIG.MARGIN, y);

    return y + PDF_CONFIG.SECTION_GAP;
}

export function addEmploymentSection(doc, y, employers) {
    y = addTableHeader(doc, y, "Employment History (Past 3-10 Years)");

    if (!employers || employers.length === 0) {
        y = addTableRow(doc, y, "Status", "No employment history provided.");
        return y;
    }

    employers.forEach((emp, i) => {
        // Add a separator line between employers
        if (i > 0) {
            y += 2;
            y = checkPageBreak(doc, y, PDF_CONFIG.LINE_HEIGHT);
            doc.setDrawColor(200);
            doc.setLineWidth(0.1);
            doc.line(PDF_CONFIG.MARGIN, y, PDF_CONFIG.PAGE_WIDTH - PDF_CONFIG.MARGIN, y);
            y += 4;
        }

        doc.setFont(PDF_CONFIG.FONT.BOLD, "bold");
        y = addTableRow(doc, y, `Employer ${i + 1}:`, getFieldValue(emp.name));
        doc.setFont(PDF_CONFIG.FONT.NORMAL, "normal");

        const formatMonthYear = (dateStr) => {
            if (!dateStr) return 'N/A';
            const date = new Date(dateStr);
            if (isNaN(date.getTime())) return dateStr; // Fallback if it's already a string like "mm/yyyy"
            return `${(date.getMonth() + 1).toString().padStart(2, '0')}/${date.getFullYear()}`;
        };

        y = addTableRow(doc, y, "Dates Employed:", `${formatMonthYear(emp.startDate)} - ${formatMonthYear(emp.endDate)}`);
        y = addTableRow(doc, y, "Position Held:", getFieldValue(emp.position));
        y = addTableRow(doc, y, "Address:", `${getFieldValue(emp.city)}, ${getFieldValue(emp.state)}`);
        y = addTableRow(doc, y, "Reason for Leaving:", getFieldValue(emp.reason));
        if (emp.phone) y = addTableRow(doc, y, "Contact Phone:", getFieldValue(emp.phone));

        // DOT specific question often asked
        y = addTableRow(doc, y, "Subject to FMCSRs?", "Yes");
    });

    return y;
}

export function addDrivingHistorySection(doc, y, violations, accidents) {
    // 1. Violations
    y = addTableHeader(doc, y, "Traffic Convictions / Violations (Past 3 Years)");

    if (!violations || violations.length === 0) {
        y = addTableRow(doc, y, "Record", "No violations listed.");
    } else {
        violations.forEach((v, i) => {
            if (i > 0) y += 1;
            const label = `Violation ${i + 1}`;
            const content = `Date: ${v.date || 'N/A'} | Charge: ${v.charge || 'N/A'} | Location: ${v.location || 'N/A'} | Penalty: ${v.penalty || 'N/A'}`;
            y = addTableRow(doc, y, label, content);
        });
    }

    // 2. Accidents
    y += PDF_CONFIG.SECTION_GAP;
    y = addTableHeader(doc, y, "Accident History (Past 3 Years)");

    if (!accidents || accidents.length === 0) {
        y = addTableRow(doc, y, "Record", "No accidents listed.");
    } else {
        accidents.forEach((a, i) => {
            if (i > 0) y += 1;
            const label = `Accident ${i + 1}`;
            let content = `Date: ${a.date || 'N/A'} | Loc: ${a.city}, ${a.state}`;
            content += `\nCMV: ${a.commercial === 'yes' ? 'Yes' : 'No'} | Preventable: ${a.preventable === 'yes' ? 'Yes' : 'No'} | Fatalities: 0 | Injuries: 0`;
            content += `\nDetails: ${a.details || 'N/A'}`;
            y = addTableRow(doc, y, label, content);
        });
    }

    return y;
}

export function addCustomQuestionsSection(doc, y, customAnswers) {
    if (!customAnswers || Object.keys(customAnswers).length === 0) return y;

    y = addTableHeader(doc, y, "Supplemental Questions");

    Object.entries(customAnswers).forEach(([q, a]) => {
        const val = Array.isArray(a) ? a.join(', ') : String(a);
        y = addTableRow(doc, y, q, val);
    });

    return y;
}

export function addAgreementHeader(doc, y, title, companyName = "") {
    y = checkPageBreak(doc, y, PDF_CONFIG.LINE_HEIGHT * 3);
    y += PDF_CONFIG.SECTION_GAP;

    doc.setFont(PDF_CONFIG.FONT.BOLD, "bold");
    doc.setFontSize(14);
    doc.setTextColor(0, 0, 0);

    // Centered Title
    const titleWidth = doc.getTextWidth(title);
    const x = (PDF_CONFIG.PAGE_WIDTH - titleWidth) / 2;
    doc.text(title, x, y);

    y += PDF_CONFIG.LINE_HEIGHT * 1.5;

    if (companyName) {
        doc.setFontSize(10);
        doc.setFont(PDF_CONFIG.FONT.NORMAL, "normal");
        doc.text(`Prepared for: ${companyName}`, PDF_CONFIG.MARGIN, y);
        y += PDF_CONFIG.LINE_HEIGHT;
    }

    // Horizontal Rule
    doc.setLineWidth(0.2);
    doc.line(PDF_CONFIG.MARGIN, y, PDF_CONFIG.PAGE_WIDTH - PDF_CONFIG.MARGIN, y);
    return y + PDF_CONFIG.LINE_HEIGHT;
}

export function addSignatureBlock(doc, y, applicantData) {
    y = checkPageBreak(doc, y, 70);
    y += PDF_CONFIG.SECTION_GAP * 2;

    // Check multiple field names for signature date with fallbacks
    const formatDate = (val) => {
        if (!val) return null;
        if (val.toDate) val = val.toDate();
        if (val.seconds) val = new Date(val.seconds * 1000);
        const d = new Date(val);
        return isNaN(d.getTime()) ? null : d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    };

    const sigDate = formatDate(applicantData['signature-date'])
        || formatDate(applicantData.signatureDate)
        || formatDate(applicantData.signedAt)
        || formatDate(applicantData.submittedAt)
        || formatDate(applicantData.createdAt)
        || 'Not Available';

    const signatureData = applicantData.signature;
    const name = `${getFieldValue(applicantData['firstName'])} ${getFieldValue(applicantData['lastName'])}`;

    // --- 49 CFR 391.21(b)(12) Certification Statement ---
    const certificationText = "This certifies that this application was completed by me, and that all entries on it and information in it are true and complete to the best of my knowledge. I authorize you to make such investigations and inquiries of my personal, employment, financial or medical history and other related matters as may be necessary in arriving at an employment decision.";

    doc.setFont(PDF_CONFIG.FONT.NORMAL, "italic");
    doc.setFontSize(10);
    const splitCert = doc.splitTextToSize(certificationText, PDF_CONFIG.PAGE_WIDTH - (PDF_CONFIG.MARGIN * 2));
    doc.text(splitCert, PDF_CONFIG.MARGIN, y);
    y += (splitCert.length * PDF_CONFIG.LINE_HEIGHT) + PDF_CONFIG.SECTION_GAP;

    // --- Applicant Details ---
    doc.setFont(PDF_CONFIG.FONT.BOLD, "bold");
    doc.setFontSize(11);
    doc.text("APPLICANT SIGNATURE", PDF_CONFIG.MARGIN, y);
    y += PDF_CONFIG.LINE_HEIGHT;

    // Draw Signature Box
    doc.setDrawColor(0);
    doc.setLineWidth(0.5);
    doc.rect(PDF_CONFIG.MARGIN, y, PDF_CONFIG.PAGE_WIDTH - (PDF_CONFIG.MARGIN * 2), 35);

    const contentY = y + 5;

    // 1. Signature
    if (signatureData) {
        if (signatureData.startsWith('TEXT_SIGNATURE:')) {
            const typedName = signatureData.replace('TEXT_SIGNATURE:', '');
            doc.setFont("times", "italic");
            doc.setFontSize(22);
            doc.text(`/s/ ${typedName}`, PDF_CONFIG.MARGIN + 10, contentY + 12);
        } else {
            try {
                // Determine appropriate dimensions to fit in the box (80x25 max)
                // The signature data URL is likely a large canvas image
                doc.addImage(signatureData, 'PNG', PDF_CONFIG.MARGIN + 5, contentY + 2, 70, 20, undefined, 'FAST');
            } catch (e) {
                console.error("Signature Image Error:", e);
                doc.setFont(PDF_CONFIG.FONT.NORMAL, "normal");
                doc.setFontSize(10);
                doc.text("(Electronic Signature Image - Error Rendering)", PDF_CONFIG.MARGIN + 10, contentY + 15);
            }
        }
    } else {
        doc.setFont(PDF_CONFIG.FONT.NORMAL, "normal");
        doc.setFontSize(12);
        doc.setTextColor(150);
        doc.text("[Not Signed]", PDF_CONFIG.MARGIN + 10, contentY + 15);
        doc.setTextColor(0);
    }

    // 2. Date & Name
    doc.setFont(PDF_CONFIG.FONT.NORMAL, "normal");
    doc.setFontSize(10);
    const rightColX = PDF_CONFIG.PAGE_WIDTH / 2 + 10;

    doc.text(`Date Signed: ${sigDate}`, rightColX, contentY + 8);
    doc.text(`Printed Name: ${name}`, rightColX, contentY + 18);

    // 3. SSN (Unmasked for DOT compliance in file)
    if (applicantData.ssn) {
        doc.text(`Social Security No: ${applicantData.ssn}`, rightColX, contentY + 28);
    }

    return y + 45; // Return Y after the box
}

export function addHosTable(doc, y, data) {
    y = checkPageBreak(doc, y, 30);
    const tableX = PDF_CONFIG.MARGIN;
    const rowHeight = 8; // Slightly taller rows
    const colWidth = (PDF_CONFIG.PAGE_WIDTH - (PDF_CONFIG.MARGIN * 2)) / 7;

    // Title
    doc.setFont(PDF_CONFIG.FONT.BOLD, "bold");
    doc.setFontSize(10);
    doc.text("RECORD OF HOURS WORKED (Previous 7 Days)", PDF_CONFIG.MARGIN, y);
    y += 5;

    // Header Row
    doc.setFontSize(9);
    doc.setFillColor(230, 230, 230); // Light gray
    doc.setDrawColor(0);
    doc.setLineWidth(0.1);

    let currentX = tableX;
    for (let i = 1; i <= 7; i++) {
        doc.rect(currentX, y, colWidth, rowHeight, 'FD');
        doc.text(`Day ${i}`, currentX + colWidth / 2, y + 5.5, { align: 'center' });
        currentX += colWidth;
    }
    y += rowHeight;

    // Data Row
    currentX = tableX;
    doc.setFont(PDF_CONFIG.FONT.NORMAL, "normal");
    doc.setFillColor(255, 255, 255); // White

    for (let i = 1; i <= 7; i++) {
        const val = getFieldValue(data['hosDay' + i]);
        // Only show number if present, else empty or 0
        const displayVal = (val === "Not Specified" || val === "") ? "0" : val;

        doc.rect(currentX, y, colWidth, rowHeight, 'S');
        doc.text(String(displayVal), currentX + colWidth / 2, y + 5.5, { align: 'center' });
        currentX += colWidth;
    }

    return y + rowHeight + PDF_CONFIG.SECTION_GAP;
}

export function addAddressHistorySection(doc, y, applicant) {
    y = addTableHeader(doc, y, "Address History");

    // 1. Current Address
    const currentAddr = `${getFieldValue(applicant?.street)}, ${getFieldValue(applicant?.city)}, ${getFieldValue(applicant?.state)} ${getFieldValue(applicant?.zip)}`;
    y = addTableRow(doc, y, "Current Address:", currentAddr);
    y = addTableRow(doc, y, "Lived here 3+ Yrs:", applicant?.['residence-3-years']);

    // 2. Previous Addresses (Array)
    if (applicant?.previousAddresses && Array.isArray(applicant.previousAddresses) && applicant.previousAddresses.length > 0) {
        applicant.previousAddresses.forEach((addr, i) => {
            const addrStr = `${getFieldValue(addr.street)}, ${getFieldValue(addr.city)}, ${getFieldValue(addr.state)} ${getFieldValue(addr.zip)}`;
            const dates = (addr.startDate || addr.endDate) ? ` (${addr.startDate || 'N/A'} - ${addr.endDate || 'Present'})` : '';
            y = addTableRow(doc, y, `Prev Address ${i + 1}:`, addrStr + dates);
        });
    }
    // 3. Fallback for legacy "prevStreet" fields
    else if (applicant?.['residence-3-years'] === 'no' && applicant?.prevStreet) {
        const legacyAddr = `${getFieldValue(applicant.prevStreet)}, ${getFieldValue(applicant.prevCity)}, ${getFieldValue(applicant.prevState)} ${getFieldValue(applicant.prevZip)}`;
        y = addTableRow(doc, y, "Previous Address:", legacyAddr);
    }

    y = addTableRow(doc, y, "Phone:", applicant?.phone);
    y = addTableRow(doc, y, "Email:", applicant?.email);

    return y;
}

export function addVehicleExperienceSection(doc, y, applicant) {
    y = addTableHeader(doc, y, "Nature & Extent of Experience (49 CFR 391.21(b)(6))");

    // Header Row
    const headers = ["Equipment", "Miles Driven", "Experience"];
    const colWidths = [60, 50, 60];
    let currentX = PDF_CONFIG.MARGIN;

    doc.setFont(PDF_CONFIG.FONT.BOLD, "bold");
    doc.setFontSize(9);
    doc.setFillColor(230, 230, 230);
    doc.setDrawColor(180);

    // Draw Header
    headers.forEach((h, i) => {
        doc.rect(currentX, y, colWidths[i], 7, 'FD');
        doc.text(h, currentX + 2, y + 5);
        currentX += colWidths[i];
    });
    y += 7;

    // Data Row Helper
    const addExpRow = (label, milesKey, expKey) => {
        currentX = PDF_CONFIG.MARGIN;
        doc.setFont(PDF_CONFIG.FONT.NORMAL, "normal");
        doc.setFillColor(255);

        const miles = getFieldValue(applicant?.[milesKey]) || "0";
        const exp = getFieldValue(applicant?.[expKey]) || "N/A";

        [label, miles, exp].forEach((val, i) => {
            doc.rect(currentX, y, colWidths[i], 7, 'S');
            doc.text(String(val), currentX + 2, y + 5);
            currentX += colWidths[i];
        });
        y += 7;
    };

    addExpRow("Straight Truck", "expStraightTruckMiles", "expStraightTruckExp");
    addExpRow("Tractor + Semi Trailer", "expSemiTrailerMiles", "expSemiTrailerExp");
    addExpRow("Tractor + Two Trailers", "expTwoTrailersMiles", "expTwoTrailersExp");

    return y + PDF_CONFIG.SECTION_GAP;
}