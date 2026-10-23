// firestore.rules as one decision table: who may do what.
//
// Every rule block is tried by fourteen kinds of caller with get, list, create,
// update and delete, and so is every path the server uses that no rule names, or
// that only a collection-group rule matches. So are the requests whose answer
// depends on the document (owner fields, each held by driver-1 and then by the
// caller, a status outside the pipeline list, a changed companyId) and the
// collection-group queries. The answers must equal
// `firestoreRules.decisions.table.json` byte for byte.
//
// A change to the rules that should leave everyone's access as it was (a shorter
// helper, a redundant check removed) is proven by an unchanged table. A change
// that does change access shows as changed lines in the table's diff. After an
// intended change, rewrite the table with
// `UPDATE_RULES_DECISIONS=1 npm run test:rules:emulators` and review that diff.
//
// Each request runs against its own copy of the document, so one caller's write
// never decides another's answer. A path that several requests share (the
// company document, `email_config`, a caller's own profile) is reset before each
// of them.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  documentId,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { describeFirestore, createRulesTestEnv } from './firestoreRules.support.js';

const TABLE_PATH = resolve(process.cwd(), 'src/tests/firestoreRules.decisions.table.json');

const CO = 'co-a';
const OTHER_CO = 'co-b';
const DRIVER = 'driver-1';
const DRIVER_EMAIL = 'driver@example.com';
const SOMEONE = 'someone-else';

const team = (role, companyId = CO) => ({ roles: { [companyId]: role }, companyTeamIds: [companyId] });

const PERSONAS = [
  { key: 'guest', about: 'not signed in' },
  { key: 'plain', uid: 'u-plain', about: 'signed in, no claims' },
  {
    key: 'driver',
    uid: DRIVER,
    claims: { email: DRIVER_EMAIL, email_verified: true },
    about: `${DRIVER}, verified email ${DRIVER_EMAIL}`,
  },
  {
    key: 'driverUnverified',
    uid: 'driver-2',
    claims: { email: DRIVER_EMAIL, email_verified: false },
    about: `driver-2, the same email not verified`,
  },
  { key: 'recruiterA', uid: 'u-recruiter-a', claims: team('recruiter'), about: `recruiter of ${CO}` },
  { key: 'hrA', uid: 'u-hr-a', claims: team('hr_user'), about: `hr_user of ${CO}` },
  { key: 'adminA', uid: 'u-admin-a', claims: team('company_admin'), about: `company_admin of ${CO}` },
  {
    key: 'adminA-noTeamIds',
    uid: 'u-admin-a-2',
    claims: { roles: { [CO]: 'company_admin' } },
    about: `company_admin of ${CO}, no companyTeamIds claim`,
  },
  { key: 'adminB', uid: 'u-admin-b', claims: team('company_admin', OTHER_CO), about: `company_admin of ${OTHER_CO}` },
  {
    key: 'recruiterAB',
    uid: 'u-recruiter-ab',
    claims: { roles: { [CO]: 'recruiter', [OTHER_CO]: 'recruiter' }, companyTeamIds: [CO, OTHER_CO] },
    about: `recruiter of ${CO} and ${OTHER_CO}, ${OTHER_CO} second in companyTeamIds`,
  },
  {
    key: 'otherRoleA',
    uid: 'u-other-role-a',
    claims: { roles: { [CO]: 'viewer' } },
    about: `a member of ${CO} whose role is not a team role, so no companyTeamIds`,
  },
  {
    key: 'superRoot',
    uid: 'u-super-root',
    claims: { globalRole: 'super_admin' },
    about: 'super_admin as a root claim, no roles map',
  },
  {
    key: 'superNested',
    uid: 'u-super-nested',
    claims: { roles: { globalRole: 'super_admin' } },
    about: 'super_admin inside roles',
  },
  { key: 'emptyRoles', uid: 'u-empty-roles', claims: { roles: {} }, about: 'signed in, an empty roles map' },
];

const tenant = (extra = {}) => ({ companyId: CO, ...extra });

/**
 * get, list, create, update and delete on the documents of one collection.
 * `{doc}` in a path or a value stands for a document of the caller's own, and
 * `{uid}` for the caller. A row's `fixtures` are documents a query needs to find.
 */
const documentRows = (collectionPath, { seed = tenant(), create = tenant({ name: 'created' }) } = {}) => [
  { op: 'get', path: `${collectionPath}/{doc}`, seed },
  { op: 'list', path: collectionPath },
  { op: 'create', path: `${collectionPath}/{doc}`, data: create },
  { op: 'update', path: `${collectionPath}/{doc}`, seed, data: { note: 'changed' } },
  { op: 'delete', path: `${collectionPath}/{doc}`, seed },
];

/** get, create, update and delete on one document the code names by its id. */
const namedDocRows = (path, seed = tenant()) => [
  { op: 'get', path, seed },
  { op: 'create', path, data: seed },
  { op: 'update', path, seed, data: { note: 'changed' } },
  { op: 'delete', path, seed },
];

const companyPath = `companies/${CO}`;
const applicationPath = `${companyPath}/applications/app-1`;
const leadPath = `${companyPath}/leads/lead-1`;
const referralPath = `${companyPath}/referral_links`;
const REFERRAL_CODE = 'ABCD2345';

