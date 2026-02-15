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

## 5. SMS Integration (The "Digital Wallet")

SafeHaul uses a robust, multi-tenant system to manage SMS provider credentials (RingCentral) and routing.

### A. Factory Pattern (`SMSAdapterFactory.js`)
*   **Role**: The Gatekeeper.
*   **Process**:
    1.  Fetches encrypted credentials (`sms_provider`) from `companies/{id}/integrations`.
    2.  Decrypts them using the server-side `SMS_ENCRYPTION_KEY`.
    3.  Instantiates the correct provider adapter (e.g., `RingCentralAdapter`) with the decrypted config.

### B. The Keychain (User-Level Routing)
*   **Concept**: A company has one main account, but many recruiters.
*   **Storage**: `companies/{id}/integrations/sms_provider/keychain/{userId}`
*   **Function**: Maps a specific `userId` to a specific `phoneNumber`.
*   **Usage**: When `sendSMS` is called with a `userId`, the adapter looks up this map to determine which "From" number to use.

### C. Automatic Fallback Strategy (The "Safety Net")
To prevent message failures when a recruiter's direct line is misconfigured or lacks SMS permissions:
1.  **Attempt 1**: Send from the Recruiter's assigned Direct Number.
2.  **Failure Check**: If RingCentral returns a permission error (`FeatureNotAvailable` or `Invalid 'From' Number`)...
3.  **Attempt 2 (Fallback)**: The system **automatically** retries sending the message using the **Company's Default Main Number**.
4.  **Result**: The message gets delivered, ensuring business continuity even with imperfect configuration.

### D. Security
*   Credentials are never sent to the client.
*   Encryption keys exist only in the Cloud Functions environment variables.


---

## 6. Bulk Actions State Machine

The Bulk Messaging system (`functions/bulkActions.js`) uses a resilient, recursive worker pattern to process thousands of messages without hitting timeout limits.

### A. recursive Worker Pattern (`processBulkBatch`)
Instead of a long-running function, the system processes messages in small batches (e.g., 20 at a time).
1.  **Fetch Batch**: Worker fetches the next 20 IDs based on `currentPointer`.
2.  **Process**: Sends SMS/Email and logs result.
3.  **Recurse**: If more items remain, the worker **calls itself** via Cloud Tasks (or HTTP fetch in V2) to process the next batch.

### B. "Zombie Worker" Prevention (CRITICAL)
To prevent "zombie" processes that keep sending after a user clicks Stop, the worker implements a **Double-Check Strategy**:

1.  **Entry Check**: At the very start, if `status` is `cancelled` or `paused`, exit immediately.
2.  **Exit Check (The Zombie Killer)**: At the *end* of the batch, before updating the database or recursing, it **fetches the status again**.
    *   *Why?* A user might have clicked "Stop" while the batch was processing (e.g., during the 3-second delay).
    *   *Action*: If the fresh status is `cancelled`/`paused`, the worker aborts and **does not** schedule the next batch. This guaranteed termination.

### C. Session State Source
Features like Pause/Stop require the `companyId` and `sessionId`.
- **Frontend**: We do **NOT** rely on URL parameters (which can be unreliable). We rely on the global **DataContext** (`currentCompanyProfile.id`) to ensure the correct ID is always available.
