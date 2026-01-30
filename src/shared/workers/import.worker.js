import ExcelJS from 'exceljs';
import { formatPhoneNumber, normalizePhone } from '@/shared/utils/helpers';

// Helper to find key in row object
const findKey = (row, keywords) => {
    const rowKeys = Object.keys(row);
    return rowKeys.find(k => keywords.some(keyword => k.toLowerCase().includes(keyword)));
};

self.onmessage = async (e) => {
    const { buffer } = e.data;

    try {
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

        const jsonData = [];
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

        if (jsonData.length === 0) {
            self.postMessage({ success: false, error: "File appears empty." });
            return;
        }

        const parsedRows = jsonData.map((row, index) => {
            const firstKey = findKey(row, ['firstname', 'first name', 'fname', 'first', 'given']);
            const lastKey = findKey(row, ['lastname', 'last name', 'lname', 'last', 'surname']);
            const fullNameKey = findKey(row, ['fullname', 'full name', 'name', 'driver name', 'driver']);

            const emailKey = findKey(row, ['email', 'e-mail', 'mail']);
            const phoneKey = findKey(row, ['phone', 'mobile', 'cell', 'contact']);
            const typeKey = findKey(row, ['type', 'role', 'position', 'driver type']);
            const expKey = findKey(row, ['experience', 'exp', 'years']);
            const cityKey = findKey(row, ['city', 'location']);
            const stateKey = findKey(row, ['state', 'province']);

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
                                lName = 'Driver';
                            }
                        }
                    }
                }
            }

            if (!fName) fName = 'Unknown';
            if (!lName) lName = 'Driver';

            const rawPhone = phoneKey ? safeVal(row[phoneKey]) : '';
            const formattedPhone = formatPhoneNumber(rawPhone);
            const normPhone = normalizePhone(rawPhone);

            let typeVal = typeKey ? safeVal(row[typeKey]) : '';
            if (!typeVal || typeVal.toLowerCase() === 'undefined') typeVal = 'unidentified';

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
                record.email = `placeholder_${safeHash}@system.local`;
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