/** A driver referral link made by `creator`, under its own code. */
const referralLink = (creator) => tenant({
  code: '{doc}', referrerName: 'Rita Referrer', createdBy: creator, createdByName: 'A Recruiter', active: true, createdAt: 'then',
});

// Every field on the rules' list of what a driver may change on their application,
// besides status and offerDetails, which change together.
const DRIVER_SELF_UPDATE_FIELDS = [
  'firstName', 'lastName', 'middleName', 'email', 'phone', 'dob', 'address', 'city', 'state', 'zip',
  'licenseNumber', 'cdlState', 'cdlClass', 'cdlExpiration', 'experience', 'experience-years',
  'employers', 'violations', 'accidents', 'schools', 'military', 'previousAddresses',
  'cdl-front', 'cdl-back', 'medical-card-upload', 'twic-card-upload', 'mvr-upload',
  'mvr-consent-upload', 'drug-test-consent-upload', 'ssc-upload', 'signature', 'signatureType',
  'offerResponseDate', 'sourceType', 'sourceSlug', 'firstNameNormalized', 'lastNameNormalized',
  'fullNameNormalized', 'emailNormalized', 'phoneNormalized', 'applicationIdNormalized',
  'submittedAt', 'updatedAt', 'lifecycle',
];

// Every status the rules let the company team set on an application or a lead,
// each tried wherever the rules check it.
const PIPELINE_STATUSES = [
  'New', 'New Lead', 'Contact Attempt 1', 'Contact Attempt 2', 'Contact Attempt 3', 'Contacted',
  'Attempted', 'Disqualified', 'In Process', 'Interested', 'Hired', 'Terminated', 'Declined',
  'New Application', 'Approved', 'Rejected', 'Background Check', 'In Review', 'Qualified', 'Hold',
  'Stale', 'Offer Accepted', 'Offer Declined',
];

// An owner field holds driver-1, and then the caller, so that every kind of caller
// is tried as the owner and not only a driver with a verified email.
const OWNERS = [DRIVER, '{uid}'];

const applicationOf = (owner) => tenant({
  applicantId: owner, driverId: owner, email: DRIVER_EMAIL, status: 'New Application', phone: '5550000000',
});
const ownedApplication = applicationOf(DRIVER);

// What a driver may try on their own application, including the reassignment
// and identity fields the rules keep from them.
const DRIVER_UPDATES = [
  [{ note: 'changed' }, 'a field outside the driver\'s list'],
  [{ assignedTo: 'u-recruiter-a' }, 'assignedTo'],
  [{ applicantId: SOMEONE }, `applicantId to ${SOMEONE}`],
  [{ driverId: SOMEONE }, `driverId to ${SOMEONE}`],
  [{ phone: '5551112222' }, 'phone'],
  [
    {
      ...Object.fromEntries(DRIVER_SELF_UPDATE_FIELDS.map((field) => [field, `changed ${field}`])),
      status: 'Offer Accepted', offerDetails: { response: 'Offer Accepted' },
    },
    'every field on the driver\'s list',
  ],
  [{ status: 'Hired' }, 'status Hired'],
  [{ status: 'Offer Accepted', offerDetails: { response: 'Offer Accepted' } }, 'offer accepted'],
  [{ status: 'Offer Declined', offerDetails: { response: 'Offer Declined' } }, 'offer declined'],
  [{ status: 'Offer Accepted', offerDetails: { response: 'Offer Declined' } }, 'offer accepted, response says declined'],
  [{ status: 'Totally Custom' }, 'status outside the list'],
  [{ companyId: OTHER_CO }, `companyId to ${OTHER_CO}`],
];

// The owner fields the application subcollections' shared reader looks for, each
// held by `owner`, and ownerUserIds also with `owner` second.
const ownerFieldSeeds = (owner) => [
  [{ ownerUserIds: [owner] }, `ownerUserIds has ${owner}`],
  [{ ownerUserIds: [SOMEONE, owner] }, `ownerUserIds has ${owner} second`],
  [{ driverId: owner }, `driverId ${owner}`],
  [{ applicantId: owner }, `applicantId ${owner}`],
  [{ userId: owner }, `userId ${owner}`],
];
const othersApplication = tenant({ applicantId: SOMEONE, driverId: SOMEONE, email: 'other@example.com' });

