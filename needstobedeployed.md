# Deployment Guide — Bulk Actions Fixes

> **Date:** February 18, 2026  
> **Status:** Ready for deployment  
> **Target:** https://truckerapp-system.web.app  

---

## What Changed (Summary)

| # | Fix | Files Changed | Impact |
|---|-----|---------------|--------|
| 1 | **Historical SMS Backfill** | `functions/bulkActions/admin/backfillSmsSentPhones.js` (NEW), `functions/bulkActions/index.js`, `functions/index.js` | New callable function — no impact on existing features |
| 2 | **"Exclude Forever" Filter** | `src/features/campaigns/components/AudienceBuilder.jsx`, `src/features/campaigns/hooks/useCampaignTargeting.js`, `src/features/campaigns/components/VirtualLeadList.jsx`, `functions/bulkActions/services/analyticsService.js`, `functions/bulkActions/controllers/sessionController.js` | Old boolean checkbox → dropdown with 4 options |
| 3 | **Gmail Hardcoding** | `functions/bulkActions/workers/batchWorker.js` | Backward-compatible — defaults to Gmail if no host/port set |
| 4 | **CSV Import Count** | `src/features/campaigns/hooks/useCampaignTargeting.js` | Prevents unnecessary backend call for imports |

---

## Step 1: Deploy Cloud Functions

This deploys all the backend changes. Run **one command at a time** (due to CPU limits):

```powershell
cd c:\Users\Kholmurod\Desktop\SafeHaul-for-Gemini-Antigravity
firebase deploy --only functions
```

> ⚠️ **This will deploy ALL functions** (not just the changed ones). This is the safest approach since individual function deploys were failing. It will take a few minutes.

---

## Step 2: Deploy Frontend (Hosting)

This deploys the UI changes (the dropdown filter):

```powershell
cd c:\Users\Kholmurod\Desktop\SafeHaul-for-Gemini-Antigravity
npm run build
firebase deploy --only hosting
```

---

## Step 3: Run the Backfill (ONE-TIME MANUAL STEP)

After deploying, you need to run the backfill function **once per company** to populate the `sms_sent_phones` collection with historical data. This allows the "All Time (Never Re-send)" filter to work properly for past campaigns.

### How to run the backfill:

#### Option A: From the browser console (easiest)

1. Go to https://truckerapp-system.web.app
2. Log in as an admin
3. Open the browser developer tools (press `F12`)
4. Go to the **Console** tab
5. Paste this code and press Enter:

```javascript
// Replace YOUR_COMPANY_ID with your actual company ID from Firestore
const { getFunctions, httpsCallable } = await import('firebase/functions');
const functions = getFunctions();
const backfill = httpsCallable(functions, 'backfillSmsSentPhones');
const result = await backfill({ companyId: 'YOUR_COMPANY_ID' });
console.log('Backfill result:', result.data);
```

6. Wait for it to complete — it will log how many sessions were processed and how many phones were backfilled
7. **Repeat for each company** that has sent bulk SMS messages

#### Option B: From Firebase Console

1. Go to https://console.firebase.google.com/project/truckerapp-system/functions
2. Find the `backfillSmsSentPhones` function
3. You can test it from the Firebase Console's function testing interface
4. Pass the data: `{ "companyId": "YOUR_COMPANY_ID" }`

### How to find your Company IDs:

1. Go to https://console.firebase.google.com/project/truckerapp-system/firestore
2. Click on the `companies` collection
3. Each document ID in the left panel is a company ID
4. Copy each one and run the backfill for it

---

## Step 4: Verify Everything Works

After deployment:

1. **Go to** the Campaign Editor → Audience section
2. **Check** the "Exclude Previously Messaged" dropdown appears (instead of a checkbox)
3. **Verify** it shows 4 options: No Exclusion, Last 7 Days, Last 30 Days, All Time (Never Re-send)
4. **Try** switching between Upload and CRM tabs — both should show the same dropdown
5. **Verify** the recipient count changes when you select different exclusion options

### Verify the backfill:

