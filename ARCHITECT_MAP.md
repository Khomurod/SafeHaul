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

## 2. Key Data Models
To keep the system in sync, the Frontend expects specific fields:
- **Companies**: Must have `planType` ('free'/'paid') to determine lead limits.
- **Leads**: Must have `unavailableUntil` (timestamp) to manage the shuffle logic.
- **Signing Requests**: Must have a `fields` array containing `xPosition`, `yPosition`, etc., as percentages.

## 3. The "Dealer" Distribution Engine (CRITICAL)
**DO NOT MODIFY THE LOGIC BELOW WITHOUT UNDERSTANDING THE "GHOST LEAD" PROTECTION.**

The Lead Distribution system (`functions/leadLogic.js`) uses a **"Dealer Architecture"**, not a simple shuffle. It operates on strict rules to prevent crashes and ensure quota delivery.

### A. The "Dealer" Logic
1.  **Iterative Dealing**: Instead of loading all leads into memory, the system iterates through companies one by one.
2.  **Transactional Assignment**: Every lead assignment is a standalone Firestore Transaction.
    * **Ghost Protection**: The transaction strictly checks `doc.exists` before writing. If a lead is missing (Ghost Lead), the transaction fails gracefully, logs a warning, and the Dealer immediately grabs the *next* candidate. **This prevents the entire batch from crashing.**
    * **Anti-Snipe**: Checks `unavailableUntil` inside the transaction to ensure no double-booking.

### B. Strict Quota Rules
The system calculates quotas in this specific order of priority:
1.  **Plan Type**:
    * `Paid` Plan = **200 Leads**
    * `Free` Plan = **50 Leads**
2.  **Manual Override**: The `dailyLeadQuota` field is ONLY used if it is **higher** than the Plan Default (e.g., a VIP set to 500). If `dailyLeadQuota` is 50 but the plan is Paid, the system forces **200**.

### C. Frontend Resolution
* **Pathing**: The Backend stores leads in `companies/{CompanyUID}/leads`.a
* **Slug Resolution**: The Frontend URL uses a "Slug" (e.g., `/dashboard/ray-star-llc`). The Frontend (`useCompanyDashboard.js`) **MUST** resolve this Slug to the actual `CompanyUID` before querying. Failure to do this will result in an empty dashboard even if leads exist.