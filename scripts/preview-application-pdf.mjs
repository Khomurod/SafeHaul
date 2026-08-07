#!/usr/bin/env node
/**
 * Render a sample driver-application PDF and rasterise its pages, so the
 * document can be LOOKED AT rather than only asserted about.
 *
 * The unit tests read the finished PDF's text back out, which catches wrong,
 * missing and forbidden content — but not a heading stranded at the foot of a
 * page, a title running off the right margin, or a table that has lost its
 * alignment. Every one of those has happened here. This produces the artefact a
 * human reviews.
 *
 *   node scripts/preview-application-pdf.mjs [outDir] [--chromium=<path>]
 *
 * Writes `application-original.pdf`, `application-masked.pdf` and a `pages/`
 * directory of PNGs. Rasterising needs Chromium; without it the PDFs are still
 * written and the step is skipped with a message rather than a failure.
 *
 * The fixture is invented data for a fictional carrier. It deliberately
 * exercises the awkward cases: an unaccepted agreement, a custom question whose
 * wording was never recorded, an answer whose question was deleted, a long free
 * text answer, two employers, an employment gap and an uploaded file whose
 * stored name is a hashed storage segment.
 */

import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');
const { buildApplicationDefinition } = require(path.join(root, 'functions/shared/applicationDefinition'));
const { buildSubmissionSnapshot } = require(path.join(root, 'functions/shared/submissionSnapshot'));
const { renderApplicationPdf } = require(path.join(root, 'functions/shared/pdf/applicationDocument'));

const args = process.argv.slice(2);
const chromiumFlag = args.find((arg) => arg.startsWith('--chromium='));
// A flag rather than an environment variable: the environment registry is the
// inventory of SafeHaul's real configuration, and a developer's local browser
// path is not part of it.
const chromiumPath = chromiumFlag ? chromiumFlag.slice('--chromium='.length) : null;
const outDir = path.resolve(args.find((arg) => !arg.startsWith('--')) || path.join(root, '.pdf-preview'));
const SUBMITTED_AT = '2026-07-14T15:22:41.000Z';

const company = {
    companyName: 'Northwind Freight Systems',
    dba: 'Northwind Carriers',
    dotNumber: '3312998',
    mcNumber: '998211',
    address: { street: '4400 Industrial Parkway, Suite 210', city: 'Fort Worth', state: 'TX', zip: '76106' },
    contact: { email: 'recruiting@northwindfreight.example', phone: '(817) 555-0142' },
    applicationConfig: {
        emergencyContacts: { hidden: false, required: false },
        referralSource: { hidden: false, required: false },
    },
    customQuestions: [
        { id: '9f2c1a44-77bd-4e21-9f0e-1c2b3d4e5f60', label: 'Are you willing to run a dedicated lane out of Laredo?', type: 'multipleChoice', options: ['Yes', 'No'], required: true },
        { id: 'b71e0d55-2a3f-4c88-bb90-0e1f2a3b4c5d', label: 'Describe your experience hauling temperature-controlled freight.', type: 'paragraph' },
        { id: 'c9d8e7f6-1234-4321-9876-abcdefabcdef', type: 'shortAnswer' },
    ],
};