const ROWS = [
  // --- Public and token-only collections ---
  ...documentRows('public_profiles', { seed: { name: 'Public' }, create: { name: 'created' } }),
  ...documentRows('verification_requests'),
  ...documentRows('verification_requests/vr-1/responses'),
  ...documentRows('change_reviews'),

  // --- The company document (one path, shared by every caller) ---
  { op: 'get', path: companyPath, seed: { name: 'Company A', isActive: true } },
  { op: 'list', path: 'companies' },
  { op: 'create', path: companyPath, data: { name: 'Company A', isActive: true } },
  { op: 'create', path: 'companies/{doc}', data: { name: 'New company' }, note: 'a new company' },
  { op: 'update', path: companyPath, seed: { name: 'Company A', isActive: true }, data: { name: 'Renamed' } },
  {
    op: 'update', path: companyPath, seed: { name: 'Company A', isActive: true }, data: { isActive: false },
    note: 'deactivates it',
  },
  {
    op: 'update', path: companyPath, seed: { name: 'Company A', isActive: false }, data: { isActive: true },
    note: 'reactivates it',
  },
  {
    op: 'update', path: companyPath, seed: { name: 'Company A', isActive: true }, data: { status: 'suspended' },
    note: 'changes its status',
  },
  {
    op: 'update', path: companyPath, seed: { name: 'Company A', planType: 'free' }, data: { planType: 'paid' },
    note: 'changes its plan',
  },
  {
    op: 'update', path: companyPath, seed: { name: 'Company A', features: { pev: false } }, data: { features: { pev: true } },
    note: 'switches a feature on',
  },
  {
    op: 'update', path: companyPath, seed: { name: 'Company A' }, data: { featureSchedules: { pev: '2099-01-01T00:00:00Z' } },
    note: 'schedules a feature',
  },
  {
    op: 'update', path: companyPath, seed: { name: 'Company A', appSlug: 'company-a' }, data: { appSlug: 'company-b' },
    note: 'changes its public address',
  },
  { op: 'delete', path: companyPath, seed: { name: 'Company A', isActive: true } },

  // --- Company subcollections ---
  ...documentRows(`${companyPath}/templates`),
  ...documentRows(`${companyPath}/message_templates`),
  ...documentRows(`${companyPath}/bulk_sessions`),
  ...documentRows(`${companyPath}/bulk_sessions/bs-1/logs`),
  ...documentRows(`${companyPath}/bulk_sessions/bs-1/meta`),
  ...documentRows(`${companyPath}/campaign_drafts`),
  ...documentRows(`${companyPath}/segments`),
  ...documentRows(`${companyPath}/segments/seg-1/members`),
  ...documentRows(`${companyPath}/stats_daily`),
  ...documentRows(`${companyPath}/internal_stats`),
  ...documentRows(`${companyPath}/notifications`),
  ...documentRows(`${companyPath}/feature_alerts`),
  ...documentRows(`${companyPath}/settings`),
  ...documentRows(`${companyPath}/team`),
  ...documentRows(`${companyPath}/integrations`),
  { op: 'get', path: `${companyPath}/system_settings/email_config`, seed: { host: 'smtp.example.com' } },
  { op: 'list', path: `${companyPath}/system_settings` },
  { op: 'create', path: `${companyPath}/system_settings/email_config`, data: { host: 'smtp.example.com' } },
  {
    op: 'update', path: `${companyPath}/system_settings/email_config`, seed: { host: 'smtp.example.com' },
    data: { host: 'mail.example.com' },
  },
  { op: 'delete', path: `${companyPath}/system_settings/email_config`, seed: { host: 'smtp.example.com' } },
  { op: 'get', path: `${companyPath}/system_settings/{doc}`, seed: tenant(), note: 'any other document' },
  { op: 'create', path: `${companyPath}/system_settings/{doc}`, data: tenant(), note: 'any other document' },
  {
    op: 'update', path: `${companyPath}/system_settings/{doc}`, seed: tenant(), data: { note: 'changed' },
    note: 'any other document',
  },
  { op: 'delete', path: `${companyPath}/system_settings/{doc}`, seed: tenant(), note: 'any other document' },
  ...documentRows(`${companyPath}/not_in_the_rules`),

  // --- Signing requests ---
  ...OWNERS.map((recipient) => ({
    op: 'get', path: `${companyPath}/signing_requests/{doc}`, seed: tenant({ recipientId: recipient }),
    note: `recipient ${recipient}`,
  })),
  {
    op: 'get', path: `${companyPath}/signing_requests/{doc}`, seed: tenant({ recipientId: SOMEONE }),
    note: 'recipient someone else',
  },
  {
    op: 'get', path: `${companyPath}/signing_requests/{doc}`,
    seed: { companyId: OTHER_CO, recipientId: SOMEONE }, note: `companyId ${OTHER_CO}`,
  },
  { op: 'list', path: `${companyPath}/signing_requests` },
  { op: 'list', path: `${companyPath}/signing_requests`, where: ['recipientId', '==', '{uid}'] },
  {
    op: 'create', path: `${companyPath}/signing_requests/{doc}`, data: tenant({ recipientId: DRIVER, status: 'sent' }),
  },
  ...OWNERS.flatMap((recipient) => [
    [{ note: 'changed' }, 'a field outside the signer\'s list'],
    [{ recipientId: SOMEONE }, `recipientId to ${SOMEONE}`],
    [{ status: 'viewed', viewedAt: 'now' }, 'viewed'],
    [{ status: 'declined', declinedReason: 'not mine', clientMetadata: { userAgent: 'test' } }, 'declined'],
    [{ status: 'signed' }, 'signed without signatureData'],
    [{ status: 'signed', signatureData: 'signature', signedAt: 'now' }, 'signed with signatureData'],
  ].map(([data, note]) => ({
    op: 'update', path: `${companyPath}/signing_requests/{doc}`,
    seed: tenant({ recipientId: recipient, status: 'sent' }), data, note: `recipient ${recipient}, ${note}`,
  }))),
  { op: 'delete', path: `${companyPath}/signing_requests/{doc}`, seed: tenant({ recipientId: DRIVER }) },
  ...documentRows(`${companyPath}/signing_requests/sr-1/secrets`),

  // --- Applications ---
  ...[
    [ownedApplication, `applicant, driver and email are ${DRIVER}'s`],
    ...OWNERS.flatMap((owner) => [
      [tenant({ applicantId: owner, driverId: SOMEONE }), `applicantId ${owner}`],
      [tenant({ applicantId: SOMEONE, driverId: owner }), `driverId ${owner}`],
    ]),
    [tenant({ applicantId: SOMEONE, driverId: SOMEONE, email: DRIVER_EMAIL }), `email ${DRIVER_EMAIL} only`],
    [othersApplication, 'someone else\'s'],
    [{ companyId: OTHER_CO, applicantId: SOMEONE, driverId: SOMEONE }, `companyId ${OTHER_CO}`],
    [{ applicantId: SOMEONE, driverId: SOMEONE }, 'no companyId'],
  ].map(([seed, note]) => ({ op: 'get', path: `${companyPath}/applications/{doc}`, seed, note })),
  { op: 'list', path: `${companyPath}/applications` },
  { op: 'list', path: `${companyPath}/applications`, where: ['applicantId', '==', '{uid}'] },
  { op: 'list', path: `${companyPath}/applications`, where: ['driverId', '==', '{uid}'] },
  { op: 'list', path: `${companyPath}/applications`, where: ['email', '==', DRIVER_EMAIL] },
  ...[
    [tenant({ applicantId: '{doc}', driverId: '{uid}' }), 'the caller\'s own, id = applicantId'],
    [tenant({ applicantId: 'another-id', driverId: '{uid}' }), 'the caller\'s own, id is not applicantId'],
    [{ companyId: OTHER_CO, applicantId: '{doc}', driverId: '{uid}' }, `the caller's own, companyId ${OTHER_CO}`],
    [tenant({ applicantId: '{doc}', driverId: '{uid}', assignedTo: 'u-recruiter-a' }), 'the caller\'s own, with assignedTo'],
    [tenant({ applicantId: '{doc}', driverId: '{uid}', assignedToName: 'Riley' }), 'the caller\'s own, with assignedToName'],
    [tenant({ applicantId: '{doc}', driverId: '{uid}', referral: { code: 'ABCD2345', referrerName: 'Rita' } }), 'the caller\'s own, with referral'],
    [tenant({ applicantId: '{doc}', driverId: '{uid}', referralCode: 'ABCD2345' }), 'the caller\'s own, with referralCode'],
    [tenant({ applicantId: SOMEONE, driverId: SOMEONE }), 'manual entry, no status'],
    ...PIPELINE_STATUSES.map((status) => [tenant({ applicantId: SOMEONE, status }), `manual entry, status ${status}`]),
    [tenant({ applicantId: SOMEONE, status: 'Totally Custom' }), 'manual entry, status outside the list'],
    [tenant({ applicantId: SOMEONE, status: 7 }), 'manual entry, status not text'],
    [{ companyId: OTHER_CO, applicantId: SOMEONE }, `manual entry, companyId ${OTHER_CO}`],
    [{ applicantId: SOMEONE }, 'manual entry, no companyId'],
  ].map(([data, note]) => ({ op: 'create', path: `${companyPath}/applications/{doc}`, data, note })),
  {
    op: 'create', path: `${companyPath}/applications/{uid}`, data: tenant({ applicantId: '{uid}' }),
    note: 'the caller\'s own by applicantId alone, id = applicantId',
  },
  ...[
    ...OWNERS.flatMap((owner) => [
      ...DRIVER_UPDATES.map(([data, note]) => [applicationOf(owner), data, `${owner}'s, ${note}`]),
      [tenant({ applicantId: owner, driverId: SOMEONE }), { phone: '5551112222' }, `phone, applicantId ${owner} only`],
      [tenant({ applicantId: SOMEONE, driverId: owner }), { phone: '5551112222' }, `phone, driverId ${owner} only`],
    ]),
    [tenant({ applicantId: SOMEONE, driverId: SOMEONE, email: DRIVER_EMAIL }), { phone: '5551112222' },
      `phone, ${DRIVER}'s by email only`],
    [{ applicantId: DRIVER, driverId: DRIVER }, { note: 'changed' }, 'no companyId'],
  ].map(([seed, data, note]) => ({ op: 'update', path: `${companyPath}/applications/{doc}`, seed, data, note })),
  ...PIPELINE_STATUSES.map((status) => ({
    op: 'update', path: `${companyPath}/applications/{doc}`, seed: othersApplication, data: { status },
    note: `someone else's, status ${status}`,
  })),
  { op: 'delete', path: `${companyPath}/applications/{doc}`, seed: ownedApplication },

  // --- Application subcollections ---
  ...[
    ...OWNERS.flatMap(ownerFieldSeeds),
    [{ ownerUserIds: [SOMEONE] }, 'someone else\'s'],
  ].map(([seed, note]) => ({ op: 'get', path: `${applicationPath}/dq_files/{doc}`, seed, note })),
  ...documentRows(`${applicationPath}/dq_files`).slice(1),
  { op: 'list', path: `${applicationPath}/dq_files`, where: ['ownerUserIds', 'array-contains', '{uid}'] },
  ...['general_documents', 'submission'].flatMap((name) => [
    ...[
      ...OWNERS.flatMap(ownerFieldSeeds),
      [{ driverId: SOMEONE }, 'someone else\'s'],
    ].map(([seed, note]) => ({ op: 'get', path: `${applicationPath}/${name}/{doc}`, seed, note })),
    ...documentRows(`${applicationPath}/${name}`).slice(1),
  ]),
  ...documentRows(`${applicationPath}/internal_notes`),
  ...documentRows(`${applicationPath}/activity_logs`),
  { op: 'get', path: `${applicationPath}/activity_logs/{doc}`, seed: { companyId: OTHER_CO }, note: `companyId ${OTHER_CO}` },
  { op: 'get', path: `${applicationPath}/activity_logs/{doc}`, seed: { action: 'viewed' }, note: 'no companyId' },
  ...documentRows(`${applicationPath}/activities`),
  ...documentRows(`${applicationPath}/pending_changes`),
  ...documentRows(`${companyPath}/application_drafts`),
  ...documentRows(`${companyPath}/application_draft_audit`),

  // --- Leads ---
  { op: 'get', path: `${companyPath}/leads/{doc}`, seed: tenant() },
  ...OWNERS.map((owner) => ({
    op: 'get', path: `${companyPath}/leads/{doc}`, seed: tenant({ userId: owner }), note: `userId ${owner}`,
  })),
  { op: 'get', path: `${companyPath}/leads/{doc}`, seed: { companyId: OTHER_CO }, note: `companyId ${OTHER_CO}` },
  { op: 'list', path: `${companyPath}/leads` },
  ...[
    [tenant(), 'no status'],
    ...PIPELINE_STATUSES.map((status) => [tenant({ status }), `status ${status}`]),
    [tenant({ status: 'Totally Custom' }), 'status outside the list'],
    [{ companyId: OTHER_CO }, `companyId ${OTHER_CO}`],
  ].map(([data, note]) => ({ op: 'create', path: `${companyPath}/leads/{doc}`, data, note })),
  ...[
    [{ note: 'changed' }, 'a field'],
    ...PIPELINE_STATUSES.map((status) => [{ status }, `status ${status}`]),
    [{ status: 'Totally Custom' }, 'status outside the list'],
    [{ companyId: OTHER_CO }, `companyId to ${OTHER_CO}`],
  ].map(([data, note]) => ({
    op: 'update', path: `${companyPath}/leads/{doc}`, seed: tenant({ status: 'New Lead' }), data, note,
  })),
  { op: 'delete', path: `${companyPath}/leads/{doc}`, seed: tenant() },
  ...['activity_logs', 'activities', 'internal_notes', 'dq_files', 'general_documents', 'pending_changes']
    .flatMap((name) => documentRows(`${leadPath}/${name}`)),

  // --- Referral links ---
  { op: 'get', path: `${referralPath}/{doc}`, seed: referralLink(SOMEONE) },
  { op: 'list', path: referralPath },
  // A new link is created under a code in the links' alphabet; the shared path
  // is cleared before each request.
  ...[
    [referralLink('{uid}'), 'the caller\'s own'],
    [referralLink(SOMEONE), `createdBy ${SOMEONE}`],
    [{ ...referralLink('{uid}'), active: false }, 'the caller\'s own, inactive'],
    [{ ...referralLink('{uid}'), code: 'NOTTHEID' }, 'the caller\'s own, code is not the id'],
    [{ ...referralLink('{uid}'), companyId: OTHER_CO }, `the caller's own, companyId ${OTHER_CO}`],
    [{ ...referralLink('{uid}'), referrerName: '' }, 'the caller\'s own, no referrer name'],
    [{ ...referralLink('{uid}'), assignedTo: 'u-recruiter-a' }, 'the caller\'s own, a field outside the list'],
  ].map(([data, note]) => ({
    op: 'create', path: `${referralPath}/${REFERRAL_CODE}`, data: { ...data, code: data.code === '{doc}' ? REFERRAL_CODE : data.code }, note,
  })),
  {
    op: 'create', path: `${referralPath}/{doc}`, data: referralLink('{uid}'),
    note: 'the caller\'s own, a code outside the links\' alphabet',
  },
  ...OWNERS.flatMap((owner) => [
    [{ active: false, deactivatedAt: 'now' }, `createdBy ${owner}, deactivated`],
    [{ referrerName: 'Changed' }, `createdBy ${owner}, referrer name`],
  ].map(([data, note]) => ({ op: 'update', path: `${referralPath}/{doc}`, seed: referralLink(owner), data, note }))),
  {
    op: 'update', path: `${referralPath}/{doc}`, seed: { ...referralLink('{uid}'), active: false },
    data: { active: true }, note: 'the caller\'s own, reactivated',
  },
  { op: 'delete', path: `${referralPath}/{doc}`, seed: referralLink('{uid}'), note: 'the caller\'s own' },

  // --- Driver profiles ---
  { op: 'get', path: 'drivers/{uid}', seed: { companyIds: [CO] }, note: 'the caller\'s own' },
  ...[
    [{ companyIds: [CO] }, `companyIds [${CO}]`],
    [{ companyIds: [OTHER_CO] }, `companyIds [${OTHER_CO}]`],
    [{ companyIds: ['co-c', CO] }, `companyIds [co-c, ${CO}]`],
    [{ firstName: 'Old' }, 'no companyIds'],
  ].map(([seed, note]) => ({ op: 'get', path: 'drivers/{doc}', seed, note })),
  { op: 'list', path: 'drivers' },
  { op: 'list', path: 'drivers', where: ['documentId', '==', '{uid}'] },
  { op: 'create', path: 'drivers/{uid}', data: { firstName: 'New' }, note: 'the caller\'s own' },
  { op: 'create', path: 'drivers/{doc}', data: { firstName: 'New' }, note: 'someone else\'s' },
  { op: 'update', path: 'drivers/{uid}', seed: { firstName: 'Old' }, data: { firstName: 'New' }, note: 'the caller\'s own' },
  { op: 'update', path: 'drivers/{doc}', seed: { firstName: 'Old' }, data: { firstName: 'New' }, note: 'someone else\'s' },
  { op: 'delete', path: 'drivers/{uid}', seed: { firstName: 'Old' }, note: 'the caller\'s own' },
  { op: 'delete', path: 'drivers/{doc}', seed: { firstName: 'Old' }, note: 'someone else\'s' },
  // saved_jobs (retired) and pending_updates (the server's) have no rule, so no client
  // reaches them.
  ...['drafts', 'documents', 'saved_jobs', 'pending_updates'].flatMap((name) => [
    ...documentRows(`drivers/{uid}/${name}`).map((row) => ({ ...row, note: 'the caller\'s own' })),
    ...documentRows(`drivers/${SOMEONE}/${name}`),
  ]),

  // --- Staff profiles ---
  { op: 'get', path: 'users/{uid}', seed: { name: 'Me' }, note: 'the caller\'s own' },
  ...[
    [{ companyIds: [CO] }, `companyIds [${CO}]`],
    [{ companyIds: [OTHER_CO] }, `companyIds [${OTHER_CO}]`],
    [{ companyIds: ['co-c', CO] }, `companyIds [co-c, ${CO}]`],
    [{ name: 'Old' }, 'no companyIds'],
  ].map(([seed, note]) => ({ op: 'get', path: 'users/{doc}', seed, note })),
  { op: 'list', path: 'users' },
  {
    op: 'list', path: 'users', where: ['documentId', 'in', ['u-teammate']],
    fixtures: [['users/u-teammate', { companyIds: [CO] }]], note: `the teammate's companyIds [${CO}]`,
  },
  { op: 'list', path: 'users', where: ['companyIds', 'array-contains', CO] },
  { op: 'create', path: 'users/{uid}', data: { name: 'New' }, note: 'the caller\'s own' },
  { op: 'create', path: 'users/{doc}', data: { name: 'New' }, note: 'someone else\'s' },
  ...[
    [{ name: 'New' }, 'name'],
    [{ companyIds: [OTHER_CO] }, 'companyIds'],
    [{ companyId: OTHER_CO }, 'companyId'],
    [{ role: 'company_admin' }, 'role'],
    [{ globalRole: 'super_admin' }, 'globalRole'],
  ].map(([data, note]) => ({
    op: 'update', path: 'users/{uid}', seed: { name: 'Me', companyIds: [CO] }, data, note: `the caller's own, ${note}`,
  })),
  { op: 'update', path: 'users/{doc}', seed: { name: 'Old' }, data: { name: 'New' }, note: 'someone else\'s' },
  { op: 'delete', path: 'users/{uid}', seed: { name: 'Me' }, note: 'the caller\'s own' },
  { op: 'delete', path: 'users/{doc}', seed: { name: 'Old' }, note: 'someone else\'s' },

  // --- Memberships ---
  ...[
    [{ userId: '{uid}', companyId: OTHER_CO, role: 'recruiter' }, `the caller's own, in ${OTHER_CO}`],
    [{ userId: SOMEONE, companyId: CO, role: 'recruiter' }, `someone else's, in ${CO}`],
    [{ userId: SOMEONE, companyId: OTHER_CO, role: 'recruiter' }, `someone else's, in ${OTHER_CO}`],
  ].map(([seed, note]) => ({ op: 'get', path: 'memberships/{doc}', seed, note })),
  { op: 'list', path: 'memberships' },
  { op: 'list', path: 'memberships', where: ['userId', '==', '{uid}'] },
  { op: 'list', path: 'memberships', where: ['companyId', '==', CO] },
  { op: 'create', path: 'memberships/{doc}', data: { userId: SOMEONE, companyId: CO, role: 'recruiter' } },
  {
    op: 'update', path: 'memberships/{doc}', seed: { userId: SOMEONE, companyId: CO, role: 'recruiter' },
    data: { role: 'company_admin' },
  },
  ...[
    [{ userId: '{uid}', companyId: OTHER_CO, role: 'recruiter' }, `the caller's own, in ${OTHER_CO}`],
    [{ userId: SOMEONE, companyId: CO, role: 'recruiter' }, `someone else's, in ${CO}`],
    [{ userId: SOMEONE, companyId: OTHER_CO, role: 'recruiter' }, `someone else's, in ${OTHER_CO}`],
  ].map(([seed, note]) => ({ op: 'delete', path: 'memberships/{doc}', seed, note })),

  // --- Personal notifications ---
  { op: 'get', path: 'notifications/{doc}', seed: { recipientId: '{uid}' }, note: 'the caller\'s own' },
  { op: 'get', path: 'notifications/{doc}', seed: { recipientId: SOMEONE }, note: 'someone else\'s' },
  { op: 'list', path: 'notifications' },
  { op: 'list', path: 'notifications', where: ['recipientId', '==', '{uid}'] },
  { op: 'create', path: 'notifications/{doc}', data: { recipientId: '{uid}' }, note: 'to the caller' },
  { op: 'update', path: 'notifications/{doc}', seed: { recipientId: '{uid}' }, data: { read: true }, note: 'the caller\'s own' },
  { op: 'update', path: 'notifications/{doc}', seed: { recipientId: SOMEONE }, data: { read: true }, note: 'someone else\'s' },
  { op: 'delete', path: 'notifications/{doc}', seed: { recipientId: '{uid}' }, note: 'the caller\'s own' },
  { op: 'delete', path: 'notifications/{doc}', seed: { recipientId: SOMEONE }, note: 'someone else\'s' },

  // --- Platform collections ---
  ...documentRows('analytics'),
  ...documentRows('system_settings'),
  ...[
    'integrations_index', 'rate_limits', 'processing_status', 'environment_audit_log', 'ai_provider_config',
    'ai_routing_config', 'ai_telemetry', 'blog_posts', 'blog_runs', 'platform_settings', 'landing_leads',
  ].flatMap((name) => documentRows(name)),

  // --- Recruiter links ---
  { op: 'get', path: 'recruiter_links/{doc}', seed: tenant() },
  { op: 'list', path: 'recruiter_links' },
  { op: 'create', path: 'recruiter_links/{doc}', data: tenant(), note: `companyId ${CO}` },
  { op: 'create', path: 'recruiter_links/{doc}', data: { companyId: OTHER_CO }, note: `companyId ${OTHER_CO}` },
  { op: 'create', path: 'recruiter_links/{doc}', data: { slug: 'x' }, note: 'no companyId' },
  { op: 'update', path: 'recruiter_links/{doc}', seed: tenant(), data: { note: 'changed' }, note: 'a field' },
  { op: 'update', path: 'recruiter_links/{doc}', seed: tenant(), data: { companyId: OTHER_CO }, note: `companyId to ${OTHER_CO}` },
  { op: 'delete', path: 'recruiter_links/{doc}', seed: tenant() },

  // --- Removed and unknown collections ---
  ...documentRows('job_posts'),
  ...documentRows('not_in_the_rules'),

  // --- Paths only the server reads and writes, which no rule names ---
  ...[
    'blacklist', 'company_api_keys', 'api_audit', 'orphaned_signature_cleanup', 'system_jobs',
    'system_jobs/companyClaims/owedUsers', 'release_promotions', 'release_promotion_locks',
    ...[
      'blacklist', 'inbound_messages', 'legal_agreements', 'email_sent_addresses', 'sms_sent_phones',
      'integrations/sms_provider/keychain', 'stats_daily/d-1/processed_signals', 'bulk_sessions/bs-1/targets',
    ].map((name) => `${companyPath}/${name}`),
    `${applicationPath}/submission_attempts`,
  ].flatMap((path) => documentRows(path)),

  // --- Documents the code names by their id, so that a rule for one of them shows ---
  ...[
    'system_jobs/platformAlerts', 'system_jobs/publicProfileReconcile', 'system_jobs/companyClaims',
    'ai_routing_config/modelCheck', 'ai_routing_config/order', 'release_promotion_locks/current',
    `${companyPath}/integrations/email_settings`, `${companyPath}/integrations/sms_provider`,
    `${companyPath}/internal_stats/dashboard`, `${companyPath}/settings/automated_sms`,
    `${companyPath}/bulk_sessions/bs-1/meta/targets`, `${companyPath}/signing_requests/sr-1/secrets/token`,
    `${applicationPath}/submission/v1`, 'verification_requests/vr-1/responses/submission',
  ].flatMap((path) => namedDocRows(path)),
  ...namedDocRows('companies/SANDBOX', { name: 'Sandbox', isActive: true }),

  // --- Collection-group queries, and the documents only a group rule matches ---
  ...[
    ['applications', null],
    ['applications', ['companyId', '==', CO]],
    ['applications', ['applicantId', '==', '{uid}']],
    ['applications', ['driverId', '==', '{uid}']],
    ['applications', ['email', '==', DRIVER_EMAIL]],
    ['leads', null],
    ['leads', ['companyId', '==', CO]],
    ['leads', ['userId', '==', '{uid}']],
    ['activity_logs', null],
    ['activity_logs', ['companyId', '==', CO]],
    ['signing_requests', null],
    ['signing_requests', ['companyId', '==', CO]],
    ['signing_requests', ['recipientId', '==', '{uid}']],
  ].map(([group, constraint]) => ({ op: 'list', group, ...(constraint ? { where: constraint } : {}) })),
  ...['applications', 'leads', 'activity_logs', 'signing_requests']
    .flatMap((group) => documentRows(group))
    .map((row) => ({ ...row, note: 'top level, only the group rule matches' })),
];

