# SafeHaul Core Architecture

This document serves as the high-level technical reference for the SafeHaul platform.

## 1. System Interaction Patterns

SafeHaul uses three distinct patterns for frontend-backend communication, optimized for scale and cost-efficiency.

### A. Real-time Listeners (Firestore SDK)
- **Primary Use**: Dashboards, Lead lists, Application feeds.
- **Mechanism**: The frontend uses `onSnapshot` to listen for real-time updates.
- **Security**: Role-Based Access Control (RBAC) is enforced via `firestore.rules`. Recruiters and Company Admins are scoped to their `companyId`.

### B. High-Scale Heavy Processing (Cloud Functions)
- **Primary Use**: Lead distribution, Bulk messaging, Auth management.
- **Mechanism**: Triggered via `httpsCallable` (v2). used only when logic is too complex for security rules or requires third-party API integration.

### C. Background Triggers (Cloud Firestore Triggers)
- **Primary Use**: Stats aggregation, PDF generation.
- **Mechanism**: Triggered automatically on document creation/update. For example, creating a log in `activity_logs` triggers an update to `stats_daily`.

---

## 2. Frontend-Direct Architecture (NEW)

To reduce latency and cloud costs, several core features have been migrated from backend middleware to the **Direct Firestore SDK**.

| Feature | Pattern | Security Rule |
|---------|---------|---------------|
| **Templates** | `addDoc` / `updateDoc` | `allow write: if isCompanyTeam()` |
| **Slug Resolution** | `getDocs(where: appSlug == x)` | Public read on `companies` (limited fields) |
| **Unified Search** | Parallel `getDocs` queries | `allow read: if isSuperAdmin()` |
| **Performance Data** | Raw read from `stats_daily` | `allow read: if isCompanyAdmin()` |
| **Campaign Status** | `updateDoc` on `bulk_sessions` | `allow update: if isCompanyTeam()` |

---

## 3. Driver Application Safety

Guaranteed delivery system ensuring **zero data loss** for driver applications, even with network failures.

### A. Deterministic IDs
Application IDs are generated using `SHA256(companyId + email + phone)`. This ensures that even if a submission is retried multiple times, it results in the same document ID, preventing duplicates.

### B. Submission Queue
 submissions are queued in **IndexedDB** (`src/lib/submissionQueue.js`) with exponential backoff. The system auto-retries when the connection is restored.

### C. Idempotent Processing
The backend uses a `processing_status` collection to track long-running triggers (like PDF generation).
1. Check if `completed: true`.
2. If not, set `started: true`.
3. Process.
4. Set `completed: true`.

---

## 4. "Dealer" Distribution Engine

The Lead Distribution system (`functions/leadLogic.js`) operates on a **Dealer Architecture**.

1.  **Iterative Dealing**: Iterates through companies sequentially to ensure fair distribution.
2.  **Ghost Lead Protection**: Uses Firestore Transactions to verify a lead exists and is available *before* assigning. If a lead is "sniped" by another process, the dealer skips it without crashing the batch.
3.  **Plan-Based Quotas**:
    - `Free`: 50 leads/day.
    - `Paid`: 200 leads/day.
    - Custom override: `dailyLeadQuota`.

---

## 5. SMS Integration (Digital Wallet)

SafeHaul uses a multi-tenant **Digital Wallet** to manage SMS provider credentials.

### A. Factory Pattern
`SMSAdapterFactory` fetches encrypted credentials (`sms_provider`), decrypts them using the server's `SMS_ENCRYPTION_KEY`, and instantiates the correct provider adapter (e.g., RingCentral).

### B. The Keychain
Secure tokens (like JWTs) for individual phone lines are stored in `companies/{id}/integrations/sms_provider/keychain/{phoneNumber}`. This allows multiple recruiters to use separate lines under one company account.

### C. Security
Credentials are **NEVER** exposed to the frontend. The frontend calls `sendSMS(from, to, body)`, and the backend handles routing and authentication behind the scenes.
