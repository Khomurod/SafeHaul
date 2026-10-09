/**
 * What the API guide (`/developers/api`) says, kept as data so a test can hold
 * it to the server: every route `functions/companyApi/routes.js` answers and
 * every error code the API sends is named here (`ApiGuidePage.test.jsx`).
 */

export const BASE_URL = 'https://us-central1-truckerapp-system.cloudfunctions.net/companyApi';

export const PERMISSIONS = Object.freeze([
    { scope: 'applications:read', grant: 'Every key', gives: 'Submitted applications: the answers, the agreements accepted and the list of uploaded files. The Social Security Number is masked to its last four digits.' },
    { scope: 'documents:read', grant: 'If the company allows it', gives: 'Download links for the files the driver uploaded, such as the license and medical card.' },
    { scope: 'ssn:read', grant: 'If the company allows it', gives: 'The full Social Security Number, the Social Security card and, with documents:read, the application PDF, which shows the number.' },
]);

const KEY_EXAMPLE = `{
  "keyId": "0123456789abcdef",
  "name": "Our TMS",
  "permissions": ["applications:read", "documents:read"],
  "company": { "id": "Xb81kQ0aP2", "name": "Example Freight LLC" }
}`;

const SUBMISSIONS_EXAMPLE = `{
  "submissions": [
    { "applicationId": "k3Jd92LxQp", "version": "v1", "isOriginal": true, "submittedAt": "2026-10-09T14:02:11.517Z" },
    { "applicationId": "k3Jd92LxQp", "version": "v2", "isOriginal": false, "submittedAt": "2026-10-09T15:40:03.210Z" }
  ],
  "nextCursor": "eyJzIjoiMjAyNi0xMC0wOVQxNTo0MDowMy4yMTBaIiwiYSI6Imsz...",
  "hasMore": false
}`;

const APPLICATION_EXAMPLE = `{
  "id": "k3Jd92LxQp",
  "version": "v1",
  "isOriginal": true,
  "submittedAt": "2026-10-09T14:02:11.517Z",
  "confirmationNumber": "SH-7Q2K9",
  "status": "New Application",
  "company": { "name": "Example Freight LLC", "dba": null, "dotNumber": "3312998", "mcNumber": null },
  "applicant": {
    "firstName": "Marcus", "middleName": null, "lastName": "Delgado", "suffix": null,
    "email": "marcus@example.com", "phone": "(214) 555-0188", "dateOfBirth": "1986-04-17",
    "address": { "street": "812 Cottonwood Lane", "city": "Arlington", "state": "Texas", "zip": "76010" }
  },
  "sections": [
    {
      "id": "personal",
      "title": "Personal Information",
      "fields": [
        { "id": "ssn", "label": "Social Security Number", "type": "text", "value": "***-**-7391", "display": "***-**-7391", "masked": true },
        { "id": "dob", "label": "Date of Birth", "type": "date", "value": "1986-04-17", "display": "04/17/1986" }
      ]
    },
    {
      "id": "employment",
      "title": "Employment History",
      "fields": [
        {
          "id": "employers", "label": "Previous Employers", "type": "repeating", "display": null,
          "value": [[
            { "label": "Employer", "value": "Lone Star Logistics" },
            { "label": "Position", "value": "OTR Driver" },
            { "label": "From", "value": "09/2023" },
            { "label": "To", "value": "06/2026" }
          ]]
        }
      ]
    },
    {
      "id": "documents",
      "title": "Uploaded Documents",
      "fields": [
        { "id": "cdl-front", "label": "CDL (Front)", "type": "file", "value": { "fileName": "cdl-front.jpg", "documentId": "cdl-front" }, "display": "cdl-front.jpg" }
      ]
    }
  ],
  "customQuestions": [],
  "agreements": [
    { "id": "mvrAuthorization", "title": "MOTOR VEHICLE RECORD (MVR) AUTHORIZATION", "version": "v2", "accepted": true, "acceptedAt": "2026-10-09T14:01:58.004Z" }
  ],
  "employmentCoverage": { "requiredMonths": 36, "coveredMonths": 36, "missingMonths": 0, "isComplete": true, "gaps": [] },
  "provenance": { "source": "submission", "notes": [] },
  "signature": { "type": "drawn", "capturedAt": "2026-10-09T14:02:10.902Z", "present": true },
  "documents": [{ "id": "cdl-front", "label": "CDL (Front)", "fileName": "cdl-front.jpg" }],
  "ssnIncluded": false
}`;

const DOCUMENTS_EXAMPLE = `{
  "applicationId": "k3Jd92LxQp",
  "version": "v1",
  "documents": [
    { "id": "cdl-front", "label": "CDL (Front)", "fileName": "cdl-front.jpg",
      "url": "https://storage.googleapis.com/...", "expiresAt": "2026-10-09T16:17:00.000Z" }
  ],
  "missing": [],
  "withheld": [{ "id": "ssc-upload", "label": "Social Security Card", "needs": "ssn:read" }]
}`;

const PDF_EXAMPLE = `{
  "applicationId": "k3Jd92LxQp",
  "version": "v1",
  "fileName": "Driver-Application-Marcus-Delgado-2026-10-09.pdf",
  "url": "https://storage.googleapis.com/...",
  "expiresAt": "2026-10-09T16:17:00.000Z"
}`;