/** What a row is called in the table. */
const labelOf = (row) => [
  row.op,
  row.group ? `group ${row.group}` : row.path,
  row.where ? `where ${row.where[0]} ${row.where[1]} ${JSON.stringify(row.where[2])}` : '',
  row.note ? `(${row.note})` : '',
].filter(Boolean).join(' ');

const uidOf = (persona) => persona.uid ?? 'nobody';

/** Fills `{uid}` and `{doc}` in a path, a value or a document. */
function fill(value, task) {
  if (typeof value === 'string') return value.replaceAll('{uid}', task.uid).replaceAll('{doc}', task.docId);
  if (Array.isArray(value)) return value.map((item) => fill(item, task));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, fill(item, task)]));
  }
  return value;
}

function request(db, task) {
  const { row } = task;
  if (row.op === 'get') return getDoc(doc(db, task.path));
  if (row.op === 'create') return setDoc(doc(db, task.path), task.data);
  if (row.op === 'update') return updateDoc(doc(db, task.path), task.data);
  if (row.op === 'delete') return deleteDoc(doc(db, task.path));
  const source = row.group ? collectionGroup(db, row.group) : collection(db, task.path);
  if (!row.where) return getDocs(source);
  const [field, operator, value] = row.where;
  return getDocs(query(source, where(field === 'documentId' ? documentId() : field, operator, fill(value, task))));
}

