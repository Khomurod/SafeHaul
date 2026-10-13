import ExcelJS from 'exceljs';
import Papa from 'papaparse';
import { formatPhoneNumber, normalizePhone } from '@/shared/utils/helpers';
import { PLACEHOLDER_DOMAIN } from '@/config/placeholderDomains';
import { LEAD_IMPORT_PLACEHOLDERS } from '@/config/leadImportPlaceholders';

// A column belongs to a field when its whole header, lowercased and without
// spaces or punctuation, is one of the field's names: "CDL Expiration" is not
// the experience, "Mailing Address" not the email, "License Type" not the
// driver type. The import template's headers are among the names.
const HEADER_NAMES = {
    firstName: ['firstname', 'first', 'fname', 'givenname', 'given'],
    lastName: ['lastname', 'last', 'lname', 'surname', 'familyname'],
    fullName: ['fullname', 'name', 'drivername', 'driver'],
    email: ['email', 'emailaddress', 'mail', 'contactemail', 'driveremail', 'primaryemail', 'email1'],
    phone: ['phone', 'phonenumber', 'phoneno', 'mobile', 'mobilephone', 'mobilenumber', 'cell', 'cellphone',
        'cellnumber', 'telephone', 'tel', 'contact', 'contactnumber', 'contactphone', 'homephone', 'primaryphone',
        'driverphone', 'phone1'],
    driverType: ['type', 'drivertype', 'jobtype', 'role', 'position'],
    experience: ['experience', 'exp', 'years', 'yearsofexperience', 'yearsexperience', 'experienceyears', 'yrsexp',
        'yearsexp', 'cdlexperience', 'drivingexperience', 'yearsofdrivingexperience'],
    city: ['city', 'location'],
    state: ['state', 'province', 'stateprovince'],
};
const headerName = (header) => String(header).toLowerCase().replace(/[^a-z0-9]/g, '');
const findKey = (row, field) => Object.keys(row).find((k) => HEADER_NAMES[field].includes(headerName(k)));

