// functions/schemaConfig.js

/**
 * SAFEHAUL SCHEMA CONFIGURATION
 * * This file acts as the "Source of Truth" for the System Integrity Manager.
 * It defines the mandatory fields and default values for core database entities.
 * * Used by: systemIntegrity.js -> syncSystemStructure()
 */

const SCHEMA_DEFINITIONS = {
    // 1. COMPANY DOCUMENT SCHEMA
    company: {
        fields: {
            // Subscription & Quotas
            planType: "free",           // Critical for Lead Distribution
            dailyLeadQuota: 50,         // Critical for Quota Logic

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

    // 2. LEAD DOCUMENT SCHEMA (Global Pool)
    lead: {
        fields: {
            // Status & Rotation Logic
            status: "active",
            unavailableUntil: null,     // Critical for "Shuffle" logic
            visitedCompanyIds: [],      // Critical for preventing duplicates

            // Source Tracking
            source: "System Import",
            isPlatformLead: false,      // False = Global Pool, True = Assigned

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