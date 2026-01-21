# SafeHaul Core Architecture & Sync Map

## 1. Interaction Patterns
SafeHaul uses three distinct patterns to talk to the backend:

### A. Real-time Listening (Firestore SDK)
- **Used for**: Dashboards, Leads, and Applications.
- **How it works**: The Frontend uses `onSnapshot` inside custom hooks (like `useCompanyDashboard`). 
- **The Secret**: Security rules (`firestore.rules`) act as the "invisible gatekeeper," ensuring recruiters only see their own company's data.

### B. Heavy Processing (Callable Functions)
- **Used for**: `distributeDailyLeads`, `createPortalUser`, `moveApplication`, `bulkAssignLeads`.
- **How it works**: The Frontend triggers these via `httpsCallable`. The Backend runs the complex logic and returns a success/fail message.

### C. Automated Triggers (Cloud Triggers)
- **Used for**: `sealDocument`, `onApplicationSubmitted`.
- **How it works**: The Frontend simply writes a document to Firestore (e.g., setting status to `pending_seal`). The Backend "sees" this change automatically and starts the PDF generation process.
- **Dependency**: The `onApplicationSubmitted` trigger **strictly requires** the `signature` field to follow the `TEXT_SIGNATURE:[Name]` format (or be a valid image URL) to successfully generate the PDF.

---

## 2. Bulletproof Driver Application System (NEW)

### Overview
Guaranteed delivery system ensuring **zero data loss** for driver applications, even with network failures.

### Data Flow
```
User submits → Generate deterministic ID → Queue to IndexedDB
                                                    ↓
                                          Attempt Firestore write
                                                    ↓
                                    Success → Dequeue | Fail → Retry
                                                    ↓
                              onApplicationSubmitted (idempotent)
```

### Key Components

| Component | Location | Purpose |
|-----------|----------|---------|
| **Submission Queue** | `src/lib/submissionQueue.js` | IndexedDB queue with exponential backoff |
| **Application IDs** | `src/lib/applicationId.js` | SHA-256 deterministic ID generation |
| **Queue Hook** | `src/hooks/useSubmissionQueue.js` | Auto-recovery on reconnect |
| **Queue Indicator** | `src/shared/components/feedback/QueueStatusIndicator.jsx` | Offline/pending UI |
| **Draft Recovery** | `src/features/driver-app/components/DraftRecoveryModal.jsx` | Resume/start fresh modal |
| **Auto-save** | `DriverApplicationWizard.jsx` | 5-second debounced save |

### Deterministic IDs
```javascript
applicationId = SHA256(companyId + email + phone)
confirmationNumber = "SAF-YYYY-" + random5digits
```
**Purpose:** Prevents duplicate submissions during retries

### Idempotency Protection
The backend uses `processing_status/{app_companyId_appId}` to prevent double-processing:
```javascript
{
  started: Timestamp,
  completed: boolean,
  completedAt: Timestamp
}
```

---

## 3. Key Data Models
To keep the system in sync, the Frontend expects specific fields:
- **Companies**: Must have `planType` ('free'/'paid') to determine lead limits.
- **Leads**: Must have `unavailableUntil` (timestamp) to manage the shuffle logic.
- **Signing Requests**: Must have a `fields` array containing `xPosition`, `yPosition`, etc., as percentages.

### Application Schema (Compliance Critical)
The Application object (`companies/{id}/applications/{appId}`) is the single source of truth for the PDF Generator and Admin Dashboard.
* **Identity**: `suffix` and `otherName` (Aliases) are mandatory display fields for background checks.
* **Signature**: Must be stored as `TEXT_SIGNATURE:John Doe` for typed signatures.
* **Lifecycle** (NEW): `{ status, submittedAt, processingStartedAt, processingCompletedAt }`
* **Compliance Logs**:
    * `hosDay1` through `hosDay7` (Hours of Service).
    * `lastRelievedDate` & `lastRelievedTime`.
    * `safetyDeclarations` (flags for `revoked-licenses`, `driving-convictions`, `drug-alcohol-convictions`).

---

## 4. The "Dealer" Distribution Engine (CRITICAL)
**DO NOT MODIFY THE LOGIC BELOW WITHOUT UNDERSTANDING THE "GHOST LEAD" PROTECTION.**

The Lead Distribution system (`functions/leadLogic.js`) uses a **"Dealer Architecture"**, not a simple shuffle. It operates on strict rules to prevent crashes and ensure quota delivery.

### A. The "Dealer" Logic
1.  **Iterative Dealing**: Instead of loading all leads into memory, the system iterates through companies one by one.
2.  **Transactional Assignment**: Every lead assignment is a standalone Firestore Transaction.
    * **Ghost Protection**: The transaction strictly checks `doc.exists` before writing. If a lead is missing (Ghost Lead), the transaction fails gracefully, logs a warning, and the Dealer immediately grabs the *next* candidate. **This prevents the entire batch from crashing.**
    * **Anti-Snipe**: Checks `unavailableUntil` inside the transaction to ensure no double-booking.
3.  **Pre-Flight Validation**: The Dealer assumes data validity. The Frontend (`DriverApplicationWizard`) acts as the primary firewall, preventing "Incomplete Leads" (missing signatures or HOS logs) from ever entering the distribution pool.