self.onmessage = async (e) => {
    const { buffer, fileType, fileName } = e.data;
    let jsonData = [];

    try {
        const isCsv = fileType?.includes('csv') || fileName?.toLowerCase().endsWith('.csv');

        if (isCsv) {
            // CSV Parsing
            const decoder = new TextDecoder('utf-8');
            const csvText = decoder.decode(buffer);

            const result = Papa.parse(csvText, {
                header: true,
                skipEmptyLines: true
            });

            if (result.errors.length > 0 && result.data.length === 0) {
                throw new Error("CSV Parse Error: " + result.errors[0].message);
            }
            jsonData = result.data;

        } else {
            // Excel Parsing
            const workbook = new ExcelJS.Workbook();
            await workbook.xlsx.load(buffer);

            const worksheet = workbook.worksheets[0];
            if (!worksheet || worksheet.rowCount === 0) {
                self.postMessage({ success: false, error: "File appears empty." });
                return;
            }

            const headerRow = worksheet.getRow(1);
            const headers = [];
            headerRow.eachCell((cell, colNumber) => {
                headers[colNumber] = cell.value ? String(cell.value).trim() : '';
            });

            worksheet.eachRow((row, rowNumber) => {
                if (rowNumber === 1) return;
                const rowData = {};
                row.eachCell((cell, colNumber) => {
                    const header = headers[colNumber];
                    if (header) {
                        rowData[header] = cell.value !== null && cell.value !== undefined ? String(cell.value).trim() : '';
                    }
                });
                if (Object.keys(rowData).length > 0) {
                    jsonData.push(rowData);
                }
            });
        }

        if (jsonData.length === 0) {
            self.postMessage({ success: false, error: "File appears empty." });
            return;
        }

        const MAX_ROWS = 5000;
        if (jsonData.length > MAX_ROWS) {
            self.postMessage({ success: false, error: `File has ${jsonData.length.toLocaleString()} rows, which exceeds the ${MAX_ROWS.toLocaleString()}-row limit. Please split the file into smaller batches.` });
            return;
        }

        const parsedRows = jsonData.map((row, index) => {
            const firstKey = findKey(row, 'firstName');
            const lastKey = findKey(row, 'lastName');
            const fullNameKey = findKey(row, 'fullName');

            const emailKey = findKey(row, 'email');
            const phoneKey = findKey(row, 'phone');
            const typeKey = findKey(row, 'driverType');
            const expKey = findKey(row, 'experience');
            const cityKey = findKey(row, 'city');
            const stateKey = findKey(row, 'state');

            const safeVal = (val) => (val === undefined || val === null) ? '' : String(val).trim();

            let fName = firstKey ? safeVal(row[firstKey]) : '';
            let lName = lastKey ? safeVal(row[lastKey]) : '';

            if ((!fName || !lName) && fullNameKey) {
                const fullName = safeVal(row[fullNameKey]);
                if (fullName) {
                    if (fullName.includes(',')) {
                        const parts = fullName.split(',').map(p => p.trim());
                        lName = parts[0];
                        if (parts.length > 1) {
                            fName = parts[1];
                        }
                    } else {
                        const parts = fullName.split(' ').filter(p => p !== '');
                        if (parts.length > 0) {
                            fName = parts[0];
                            if (parts.length > 1) {
                                lName = parts.slice(1).join(' ');
                            } else {
                                lName = LEAD_IMPORT_PLACEHOLDERS.lastName;
                            }
                        }
                    }
                }
            }

            if (!fName) fName = LEAD_IMPORT_PLACEHOLDERS.firstName;
            if (!lName) lName = LEAD_IMPORT_PLACEHOLDERS.lastName;

            const rawPhone = phoneKey ? safeVal(row[phoneKey]) : '';
            const formattedPhone = rawPhone ? formatPhoneNumber(rawPhone) : '';
            const normPhone = normalizePhone(rawPhone);

            let typeVal = typeKey ? safeVal(row[typeKey]) : '';
            if (!typeVal || typeVal.toLowerCase() === 'undefined') typeVal = LEAD_IMPORT_PLACEHOLDERS.driverType;

            const record = {
                firstName: fName,
                lastName: lName,
                email: emailKey ? safeVal(row[emailKey]) : '',
                phone: formattedPhone,
                normalizedPhone: normPhone,
                driverType: typeVal,
                experience: expKey ? safeVal(row[expKey]) : '',
                city: cityKey ? safeVal(row[cityKey]) : '',
                state: stateKey ? safeVal(row[stateKey]) : '',
                isEmailPlaceholder: false
            };

            // deterministic placeholder generation
            if (!record.email) {
                // Combine available distinct data
                const seed = `${normPhone || 'nophone'}_${fName}_${lName}`;
                // Simple hash to safe string
                const safeHash = btoa(unescape(encodeURIComponent(seed))).replace(/[^a-zA-Z0-9]/g, '').substring(0, 20);
                record.email = `placeholder_${safeHash}@${PLACEHOLDER_DOMAIN}`;
                record.isEmailPlaceholder = true;
            }

            if (record.email || record.phone) return record;
            return null;
        }).filter(r => r !== null);

        const uniqueRows = [];
        const seenEmails = new Set();
        const seenPhones = new Set();
        const duplicates = [];

        parsedRows.forEach(row => {
            const hasEmail = !row.isEmailPlaceholder && seenEmails.has(row.email.toLowerCase());
            const hasPhone = row.normalizedPhone && seenPhones.has(row.normalizedPhone);

            // Note: We deliberately do NOT dedup placeholders based on the generated email here, 
            // because they might be distinct people who just lack contact info.
            // BUT, if we re-import the same file, we do want to catch them.
            // The generated hash is stable, so they will be caught if we check 'seenEmails' even for placeholders.
            // Let's refine:
            const emailToCheck = row.email.toLowerCase();
            const isDuplicatePlaceholder = row.isEmailPlaceholder && seenEmails.has(emailToCheck);

            if (!hasEmail && !hasPhone && !isDuplicatePlaceholder) {
                seenEmails.add(emailToCheck);
                if (row.normalizedPhone) seenPhones.add(row.normalizedPhone);
                uniqueRows.push(row);
            } else {
                duplicates.push(row);
            }
        });

        self.postMessage({ success: true, data: uniqueRows, debugCount: parsedRows.length });

    } catch (error) {
        self.postMessage({ success: false, error: error.message });
    }
};
