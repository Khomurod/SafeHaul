// functions/searchHandler.js
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { db } = require("./firebaseAdmin");

const RUNTIME_OPTS = {
    timeoutSeconds: 30,
    memory: '256MiB',
    maxInstances: 10,
    cors: true
};

exports.searchUnifiedData = onCall(RUNTIME_OPTS, async (request) => {
    // 1. Security Check: Super Admin Only
    if (!request.auth || request.auth.token.roles?.globalRole !== 'super_admin') {
        throw new HttpsError("permission-denied", "Super Admin access required.");
    }

    const { query } = request.data;
    if (!query || query.length < 2) {
        return { success: true, data: { companies: [], users: [], leads: [] } };
    }

    const term = query.trim();
    const termLower = term.toLowerCase();
    // Simple Capitalization for Name searches (e.g. "smith" -> "Smith")
    const termCap = term.charAt(0).toUpperCase() + term.slice(1).toLowerCase();

    console.log(`🔍 Global Search for: "${term}"`);

    try {
        const results = {
            companies: [],
            users: [],
            leads: []
        };

        // 2. Run Parallel Searches
        // We use simple prefix search (term <= X <= term + \uf8ff)
        const [companiesSnap, usersNameSnap, usersEmailSnap, leadsSnap] = await Promise.all([
            // A. Companies (by Name) - Case sensitive, try capitalized and raw
            db.collection("companies")
                .where("companyName", ">=", term)
                .where("companyName", "<=", term + "\uf8ff")
                .limit(5)
                .get(),

            // B. Users (by Name)
            db.collection("users")
                .where("name", ">=", term)
                .where("name", "<=", term + "\uf8ff")
                .limit(5)
                .get(),

            // C. Users (by Email) - Always lowercase in auth/db usually
            db.collection("users")
                .where("email", ">=", termLower)
                .where("email", "<=", termLower + "\uf8ff")
                .limit(5)
                .get(),

            // D. Leads (by Last Name) - Across ALL companies
            // Note: This requires a Firestore Index on 'lastName' for Collection Groups
            db.collectionGroup("leads")
                .where("lastName", ">=", termCap)
                .where("lastName", "<=", termCap + "\uf8ff")
                .limit(10)
                .get()
        ]);

        // 3. Process & Deduplicate Results

        // Companies
        companiesSnap.forEach(doc => {
            const d = doc.data();
            results.companies.push({ 
                id: doc.id, 
                companyName: d.companyName, 
                appSlug: d.appSlug,
                planType: d.planType || 'free',
                type: 'company' 
            });
        });

        // Users (Deduplicate by ID since we searched Name AND Email)
        const userIds = new Set();
        const processUser = (doc) => {
            if (!userIds.has(doc.id)) {
                userIds.add(doc.id);
                const d = doc.data();
                results.users.push({ 
                    id: doc.id, 
                    name: d.name, 
                    email: d.email, 
                    role: d.role || 'user',
                    type: 'user' 
                });
            }
        };
        usersNameSnap.forEach(processUser);
        usersEmailSnap.forEach(processUser);

        // Leads
        leadsSnap.forEach(doc => {
            const d = doc.data();
            // Determine parent company ID from reference path
            // Path: companies/{companyId}/leads/{leadId}
            const parentCollection = doc.ref.parent;
            const companyId = parentCollection.parent ? parentCollection.parent.id : 'unknown';

            results.leads.push({
                id: doc.id,
                firstName: d.firstName,
                lastName: d.lastName,
                email: d.email,
                phone: d.phone,
                status: d.status,
                companyId: companyId,
                type: 'lead'
            });
        });

        return { success: true, data: results };

    } catch (error) {
        console.error("Search Error:", error);
        throw new HttpsError("internal", error.message);
    }
});