### B. Strict Quota Rules
The system calculates quotas in this specific order of priority:
1.  **Plan Type**:
    * `Paid` Plan = **200 Leads**
    * `Free` Plan = **50 Leads**
2.  **Manual Override**: The `dailyLeadQuota` field is ONLY used if it is **higher** than the Plan Default (e.g., a VIP set to 500). If `dailyLeadQuota` is 50 but the plan is Paid, the system forces **200**.

### C. Frontend Resolution
* **Pathing**: The Backend stores leads in `companies/{CompanyUID}/leads`.
* **Slug Resolution**: The Frontend URL uses a "Slug" (e.g., `/dashboard/ray-star-llc`). The Frontend (`useCompanyDashboard.js`) **MUST** resolve this Slug to the actual `CompanyUID` before querying. Failure to do this will result in an empty dashboard even if leads exist.

---

## 5. Frontend View Sync Strategy (The "Mirror Law")
To prevent "Hidden Data" liability, the Admin Dashboard must mirror 100% of the input fields collected in the Driver App.

### A. The Critical Path Mapping
Any field added to the **Driver Input** (Left) MUST be rendered in the **Admin Output** (Right).

| Driver Input Component | Admin Render Component | Critical Data Points |
| :--- | :--- | :--- |
| `Step1_Contact.jsx` | `PersonalInfoSection.jsx` | Suffix, Aliases (Known By Other Name) |
| `Step3_License.jsx` | `SupplementalSection.jsx` | TWIC Card, Expiration |
| `Step4_Violations.jsx` | `SupplementalSection.jsx` | **Red Flags:** License Revoked, Suspended |
| `Step7_General.jsx` | `SupplementalSection.jsx` | **HOS Table:** 7-Day Log, Last Relieved Time |
| `BusinessInfoSection` | `SupplementalSection.jsx` | Owner Operator Business Name, EIN |

### B. Validation Strategy
* **Submission Gate**: The `handleFinalSubmit` function in `PublicApplyHandler.jsx` and `DriverApplicationWizard.jsx` MUST validate that `signatureName` exists and `final-certification` is checked before allowing the write to Firestore.
* **Queue-First Pattern** (NEW): All submissions go through IndexedDB queue before Firestore write.

---

## 6. Lead Lifecycle & Conversion Rules
* **No Auto-Conversion**: Marking a lead as "Interested" via Call Outcome NEVER moves it to Applications. It simply updates the status to "Contacted".
* **The Only Path**: A Lead is converted to an Application ONLY when the Driver clicks the "Interest Link" (triggering `confirmDriverInterest`) OR submits a full application via the Recruiter Link.
* **Data Isolation**: Last Call Status (`lastCallOutcome`) is strictly local to the Company and must not sync to other companies viewing the same Lead.

---

## 7. Critical Field Mappings

### Lead Name Display (IMPORTANT)
The Lead Distribution system has a **legacy data compatibility issue**:

| Source | Name Storage | How to Display |
|--------|-------------|----------------|
| New Distributions | `firstName` + `lastName` | `${firstName} ${lastName}` |
| Legacy Data | `fullName` | Parse `fullName` directly |
| Fallback | Neither | "Unknown Driver" |

**Frontend Rule**: Always check for BOTH patterns:
```javascript
if (item.fullName) {
    name = item.fullName;
} else {
    name = `${item.firstName || 'Unknown'} ${item.lastName || 'Driver'}`;
}
```

> Files using this pattern:
> - `src/features/companies/components/DashboardBody.jsx`
> - `src/shared/components/modals/SafeHaulLeadsDriverModal.jsx`

---

## 8. Feature Module Structure

### Core Features
| Module | Purpose | Key Files |
|--------|---------|-----------|
| `analytics` | Performance tracking | Stats aggregation |
| `applications` | Application management | Hooks, services |
| `auth` | Authentication | Login, signup |
| `companies` | Company dashboard | Dashboard hooks, components |
| `company-admin` | HR portal | Application detail view, bulk upload |
| `driver-app` | Driver application flow | Wizard, draft recovery |
| `drivers` | Driver profiles | Profile management |
| `onboarding` | New user onboarding | Setup flows |
| `settings` | Company settings | Configuration |
| `signing` | Digital signatures | Signing room |
| `super-admin` | Platform admin | System management |

### Shared Libraries (`src/lib/`)
- `firebase/` - Firebase configuration
- `submissionQueue.js` - IndexedDB queue (NEW)
- `applicationId.js` - Deterministic ID generation (NEW)
- `signature.js` - Signature utilities
- `notificationService.js` - Notifications

### Shared Hooks (`src/hooks/`)
- `useSubmissionQueue.js` - Queue auto-recovery (NEW)

---

## 9. Testing Strategy

### Unit Tests
- `submissionQueue.test.js` - 21 tests for queue operations
- `applicationId.test.js` - 23 tests for ID generation

### Integration Points
- Queue → Firestore → Backend trigger
- Draft save → Recovery → Resume
- Offline → Online → Auto-retry

---

## Maintenance Notes

- **Timezone**: All date keys use `America/Chicago` for consistency
- **Queue is client-side**: Each browser has its own IndexedDB queue
- **Deterministic IDs**: Same driver + company = same ID (prevents duplicates)
- **Idempotency**: Backend checks `processing_status` before processing
- **Auto-save**: Every 5 seconds of inactivity in driver wizard