// functions/activityLogRetention.js
//
// B2: single chokepoint that stamps `expiresAt` on every activity-log document so
// the Firestore TTL policy (enabled LATER, only after BigQuery export is live —
// see docs/production-readiness-runbook.md) can age out the hot copy. Doing this
// in a trigger rather than at each write site guarantees no writer is missed
// (writers exist on both the client and in Cloud Functions). The +1 write per log
// is the accepted cost of one correct chokepoint.
//
// Path coverage: activity logs live at
//   companies/{companyId}/{applications|leads}/{parentId}/activity_logs/{logId}
// The `{parentCollection}` wildcard covers both applications and leads — the same
// proven pattern driverSync.js uses, so it deploys identically. The legacy
// `activities` log is read-only (Firestore rules) and nothing writes it.

const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { stampExpiryOnCreate } = require('./shared/retention');

exports.stampActivityLogExpiry = onDocumentCreated(
    {
        document: 'companies/{companyId}/{parentCollection}/{parentId}/activity_logs/{logId}',
        maxInstances: 10,
    },
    (event) => stampExpiryOnCreate(event),
);
