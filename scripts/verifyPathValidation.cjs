const assert = require('assert');

function validatePath(companyId, srcPath) {
    // Logic mirrored from functions/digitalSealing.js
    if (srcPath.startsWith('gs://')) {
        srcPath = srcPath.replace(`gs://bucket-name/`, '');
    }

    const allowedPrefixes = [
        `companies/${companyId}/`,
        `secure_documents/${companyId}/`
    ];

    const isAllowed = allowedPrefixes.some(prefix => srcPath.startsWith(prefix));
    return isAllowed;
}

console.log("Running Path Validation Tests...");

const tests = [
    { id: '123', path: 'companies/123/doc.pdf', expected: true },
    { id: '123', path: 'secure_documents/123/doc.pdf', expected: true },
    { id: '123', path: 'companies/123/subfolder/doc.pdf', expected: true },
    { id: '123', path: 'companies/456/doc.pdf', expected: false, desc: 'Cross-tenant' },
    { id: '123', path: 'public/doc.pdf', expected: false, desc: 'Public folder' },
    { id: '123', path: '../etc/passwd', expected: false, desc: 'Traversal' },
    { id: '123', path: 'gs://bucket-name/companies/123/doc.pdf', expected: true, desc: 'GS Protocol' }
];

let passed = 0;
let failed = 0;

tests.forEach(t => {
    const result = validatePath(t.id, t.path);
    if (result === t.expected) {
        passed++;
    } else {
        console.error(`FAILED: ${t.path} (Exp: ${t.expected}, Got: ${result}) - ${t.desc || ''}`);
        failed++;
    }
});

console.log(`Tests Completed. Passed: ${passed}, Failed: ${failed}`);
if (failed > 0) process.exit(1);