/** Every route, in the order a sync uses them. `route` is the server's own name for it. */
export const ENDPOINTS = Object.freeze([
    {
        id: 'key',
        route: 'GET /v1/key',
        path: '/v1/key',
        needs: [],
        summary: 'Which key this is: its name, its permissions and its company. Call it first to check a key works.',
        params: [],
        example: KEY_EXAMPLE,
    },
    {
        id: 'submissions',
        route: 'GET /v1/submissions',
        path: '/v1/submissions',
        needs: [],
        summary: 'Every submission, oldest first. A driver who submits again appears again, as the next version of the same application. A submission is listed about a minute after the driver sends it.',
        params: [
            { name: 'cursor', text: 'The nextCursor of your last call. Returns only what arrived after it.' },
            { name: 'since', text: 'Start at this date and time instead, such as 2026-10-01T00:00:00Z.' },
            { name: 'limit', text: 'How many to return, 1 to 100. Default 50.' },
        ],
        example: SUBMISSIONS_EXAMPLE,
    },
    {
        id: 'application',
        route: 'GET /v1/applications/:id',
        path: '/v1/applications/{id}',
        needs: [],
        summary: 'One application exactly as the driver submitted it, from a record that later edits cannot change. The latest version unless you ask for one. A file answer gives the file’s name and, when the documents endpoint can link the file, its documentId.',
        params: [{ name: 'version', text: 'v1 for the original, v2 and on for resubmissions.' }],
        example: APPLICATION_EXAMPLE,
    },
    {
        id: 'documents',
        route: 'GET /v1/applications/:id/documents',
        path: '/v1/applications/{id}/documents',
        needs: ['documents:read'],
        summary: 'Download links for the uploaded files, each working for 15 minutes. A file no longer stored is listed under missing; one this key may not fetch, under withheld.',
        params: [{ name: 'version', text: 'As for the application.' }],
        example: DOCUMENTS_EXAMPLE,
    },
    {
        id: 'pdf',
        route: 'GET /v1/applications/:id/pdf',
        path: '/v1/applications/{id}/pdf',
        needs: ['documents:read', 'ssn:read'],
        summary: 'A 15-minute link to the application PDF made when the driver submitted. It shows the full Social Security Number, and each link issued is written to the application’s history.',
        params: [{ name: 'version', text: 'As for the application.' }],
        example: PDF_EXAMPLE,
    },
]);

/** Every error code the API sends, with its HTTP status. */
export const ERRORS = Object.freeze([
    { status: 400, code: 'bad_request', meaning: 'A parameter is not valid: the message says which.' },
    { status: 401, code: 'missing_key', meaning: 'No key was sent. Send Authorization: Bearer <key>.' },
    { status: 401, code: 'invalid_key', meaning: 'The key is not one we know.' },
    { status: 401, code: 'key_revoked', meaning: 'The company turned this key off. Ask them for a new one.' },
    { status: 403, code: 'missing_permission', meaning: 'This key does not have the permission the endpoint needs.' },
    { status: 404, code: 'not_found', meaning: 'No such endpoint, application or version for this company.' },
    { status: 404, code: 'pdf_not_ready', meaning: 'The PDF is still being made. Try again in a few minutes.' },
    { status: 405, code: 'method_not_allowed', meaning: 'The API only reads: use GET.' },
    { status: 429, code: 'rate_limited', meaning: 'Too many requests. Wait the seconds Retry-After says.' },
    { status: 500, code: 'internal', meaning: 'Something went wrong on our side. Try again shortly.' },
    { status: 503, code: 'unavailable', meaning: 'The request could not be recorded, so it was not answered. Try again shortly.' },
]);

export const LIMITS = Object.freeze([
    '60 requests a minute per key, and 120 a minute from one address.',
    'File and PDF links work for 15 minutes: download right away, and ask again for a new link later.',
    'A company can have up to 5 keys turned on at once.',
]);

export const CURL_EXAMPLE = `curl -s ${BASE_URL}/v1/submissions \\
  -H "Authorization: Bearer $SAFEHAUL_API_KEY"`;

export const NODE_EXAMPLE = `// Node.js 18 or later. Keep the key on your server, never in a browser or an app.
const BASE = '${BASE_URL}';
const API_KEY = readSecret('safehaul-api-key'); // yours: wherever your server keeps secrets
const headers = { Authorization: \`Bearer \${API_KEY}\` };

async function get(path) {
  const res = await fetch(BASE + path, { headers });
  if (res.status === 429) throw new Error(\`Rate limited; retry after \${res.headers.get('retry-after')} s\`);
  const body = await res.json();
  if (!res.ok) throw new Error(\`\${body.error.code}: \${body.error.message}\`);
  return body;
}

// Run every few minutes. Save nextCursor after each page you have stored.
async function sync(savedCursor) {
  let cursor = savedCursor;
  for (;;) {
    const page = await get('/v1/submissions' + (cursor ? \`?cursor=\${cursor}\` : ''));
    for (const item of page.submissions) {
      const application = await get(\`/v1/applications/\${item.applicationId}?version=\${item.version}\`);
      await saveApplication(application); // yours
    }
    cursor = page.nextCursor;
    await saveCursor(cursor); // yours
    if (!page.hasMore) return cursor;
  }
}`;
