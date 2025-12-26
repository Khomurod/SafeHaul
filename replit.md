# Overview

This is an HR Portal application designed for trucking companies to manage driver recruitment, applications, and lead distribution. The system allows multiple companies to manage their hiring pipelines while also featuring a centralized lead pool that distributes unassigned driver leads across participating companies. The platform includes role-based access control (Super Admin, Company Admin, HR User), automated lead rotation, activity tracking, and comprehensive analytics.

# User Preferences

Preferred communication style: Simple, everyday language.

# Project Structure

## Folder Organization

The frontend uses a feature-based folder structure for scalability and maintainability:

```
src/
├── app/                    # App-level configuration and routing
├── components/             # Legacy components (being migrated to features)
│   ├── admin/              # Admin UI components (BulkUploadLayout, ApplicationInfo, etc.)
│   ├── company/            # Company-related components
│   ├── feedback/           # Feedback components
│   ├── modals/             # Legacy modals (EditCompanyModal, EditUserModal, etc.)
│   ├── onboarding/         # Onboarding tour components
│   ├── public/             # Public-facing components
│   └── super-admin/        # Super admin view routing
├── context/                # React Context providers (DataContext)
├── features/               # Feature modules (primary code location)
│   ├── analytics/          # Analytics dashboards and metrics
│   ├── applications/       # Application management
│   ├── auth/               # Authentication (LoginScreen, userService)
│   ├── companies/          # Company dashboards and services
│   ├── company-admin/      # Company admin views and components
│   ├── drivers/            # Driver profiles and search
│   ├── onboarding/         # Onboarding tour logic
│   ├── settings/           # Company and user settings
│   └── super-admin/        # Super admin dashboard and views
├── firebase/               # Firebase SDK initialization
├── lib/                    # Library wrappers and utilities
│   └── firebase/           # Firebase helpers (auth, config, storage)
├── shared/                 # Cross-feature shared code
│   ├── components/         # Reusable UI components
│   │   ├── feedback/       # Toast, notifications, loading states
│   │   ├── modals/         # Shared modals
│   │   └── ui/             # Base UI components
│   ├── hooks/              # Shared custom hooks
│   └── utils/              # Helper functions and utilities
├── tests/                  # Test files
└── utils/                  # Legacy utilities (being migrated to shared)
```

## Feature Module Structure

Each feature module follows a consistent internal structure:

```
features/{feature-name}/
├── components/             # React components for this feature
│   └── index.js            # Component exports
├── hooks/                  # Custom hooks for this feature
│   └── index.js            # Hook exports
├── services/               # API/data services (optional)
└── index.js                # Public exports for the feature
```

## Path Aliases

Vite is configured with the following import aliases (defined in `vite.config.js`):

| Alias | Path | Usage |
|-------|------|-------|
| `@` | `./src` | Root source directory |
| `@app` | `./src/app` | App-level config |
| `@features` | `./src/features` | Feature modules |
| `@shared` | `./src/shared` | Shared components, hooks, utils |
| `@lib` | `./src/lib` | Library wrappers |
| `@assets` | `./attached_assets` | Static assets |

**Import Examples:**
```javascript
import { LoginScreen } from '@features/auth';
import { useCompanyDashboard } from '@features/companies';
import { ToastProvider } from '@shared/components/feedback';
import { useBulkImport } from '@shared/hooks';
```

# System Architecture

## Frontend Architecture

**Technology Stack:**
- React 19 with Vite as the build tool
- React Router DOM for client-side routing
- Tailwind CSS for styling with PostCSS and Autoprefixer
- Lucide React for icons

**Key Design Patterns:**
- Feature-based folder structure with barrel exports
- Context API for global state management (DataContext)
- Custom hooks for business logic separation and reusability
- Component composition with clear separation between presentation and logic
- Toast-based notification system for user feedback

**State Management:**
- Custom hooks encapsulate data fetching and mutations (e.g., `useApplicationDetails`, `useCompanyDashboard`)
- Shared context provides user authentication state and claims across the app
- Real-time Firestore listeners for live data updates (notifications, applications, leads)

**Routing Strategy:**
- SPA with client-side routing using React Router
- Vercel-specific rewrites configuration to handle client-side routes
- Role-based route protection based on Firebase custom claims

## Backend Architecture

**Technology Stack:**
- Firebase Functions (Node.js 20) for serverless backend logic
- Firebase Authentication for user management
- Cloud Firestore as the primary database
- Cloud Storage for file uploads (driver documents, company logos)
- Nodemailer for email notifications

**Security Model:**
- Custom claims on Firebase Auth tokens define user roles at both global and company-specific levels
- Claims structure: `{ globalRole: 'super_admin' | null, roles: { [companyId]: 'company_admin' | 'hr_user' } }`
- Cloud Functions validate permissions server-side before executing sensitive operations
- Firestore security rules (not shown but implied) enforce data access boundaries

**Cloud Functions Organization:**
The functions are modular and grouped by domain:

1. **Driver Synchronization (`driverSync.js`):** Firestore triggers that automatically create/update master driver profiles when leads or applications are submitted
2. **HR Administration (`hrAdmin.js`):** User and membership CRUD operations with membership-based custom claims management
3. **Company Administration (`companyAdmin.js`):** Company profile management, application movement between companies, and automated emails
4. **Lead Distribution (`leadDistribution.js`, `leadLogic.js`):** Sophisticated lead rotation engine with scheduled and manual distribution modes

**Lead Distribution Engine:**
The platform's core differentiator. Distributes unassigned driver leads from a central pool to participating companies using these rules:
- Rotation happens daily at midnight EST (scheduled) or manually (Super Admin)
- Companies are grouped and processed in chunks to prevent quota exhaustion
- Each company receives a fair share based on availability
- Leads have expiration windows (24 hours short, 7 days long) after which they return to the pool
- Cool-off periods prevent the same driver from being distributed too frequently
- Lock periods apply when drivers express interest or are hired

**Data Model Rationale:**
- **Nested Collections:** Applications and leads are stored as subcollections under companies (`companies/{companyId}/applications/{appId}`) for logical grouping and security
- **Global Lead Pool:** Unassigned leads exist in a top-level `leads` collection before distribution
- **Master Driver Profiles:** A separate `drivers` collection maintains canonical driver records, synchronized from multiple submission sources
- **Activity Logs:** Subcollections under leads/applications track all recruiter interactions for audit trails and analytics
- **Memberships Collection:** Separate from users to support many-to-many relationships between users and companies

## External Dependencies

**Firebase Services:**
- **Firebase Authentication:** User identity and custom claims for role-based access
- **Cloud Firestore:** NoSQL document database for all application data
- **Cloud Storage:** File hosting for driver documents (licenses, applications, MVRs) and company assets (logos)
- **Cloud Functions:** Serverless compute for backend logic, triggers, and scheduled tasks
- **Firebase Hosting (implied):** Static asset serving and Cloud Functions integration

**Third-Party Libraries:**
- **ExcelJS:** Client-side Excel file parsing for bulk lead imports
- **jsPDF:** Client-side PDF generation for driver application documents
- **Nodemailer:** Server-side email sending (via Cloud Functions)

**Build & Development Tools:**
- **Vite:** Fast development server and optimized production builds
- **ESLint:** Code quality and React-specific linting
- **Vitest:** Unit testing framework
- **Firebase Tools:** CLI for function deployment and emulator testing

**Deployment Platforms:**
- **Vercel:** Frontend hosting with custom rewrite rules for SPA routing
- **Google Cloud Platform:** Implicit hosting for Firebase Functions and Firestore

**Key Integrations:**
- Environment variables via Vite (`.env` file) store Firebase project configuration
- Google Sheets URL parsing for bulk import functionality (via `useBulkImport` hook)
- Notification system tracks callbacks and reminders with timestamp-based queries

# Recent Changes

**December 2024 - Login Screen Redesign:**
- Replaced driver/employer toggle login with a universal, professional login screen
- Added automatic profile detection: if user has only driver profile, routes to driver dashboard; if only employer, routes to employer dashboard
- Created RoleSelectionModal for users with both driver and employer profiles
- Added portal switching capability with `switchPortal()` function in DataContext
- Selection is persisted in localStorage for seamless return visits

**December 2024 - Codebase Cleanup:**
- Removed duplicate legacy folders (`src/firebase/`, `src/utils/`, `src/components/`)
- Standardized all imports to use path aliases (`@lib`, `@shared`, `@features`)
- Fixed filtering functionality on leads dashboard (Freight Type, State, Assignee filters now work)
- Improved system health diagnostics security (restricted to global super admins only)
- Fixed empty catch blocks to properly log errors

# Authentication Flow

The login flow uses intelligent profile-based routing:

1. **Single Profile Users:**
   - Driver only → Auto-redirect to `/driver/dashboard`
   - Employer only → Auto-redirect to `/company/dashboard`
   - Super Admin → Auto-redirect to `/super-admin`

2. **Dual Profile Users:**
   - Shows `RoleSelectionModal` to choose between Driver or Employer portal
   - Selection is persisted in localStorage (`selectedPortal`)
   - Users can switch portals via `switchPortal()` function

3. **DataContext Profile Flags:**
   - `hasDriverProfile` - True if user has a driver document in Firestore
   - `hasEmployerProfile` - True if user has company roles in claims
   - `canSwitchPortals` - True if user has both profiles

# Migration Notes

The codebase has been cleaned up with the following completed:
- All code now uses feature-based architecture under `src/features/`
- Shared components are in `src/shared/components/`
- Firebase utilities are consolidated in `src/lib/firebase/`
- Admin components (BulkUploadLayout, ESignatureAnimation) moved to `src/shared/components/admin/`

When adding new code, always place it in the appropriate feature module under `src/features/` or in `src/shared/` for cross-feature utilities.
