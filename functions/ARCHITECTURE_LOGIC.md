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

### Lead Data Schema (CRITICAL)

> [!WARNING]
> **Field Name Mapping**: Distributed leads may have EITHER `fullName` (legacy) OR `firstName`/`lastName` (current). Frontend components must check for BOTH patterns to avoid showing "Unknown Driver".

**Global Pool Lead** (`leads/{leadId}`):
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `firstName` | string | ✓ | Driver first name |
| `lastName` | string | ✓ | Driver last name |
| `phone` | string | ✓ | Contact phone |
| `email` | string | - | Email address |
| `normalizedPhone` | string | - | Cleaned 10-digit phone for search |
| `driverType` | string/array | - | CDL types (e.g., "OTR", "Local") |
| `experience` | string | - | Years of experience |
| `city` | string | - | City |
| `state` | string | - | State code (e.g., "TX") |
| `source` | string | - | Origin: "SafeHaul Network", "Import", etc. |
| `unavailableUntil` | timestamp | - | Lock expiry for rotation control |
| `visitedCompanyIds` | array | - | Companies that have seen this lead |
| `lastAssignedTo` | string | - | Most recent company ID |
| `sharedHistory` | array | - | Anonymous notes from previous recruiters |
| `poolStatus` | string | - | "engaged_interest", "hired", "rejected" |

**Distributed Lead** (`companies/{companyId}/leads/{leadId}`):
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `firstName` | string | ✓ | Copied from global pool |
| `lastName` | string | ✓ | Copied from global pool |
| `fullName` | string | - | **LEGACY**: Some old data uses this instead |
| `phone` | string | ✓ | Contact phone |
| `email` | string | - | Email |
| `isPlatformLead` | boolean | ✓ | `true` = SafeHaul Pool, `false` = Private Upload |
| `distributedAt` | timestamp | ✓ | When assigned to this company |
| `originalLeadId` | string | ✓ | Reference to global pool document |
| `status` | string | ✓ | "New Lead", "Contacted", "Hired", etc. |
| `assignedTo` | string | - | Recruiter UID |
| `lastCallOutcome` | string | - | Most recent call result |
| `sharedHistory` | array | - | Copied from global pool |

### Backend Functions Reference

| Function | File | Trigger | Purpose |
|----------|------|---------|---------|
| `planLeadDistribution` | leadDistribution.js | Schedule 6AM CT | Prime the engine (dry run) |
| `runLeadDistribution` | leadDistribution.js | Schedule 7AM CT | Daily lead distribution |
| `distributeDailyLeads` | leadDistribution.js | Callable | Manual distribution trigger |
| `cleanupBadLeads` | leadDistribution.js | Callable | Remove invalid leads |
| `getLeadSupplyAnalytics` | leadDistribution.js | Callable | Supply/demand stats for dashboard |
| `migrateDriversToLeads` | leadDistribution.js | Callable | Import from drivers collection |
| `handleLeadOutcome` | leadDistribution.js | Callable | Process call outcomes to global pool |
| `confirmDriverInterest` | leadDistribution.js | Callable | Handle driver interest link clicks |

### Lock/Expiry Constants
```javascript
EXPIRY_SHORT_MS = 24 * 60 * 60 * 1000;     // 24 hours (unengaged lead rotation)
EXPIRY_LONG_MS = 7 * 24 * 60 * 60 * 1000;  // 7 days (engaged lead expiry)
POOL_COOL_OFF_DAYS = 7;                     // Rejected leads return after 7 days
POOL_INTEREST_LOCK_DAYS = 7;                // Interested leads locked 7 days
POOL_HIRED_LOCK_DAYS = 60;                  // Hired leads locked 60 days
```

---

## 2.5 Super Admin Lead Pool Management (PLANNED)

> [!NOTE]
> This section documents the planned Super Admin Lead Pool management UI for future implementation.

### Proposed Location
New dedicated tab in Super Admin dashboard: **"Lead Pool"**

### Dashboard Stats Cards
1. **Total Leads in Pool** - Count from global `leads` collection
2. **Available Now** - Fresh leads (null `unavailableUntil`) + unlocked leads
3. **Currently Locked** - In active rotation, unavailable for distribution
4. **Bad Leads** - Leads failing quality checks

### Action Buttons