const formData = {
    firstName: 'Marcus', middleName: 'Anthony', lastName: 'Delgado',
    'known-by-other-name': 'yes', otherName: 'Marc Delgado',
    ssn: '412-88-7391', dob: '1986-04-17',
    email: 'marcus.delgado@example.com', phone: '(214) 555-0188', 'sms-consent': 'yes',
    street: '812 Cottonwood Lane', city: 'Arlington', state: 'TX', zip: '76010',
    'residence-3-years': 'no',
    previousAddresses: [{ street: '55 Kingsley Court Apt 4B', city: 'Dallas', state: 'TX', zip: '75204', startDate: '2021-03', endDate: '2023-08' }],
    'legal-work': 'yes', 'english-fluency': 'yes', 'experience-years': '5-10 years',
    'drug-test-positive': 'no', 'dot-return-to-duty': 'no',
    referralSource: 'Referred by a current driver',
    cdlNumber: '18422771', cdlState: 'TX', cdlClass: 'Class A', cdlExpiration: '2029-04-17',
    endorsements: 'H,N,T', medCardExpiration: '2027-01-09',
    'has-other-licenses': 'yes',
    additionalLicenses: [{ number: '4471222', state: 'NM', class: 'Class A', expiration: '2024-06-30' }],
    'has-twic': 'yes', twicExpiration: '2028-11-02',
    'consent-mvr': 'yes', 'revoked-licenses': 'no', 'driving-convictions': 'yes',
    convictionExplanation: 'Speeding 12 mph over the posted limit on US-287 near Decatur, TX. Paid the fine; no points remain on the record.',
    'drug-alcohol-convictions': 'no',
    violations: [{ date: '2024-05-19', charge: 'Speeding 12 over', location: 'Decatur, TX', penalty: '$210 fine' }],
    accidents: [{ date: '2023-02-11', city: 'Oklahoma City', state: 'OK', commercial: 'yes', preventable: 'no', details: 'Rear-ended at a signal while stopped. Police report filed; no citation issued to me. Minor damage to the trailer bumper.' }],
    expStraightTruckMiles: '100,000+', expStraightTruckExp: '3-5 years',
    expSemiTrailerMiles: '500,000+', expSemiTrailerExp: '5+ years',
    expTwoTrailersMiles: 'None', expTwoTrailersExp: '<6 months',
    employers: [
        { companyName: 'Lone Star Logistics LLC', position: 'OTR Driver', startDate: '2023-09', endDate: '2026-06', address: '1200 Commerce St', city: 'Dallas', state: 'TX', phone: '2145550133', companyEmail: 'hr@lonestarlogistics.example', dotNumber: '2214887', supervisorName: 'Dana Whitfield', supervisorPhone: '2145550177', supervisorEmail: 'dana.w@lonestarlogistics.example', mayContact: 'yes', reasonForLeaving: 'Seeking a dedicated lane closer to home.' },
        { companyName: 'Redline Transport Co', position: 'Regional Driver', startDate: '2021-04', endDate: '2023-07', city: 'Fort Worth', state: 'TX', phone: '8175550109', mayContact: 'yes', reasonForLeaving: 'Company closed its Fort Worth terminal.' },
    ],
    unemployment: [{ startDate: '2023-07', endDate: '2023-09', details: 'Family medical leave to care for a parent after surgery.' }],
    schools: [{ name: 'Southwest Truck Driver Training', location: 'Phoenix, AZ', startDate: '2016-01', endDate: '2016-04' }],
    military: [{ branch: 'U.S. Army', rank: 'Sergeant', start: '2008-06', end: '2014-06', heavyEq: 'yes', honorable: 'yes' }],
    ec1Name: 'Elena Delgado', ec1Relationship: 'Spouse', ec1Phone: '(214) 555-0190', ec1Address: '812 Cottonwood Lane, Arlington, TX 76010',
    'has-felony': 'no', driverInitials: 'MAD',
    'cdl-front': { name: 'cdl-front.jpg' },
    'cdl-back': { name: 'cdl-back.jpg' },
    'medical-card-upload': 'companies/x/applications/y/guest_uploads/98f3ac-medical-card.pdf?token=NOT-A-REAL-TOKEN',
    customAnswers: {
        '9f2c1a44-77bd-4e21-9f0e-1c2b3d4e5f60': 'Yes',
        'b71e0d55-2a3f-4c88-bb90-0e1f2a3b4c5d': 'Four years running reefer for produce out of the Rio Grande Valley. Comfortable with pre-cooling, pulp temperatures and continuous versus start-stop operation.',
        'c9d8e7f6-1234-4321-9876-abcdefabcdef': 'No preference',
        'a-question-since-deleted': 'An answer whose question was later removed',
    },
};

