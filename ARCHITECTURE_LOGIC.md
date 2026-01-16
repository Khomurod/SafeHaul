# SafeHaul Architecture Logic Reference

> **Purpose:** This document helps AI agents understand key system architectures before making changes.

---

## 1. Call Counter / Performance Stats Pipeline

### Data Flow
```
User logs call → useCallOutcome.js → activity_logs subcollection
                                            ↓
                              Firestore trigger fires (real-time)
                                            ↓
                              onActivityLogCreated / onLeadsActivityLogCreated
                                            ↓
                              Increments stats_daily/{dateKey}
                                            ↓
                              PerformanceWidget reads stats_daily
```

### Key Files
| File | Purpose |
|------|---------|
| `src/shared/hooks/useCallOutcome.js` | Frontend: Logs calls to `activity_logs` |
| `functions/statsAggregator.js` | Firestore triggers that increment counters |
| `functions/statsBackfill.js` | Admin tool to rebuild stats from raw data |
| `functions/companyAdmin.js` → `getTeamPerformanceHistory` | Reads `stats_daily` for UI |

### Trigger Paths (Critical!)
- `companies/{companyId}/applications/{appId}/activity_logs/{logId}` → `onActivityLogCreated`
- `companies/{companyId}/leads/{leadId}/activity_logs/{logId}` → `onLeadsActivityLogCreated`
- `companies/{companyId}/applications/{appId}/activities/{id}` → `onLegacyActivityCreated`

### Stats Document Structure
Location: `companies/{companyId}/stats_daily/{YYYY-MM-DD}`
```javascript
{
  totalDials: number,
  connected: number,
  voicemail: number,
  notInterested: number,
  notQualified: number,
  callback: number,
  byUser: {
    [userId]: { name: string, dials: number, connected: number }
  },
  createdAt: Date,
  updatedAt: Date
}
```

---

## 2. Lead Distribution Engine

### Scheduling
- **6:00 AM CT:** `planLeadDistribution` - Primes the engine (dry run)
- **7:00 AM CT:** `runLeadDistribution` - Distributes leads to companies

### Data Flow
```
Cloud Scheduler → planLeadDistribution / runLeadDistribution
                            ↓
                      leadLogic.js → runLeadDistribution()
                            ↓
                      Queries global 'leads' collection
                            ↓
                      Deals leads to companies based on quota
                            ↓
                      Creates leads in companies/{id}/leads/
```

### Key Files
| File | Purpose |
|------|---------|
| `functions/leadDistribution.js` | Exports scheduled + manual triggers |
| `functions/leadLogic.js` | Core distribution algorithm |
| `functions/workers/distributeWorker.js` | Cloud Tasks parallel worker |

### Company Quota
- Free companies: 50 leads/day (default)
- Paid companies: 200 leads/day
- Stored in `companies/{id}.dailyLeadQuota`

### Lead Lifecycle States
- `New Lead` → Fresh, never contacted
- `Attempted` → Called but no answer
- `Contacted` → Connected with driver
- `Disqualified` / `Rejected` → Terminal states

---

## 3. Activity Logging

### How to Log Activity (Frontend)
```javascript
import { logActivity } from '@shared/utils/activityLogger';

// For general activities (non-calls)
await logActivity(companyId, collectionName, docId, action, details, type);

// For calls - use useCallOutcome hook instead (sets type: 'call')
```

### Activity Document Structure
```javascript
{
  type: 'call' | 'user' | 'system',
  action: string,
  details: string,
  outcome: string,           // For calls: 'interested', 'callback', etc.
  isContact: boolean,        // True if driver answered
  performedBy: userId,
  performedByName: string,
  timestamp: serverTimestamp()
}
```

---

## 4. When to Backfill vs Real-Time

| Scenario | Use |
|----------|-----|
| New call logged | Real-time trigger updates `stats_daily` |
| Historical data missing | Run `backfillCompanyStats` from Super Admin |
| Trigger was broken | Run `backfillAllStats` to rebuild all |

---

## Maintenance Notes

- **Timezone:** All date keys use `America/Chicago` for consistency
- **Date Format:** `YYYY-MM-DD` (en-CA locale format)
- **Backfill is idempotent:** Safe to run multiple times (rebuilds from scratch)