| Button | Backend Function | Description |
|--------|------------------|-------------|
| **Distribute Now** | `distributeDailyLeads` | Force immediate distribution round |
| **Cleanup Bad Leads** | `cleanupBadLeads` | Remove invalid/test leads |
| **Recall All Leads** | NEW (to build) | Remove all `isPlatformLead=true` from all companies |
| **Force Rotation** | NEW (to build) | Clear all `unavailableUntil` timestamps (unlock pool) |
| **Migrate Drivers** | `migrateDriversToLeads` | Import `drivers` collection to pool |
| **Pause Distribution** | Toggle `maintenance_mode` | Emergency stop all distributions |

### Bad Lead Criteria

| Criteria | Detection Method |
|----------|------------------|
| No phone AND no email | `!phone && !email` |
| Duplicate phone numbers | Group by `normalizedPhone`, count > 1 |
| Test data | `name.toLowerCase().includes('test')` |
| Placeholder emails | `email.includes('placeholder')` |
| Missing name fields | `!firstName && !lastName && !fullName` |
| Invalid phone format | `normalizedPhone.length < 10` |
| Health check records | `name.includes('health check')` |

### Data Tables

1. **Lead Pool Browser**
   - Paginated table of all global leads
   - Filters: state, status, locked/unlocked, source
   - Search: phone, email, name
   - Actions: View details, Delete, Edit

2. **Distribution Log**
   - Recent distribution runs with timestamp
   - Per-company results (added/failed counts)
   - Error details for troubleshooting

3. **Bad Leads Queue**
   - Auto-detected problem leads
   - One-click delete or fix
   - Export for review

### Advanced Tools (Future)

| Tool | Purpose |
|------|---------|
| **Export Pool** | Download CSV of all leads |
| **Import Leads** | Bulk upload from CSV |
| **Deduplicate** | Find and merge duplicate records |
| **Pool Reset** | Clear all `visitedCompanyIds` for fresh distribution |
| **Quota Override** | Set custom daily quota per company |

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

## 5. Bulletproof Driver Application System

### Overview
Guaranteed delivery system ensuring zero data loss for driver applications, even with network failures.

### Data Flow
```
User submits → Generate deterministic ID → Queue to IndexedDB
                                                    ↓
                                          Attempt Firestore write
                                                    ↓
                                    Success → Dequeue | Fail → Retry later
                                                    ↓
                              onApplicationSubmitted trigger (idempotent)
                                                    ↓
                              processing_status check → Process → Update lifecycle
```

### Key Files
| File | Purpose |
|------|---------|
| `src/lib/submissionQueue.js` | IndexedDB queue with exponential backoff |
| `src/lib/applicationId.js` | Deterministic SHA-256 ID generation |
| `src/hooks/useSubmissionQueue.js` | Auto-recovery on reconnect |
| `src/shared/components/feedback/QueueStatusIndicator.jsx` | Offline/queue UI |
| `src/features/driver-app/components/DraftRecoveryModal.jsx` | Resume draft prompt |
| `functions/driverSync.js` → `onApplicationSubmitted` | Idempotent backend trigger |

### Deterministic Application IDs
```javascript
applicationId = SHA256(companyId + email + phone)
confirmationNumber = "SAF-YYYY-" + random5digits
```

**Purpose:** Prevents duplicate submissions during retries

### Queue Processing
- **Auto-save:** Every 5 seconds of inactivity
- **Auto-retry:** When online event detected
- **Exponential backoff:** 1s, 2s, 4s delays
- **Emergency save:** On page unload

### Lifecycle States
```
pending → processing → complete
              ↓
           failed (with reason)
```

### Idempotency Check
Location: `processing_status/{app_companyId_appId}`
```javascript
{
  started: Timestamp,
  completed: boolean,
  completedAt: Timestamp
}
```

**Critical:** Backend checks this before processing to prevent double-execution

---

## Maintenance Notes

- **Timezone:** All date keys use `America/Chicago` for consistency
- **Date Format:** `YYYY-MM-DD` (en-CA locale format)
- **Backfill is idempotent:** Safe to run multiple times (rebuilds from scratch)
- **Queue is client-side:** Each browser has its own IndexedDB queue
- **Deterministic IDs:** Same driver + company = same ID (prevents duplicates)
