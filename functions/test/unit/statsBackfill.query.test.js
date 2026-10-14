/**
 * The stats backfill's read, built with the real Admin SDK.
 *
 * It read a company's activity across its records with a collection-group range
 * on the document id, bounded by `companies/{id}/`. That bound has an odd number
 * of segments, and the SDK refuses it when the query is built, before anything
 * is read: every backfill failed. Built here on a Firestore instance that never
 * connects, as the backfill builds it, for the first page and the next.
 *
 * The project and ids below are artificial.
 */
jest.mock('../../firebaseAdmin', () => {
    const { initializeApp } = jest.requireActual('firebase-admin/app');
    const { getFirestore, FieldPath, FieldValue, Timestamp } = jest.requireActual('firebase-admin/firestore');
    const db = getFirestore(initializeApp({ projectId: 'demo-stats-backfill' }, 'stats-backfill-query-test'));
    return {
        db,
        admin: { firestore: Object.assign(() => db, { FieldPath, FieldValue, Timestamp }), auth: () => ({}) },
    };
});
jest.mock('../../shared/rateLimiter', () => ({ checkRateLimit: jest.fn() }));

const { deleteApp, getApp } = require('firebase-admin/app');
const { db } = require('../../firebaseAdmin');
const { __test: { companyActivityPage } } = require('../../statsBackfill');

afterAll(() => deleteApp(getApp('stats-backfill-query-test')));

describe('stats backfill: a page of a company\'s activity', () => {
    it.each(['activity_logs', 'activities'])('builds the first page of %s', (collectionName) => {
        expect(() => companyActivityPage('co-1', collectionName, null)).not.toThrow();
    });

    it('builds the page after the last document read', () => {
        const last = db.doc('companies/co-1/applications/app-1/activity_logs/log-1');
        expect(() => companyActivityPage('co-1', 'activity_logs', last)).not.toThrow();
    });
});
