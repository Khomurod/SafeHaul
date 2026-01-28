import { useState } from 'react';
import ExcelJS from 'exceljs';
import { formatPhoneNumber, normalizePhone } from '@shared/utils/helpers';

export function useBulkImport() {
  const [csvData, setCsvData] = useState([]);
  const [processingSheet, setProcessingSheet] = useState(false);
  const [step, setStep] = useState('upload');
  const [importMethod, setImportMethod] = useState('file');
  const [sheetUrl, setSheetUrl] = useState('');

  const parseBuffer = async (buffer) => {
    try {
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(buffer);
        
        const worksheet = workbook.worksheets[0];
        if (!worksheet || worksheet.rowCount === 0) {
            alert("File appears empty.");
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
            alert("File appears empty.");
            return;
        }

        const findKey = (row, keywords) => {
            const rowKeys = Object.keys(row);
            return rowKeys.find(k => keywords.some(keyword => k.toLowerCase().includes(keyword)));
        };

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

            if (!record.email) {
                record.email = `no_email_${Date.now()}_${index}@placeholder.com`;
                record.isEmailPlaceholder = true;
            }

            if (record.email || record.phone) return record;
            return null;
        }).filter(r => r !== null);

        const uniqueRows = [];
        const seenEmails = new Set();
        const seenPhones = new Set();

        parsedRows.forEach(row => {
            const hasEmail = !row.isEmailPlaceholder && seenEmails.has(row.email.toLowerCase());
            const hasPhone = row.normalizedPhone && seenPhones.has(row.normalizedPhone);
            
            if (!hasEmail && !hasPhone) {
                if (!row.isEmailPlaceholder) seenEmails.add(row.email.toLowerCase());
                if (row.normalizedPhone) seenPhones.add(row.normalizedPhone);
                uniqueRows.push(row);
            }
        });

        setCsvData(uniqueRows);
        setStep('preview');

    } catch (error) {
        console.error("Parse Error:", error);
        alert("Error reading file: " + error.message);
    }
  };

  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setCsvData([]);
    const reader = new FileReader();
    reader.onload = async (event) => await parseBuffer(event.target.result);
    reader.readAsArrayBuffer(file);
    e.target.value = ''; 
  };

  const handleSheetImport = async () => {
    if (!sheetUrl) return alert("Please enter a Google Sheet URL.");
    const matches = sheetUrl.match(/\/d\/([a-zA-Z0-9-_]+)/);
    if (!matches || !matches[1]) return alert("Invalid Google Sheet URL.");
    
    const sheetId = matches[1];
    const exportUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=xlsx`;

    setProcessingSheet(true);
    try {
        const response = await fetch(exportUrl);
        if (!response.ok) throw new Error("Failed to fetch sheet. Check permissions (Anyone with link).");
        const arrayBuffer = await response.arrayBuffer();
        await parseBuffer(arrayBuffer);
    } catch (error) {
        console.error("Sheet Error:", error);
        alert("Error importing sheet: " + error.message);
    } finally {
        setProcessingSheet(false);
    }
  };

  const reset = () => {
      setCsvData([]);
      setStep('upload');
      setSheetUrl('');
  };

  return {
      csvData,
      step, setStep,
      importMethod, setImportMethod,
      sheetUrl, setSheetUrl,
      processingSheet,
      handleFileChange,
      handleSheetImport,
      reset
  };
}