const definition = buildApplicationDefinition({ company });
const acceptances = Object.fromEntries(definition.agreements.map((agreement) => [agreement.id, {
    accepted: agreement.id !== 'pspDisclosure',
    acceptedAt: SUBMITTED_AT,
    ip: '203.0.113.42',
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) Safari/605.1.15',
}]));

const snapshot = buildSubmissionSnapshot({
    definition,
    formData,
    acceptances,
    signature: { image: 'data:image/png;base64,placeholder', type: 'drawn', capturedAt: SUBMITTED_AT },
    submittedAt: SUBMITTED_AT,
});

mkdirSync(outDir, { recursive: true });

const original = await renderApplicationPdf({ snapshot, includeFullSsn: true, sequence: 1, generatedAt: SUBMITTED_AT });
writeFileSync(path.join(outDir, 'application-original.pdf'), original.bytes);

const masked = await renderApplicationPdf({ snapshot, includeFullSsn: false, sequence: 1, generatedAt: SUBMITTED_AT });
writeFileSync(path.join(outDir, 'application-masked.pdf'), masked.bytes);

console.log(`Wrote ${original.pageCount}-page originals to ${outDir}`);

await rasterise(path.join(outDir, 'application-original.pdf'), path.join(outDir, 'pages'));

/** Render each page to a PNG with pdf.js inside Chromium. */
async function rasterise(pdfPath, pagesDir) {
    let chromium;
    try {
        ({ chromium } = await import('playwright'));
    } catch {
        console.log('playwright is not installed; skipping rasterisation.');
        return;
    }

    const { readFileSync } = await import('node:fs');
    const pdfBytes = readFileSync(pdfPath);
    let browser;
    try {
        browser = await chromium.launch(chromiumPath ? { executablePath: chromiumPath } : {});
    } catch (error) {
        console.log(`No Chromium available (${error.message.split('\n')[0]}); skipping rasterisation.`);
        return;
    }

    const page = await browser.newPage({ viewport: { width: 1100, height: 1400 } });
    // A virtual origin, so pdf.js's ES-module imports and its worker resolve.
    await page.route('https://pdf.local/**', (route) => {
        const url = new URL(route.request().url());
        if (url.pathname === '/') {
            return route.fulfill({ contentType: 'text/html', body: '<body style="margin:0;background:#7a7a7a"><div id="root"></div></body>' });
        }
        if (url.pathname === '/doc.pdf') return route.fulfill({ contentType: 'application/pdf', body: pdfBytes });
        const file = url.pathname === '/pdf.mjs' ? 'pdf.min.mjs' : 'pdf.worker.min.mjs';
        return route.fulfill({
            contentType: 'text/javascript',
            body: readFileSync(path.join(root, 'node_modules/pdfjs-dist/build', file)),
        });
    });

    await page.goto('https://pdf.local/');
    const count = await page.evaluate(async () => {
        const pdfjs = await import('https://pdf.local/pdf.mjs');
        pdfjs.GlobalWorkerOptions.workerSrc = 'https://pdf.local/pdf.worker.mjs';
        const doc = await pdfjs.getDocument({ url: 'https://pdf.local/doc.pdf' }).promise;
        const root = document.getElementById('root');
        for (let i = 1; i <= doc.numPages; i += 1) {
            const pdfPage = await doc.getPage(i);
            const viewport = pdfPage.getViewport({ scale: 1.6 });
            const canvas = document.createElement('canvas');
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            canvas.id = `page-${i}`;
            canvas.style.cssText = 'display:block;margin:18px auto;background:#fff';
            root.appendChild(canvas);
            await pdfPage.render({ canvasContext: canvas.getContext('2d'), viewport, canvas }).promise;
        }
        return doc.numPages;
    });

    mkdirSync(pagesDir, { recursive: true });
    for (let i = 1; i <= count; i += 1) {
        await page.locator(`#page-${i}`).screenshot({
            path: path.join(pagesDir, `page-${String(i).padStart(2, '0')}.png`),
        });
    }
    await browser.close();
    console.log(`Rasterised ${count} pages to ${pagesDir}`);
}