1. Go to Firebase Console → Firestore
2. Navigate to `companies/{yourCompanyId}/sms_sent_phones`
3. Confirm that documents exist with phone numbers as IDs
4. Each document should have `lastSentAt`, `sessionId`, and `backfilled: true` fields

---

## What does NOT need to change

- ❌ **No Firestore security rules changes needed** — `sms_sent_phones` is only written by Cloud Functions
- ❌ **No Storage rules changes needed**
- ❌ **No environment variables need to be added or changed**
- ❌ **No database schema changes** — we're using existing collections

---

## Temporary File Cleanup

If you see these files in the `functions/` folder, they can be safely deleted (they were created during testing):

- `functions/test_output.txt`
- `functions/deploy_output.txt`

---
---

# Deployment Guide — Public Profile Sync Fix

> **Date:** February 18, 2026  
> **Status:** Code complete — needs Cloud Functions deployment  
> **Target:** https://truckerapp-system.web.app  

---

## What Changed (Summary)

| # | Fix | Files Changed | Impact |
|---|-----|---------------|--------|
| 1 | **Logo field name fix** in `syncPublicProfile` | `functions/companyAdmin.js` (line 227) | Was reading `newData.logoUrl` (doesn't exist), now correctly reads `newData.companyLogoUrl` |
| 2 | **Backfill function** `backfillPublicProfiles` | `functions/companyAdmin.js` (lines 149-203), `functions/index.js` (line 93) | New callable function — syncs ALL companies to `public_profiles` |
| 3 | **"Sync Public Profiles" button** in System Health | `src/features/super-admin/hooks/useSystemHealth.js`, `src/features/super-admin/components/SystemHealthView.jsx` | Purple button in Super Admin → System Health page |

---

## Step 1: Deploy Cloud Functions (ONE AT A TIME)

These two functions need deploying. Run them **one at a time** due to CPU limits:

```powershell
cd c:\Users\Kholmurod\Desktop\SafeHaul-for-Gemini-Antigravity

# Function 1: The trigger fix (corrects logo sync going forward)
firebase deploy --only functions:syncPublicProfile

# Wait for it to finish, then:

# Function 2: The backfill function (repairs all existing data)
firebase deploy --only functions:backfillPublicProfiles
```

> ⚠️ If you get an **HTTP 409** error on the second deploy, wait 1-2 minutes and retry. It means the previous deploy is still building.

---

## Step 2: Deploy Frontend (Hosting)

The frontend was already deployed, but if you need to redeploy:

```powershell
cd c:\Users\Kholmurod\Desktop\SafeHaul-for-Gemini-Antigravity
npm run build
firebase deploy --only hosting
```

---

## Step 3: Run the Public Profiles Backfill (ONE-TIME MANUAL STEP)

After deploying the Cloud Functions:

1. Go to https://truckerapp-system.web.app
2. Log in as **Super Admin**
3. Navigate to **System Health & Diagnostics**
4. Click the **purple "Sync Public Profiles"** button
5. Watch the terminal log below — it will show progress
6. When it says **"Profiles Synced ✓"**, all company data is repaired

> This is safe to run multiple times. It uses `merge: true` so it won't overwrite any data that's already correct.

---

## Step 4: Verify Everything Works

### Quick Check:
1. Go to Firebase Console → Firestore → `public_profiles` collection
2. Pick any company document and check that `logoUrl` is populated (not `null`)
3. Check that `appSlug` and `companyName` match the corresponding `companies` document

### Full Test:
1. Edit a company name or slug in Super Admin
2. Wait 5 seconds
3. Check the `public_profiles` doc for that company — it should auto-update
4. Try the driver app link (`/apply/{slug}`) — it should show the correct company

---

## What does NOT need to change

- ❌ **No Firestore security rules changes needed** — `public_profiles` already has `allow read: if true`
- ❌ **No Storage rules changes needed**
- ❌ **No environment variables needed**
- ❌ **No database schema changes**

---

## Temporary File Cleanup

The temporary `functions/backfill_runner.js` file was already deleted automatically. No cleanup needed.
