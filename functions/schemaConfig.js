// functions/schemaConfig.js

/**
 * SAFEHAUL SCHEMA CONFIGURATION
 * Read by nothing since syncSystemStructure was retired (2026-10-11). It stays
 * only as the deploy planner test's fixture (scripts/test-deploy-incremental.mjs)
 * until the dead-code step removes both.
 */

const SCHEMA_DEFINITIONS = {
    // 1. COMPANY DOCUMENT SCHEMA
    company: {
        fields: {
            // Subscription
            planType: "free",

            // Profile Basics
            companyName: "Untitled Company",
            isActive: true,
            createdAt: "TIMESTAMP",      // Will be replaced with ServerTimestamp if missing

            // Flags
            isVerified: false
        },
        // Ensures these subcollections are initialized (conceptually)
        requiredSubcollections: ["leads", "applications", "team", "templates"]
    },

    // 2. LEAD DOCUMENT SCHEMA (Company Scoped)
    lead: {
        fields: {
            // Status
            status: "active",

            // Source Tracking
            source: "System Import",

            // Timestamps
            createdAt: "TIMESTAMP",
            updatedAt: "TIMESTAMP"
        }
    },

    // 3. USER DOCUMENT SCHEMA
    user: {
        fields: {
            // Access Control
            role: "driver",             // Default role
            globalRole: "user",         // 'super_admin' or 'user'

            // State
            isProfileComplete: false,
            createdAt: "TIMESTAMP"
        }
    },

    // 4. APPLICATION SCHEMA (Company Subcollection)
    application: {
        fields: {
            status: "New Application",
            isArchived: false,
            driverId: null,             // Link to Global User
            submittedAt: "TIMESTAMP"
        }
    }
};

module.exports = { SCHEMA_DEFINITIONS };