// A Firestore client sends its writes down one stream. When one is refused the
// stream restarts and resends the writes still in flight, and a create or delete
// that had already landed is then judged again, as an update or as a delete of
// nothing. So each caller has one write in flight at a time.
const writesInFlight = new Map();
function inTurn(key, run) {
  const turn = (writesInFlight.get(key) ?? Promise.resolve()).then(run);
  writesInFlight.set(key, turn);
  return turn;
}

function outcomeOf(task) {
  const attempt = async () => {
    try {
      await request(databases.get(task.persona.key), task);
      return 'allow';
    } catch (error) {
      return error?.code === 'permission-denied' ? 'deny' : `error ${error?.code || error?.message}`;
    }
  };
  return task.row.op === 'get' || task.row.op === 'list' ? attempt() : inTurn(task.persona.key, attempt);
}

async function inPool(jobs, size) {
  let next = 0;
  await Promise.all(Array.from({ length: size }, async () => {
    while (next < jobs.length) {
      const job = jobs[next];
      next += 1;
      await job();
    }
  }));
}

let testEnv;
const databases = new Map();

describeFirestore('firestore.rules decision table', () => {
  beforeAll(async () => {
    testEnv = await createRulesTestEnv('decisions');
    await testEnv.clearFirestore();
    for (const persona of PERSONAS) {
      const context = persona.uid
        ? testEnv.authenticatedContext(persona.uid, persona.claims)
        : testEnv.unauthenticatedContext();
      databases.set(persona.key, context.firestore());
    }
  });

  afterAll(async () => {
    if (testEnv) await testEnv.cleanup();
  });

  it('decides every request as the committed table says', async () => {
    const labels = ROWS.map(labelOf);
    expect(new Set(labels).size).toBe(labels.length);

    const tasks = ROWS.flatMap((row, index) => PERSONAS.map((persona) => {
      const task = { row, persona, uid: uidOf(persona), docId: `r${index}-${persona.key}` };
      return {
        ...task,
        path: row.path ? fill(row.path, task) : null,
        seed: fill(row.seed, task),
        data: fill(row.data, task),
      };
    }));

    // Requests on one document run in order; a document only one request uses is
    // seeded up front, and a shared one is reset before each request on it.
    const byPath = new Map();
    const independent = [];
    for (const task of tasks) {
      if (task.row.op === 'list') {
        independent.push([task]);
      } else {
        if (!byPath.has(task.path)) byPath.set(task.path, []);
        byPath.get(task.path).push(task);
      }
    }
    const results = new Map();

    await testEnv.withSecurityRulesDisabled(async (context) => {
      const admin = context.firestore();
      const upfront = [
        ...ROWS.flatMap((row) => row.fixtures ?? []),
        ...[...byPath.values()].filter((group) => group.length === 1 && group[0].seed)
          .map(([task]) => [task.path, task.seed]),
      ];
      for (let start = 0; start < upfront.length; start += 400) {
        const batch = writeBatch(admin);
        for (const [path, data] of upfront.slice(start, start + 400)) batch.set(doc(admin, path), data);
        await batch.commit();
      }

      const groups = [...independent, ...byPath.values()];
      await inPool(groups.map((group) => async () => {
        for (const task of group) {
          if (group.length > 1) {
            if (task.row.op === 'create' || !task.seed) await deleteDoc(doc(admin, task.path));
            else await setDoc(doc(admin, task.path), task.seed);
          }
          results.set(task, await outcomeOf(task));
        }
      }), 24);
    });

    const failed = tasks
      .filter((task) => !['allow', 'deny'].includes(results.get(task)))
      .map((task) => `${labelOf(task.row)} as ${task.persona.key}: ${results.get(task)}`);
    expect(failed, 'requests that were neither allowed nor refused').toEqual([]);

    const decisions = {};
    ROWS.forEach((row, index) => {
      const cells = tasks
        .filter((task) => task.row === row && results.get(task) === 'allow')
        .map((task) => task.persona.key);
      decisions[labels[index]] = cells.length > 0 ? cells.join(' ') : 'nobody';
    });
    const table = {
      personas: Object.fromEntries(PERSONAS.map((persona) => [persona.key, persona.about])),
      decisions,
    };
    const text = `${JSON.stringify(table, null, 2)}\n`;
    if (process.env.UPDATE_RULES_DECISIONS) writeFileSync(TABLE_PATH, text);

    const committed = JSON.parse(readFileSync(TABLE_PATH, 'utf8'));
    expect(table.personas).toEqual(committed.personas);
    const changed = [...new Set([...Object.keys(committed.decisions), ...labels])]
      .filter((label) => committed.decisions[label] !== decisions[label])
      .map((label) => `${label}\n    table: ${committed.decisions[label] ?? '(no such row)'}`
        + `\n    rules: ${decisions[label] ?? '(no such row)'}`);
    expect(changed).toEqual([]);
    expect(text).toBe(readFileSync(TABLE_PATH, 'utf8'));
  }, 300_000);
});
