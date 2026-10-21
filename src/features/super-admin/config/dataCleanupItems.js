/**
 * The items of Maintenance → Data cleanup, in the order the owner runs them,
 * with the words the card shows. The server's `functions/maintenance/cleanup/`
 * modules say exactly what each one reads and writes; `counts` names every
 * number the server returns for an item, and `leftAlone` the ones that count
 * records the cleanup does not change.
 */
export const DATA_CLEANUP_ITEMS = Object.freeze([
    {
        id: 'testAccounts',
        title: 'Test accounts from the old Deep Diagnostic',
        description: 'The systest_…@example.com logins it created with a fixed password, its test companies, '
            + 'driver, public profiles and files. A record with a test name that is not marked as test data, '
            + 'and a Super Admin’s login, are left alone. If Check still finds something after a run, run it again.',
        counts: {
            logins: 'Logins',
            memberships: 'Memberships',
            userDocs: 'User records',
            companies: 'Test companies',
            drivers: 'Test drivers',
            publicProfiles: 'Public profiles',
            files: 'Files',
            skipped: 'Left alone: not clearly test data',
        },
        leftAlone: ['skipped'],
    },
    {
        id: 'ssnCopies',
        title: 'Old SSN copies',
        description: 'The encrypted SSN copy in each driver’s staging records, and the plain-text SSN some '
            + 'driver profiles still hold. Nothing reads either. Only the SSN field is deleted.',
        counts: {
            pendingUpdates: 'Staging records with an SSN',
            driverProfiles: 'Driver profiles with a plain-text SSN',
        },
        leftAlone: [],
    },
    {
        id: 'pevLinks',
        title: 'Old PEV links',
        description: 'The past employer’s form link and token stored on applications, leads and PEV request '
            + 'logs, where the whole team could open it. Requests still waiting for an answer keep working.',
        counts: {
            records: 'Applications and leads',
            activityLogs: 'Activity log entries',
        },
        leftAlone: [],
    },
    {
        id: 'leadFields',
        title: 'Old lead fields',
        description: 'Unassigned leads get the empty value the Unassigned filter looks for, leads with a phone '
            + 'get the digits the import’s duplicate check uses, and a driver type stored as a one-item list '
            + 'becomes plain text. A record with several driver types is only counted.',
        counts: {
            assignedTo: 'Unassigned leads to mark',
            normalizedPhone: 'Leads without the import’s phone digits',
            driverType: 'Driver types stored as a list',
            driverTypeSeveral: 'Left alone: several driver types',
        },
        leftAlone: ['driverTypeSeveral'],
    },
    {
        id: 'searchFields',
        title: 'Application search fields',
        description: 'Writes the search versions of the name, email, phone and numbers on applications where '
            + 'they are missing or out of date, as a new application gets them.',
        counts: {
            applications: 'Applications to update',
        },
        leftAlone: [],
    },
    {
        id: 'smtpCopies',
        title: 'Old SMTP password copies',
        description: 'Stores each company’s email password encrypted where email is sent from, then deletes '
            + 'the older copies on the company record. Email keeps sending with the same settings. A company '
            + 'whose password cannot be verified is left exactly as it is.',
        counts: {
            companies: 'Companies to change',
            resealed: 'Passwords to encrypt',
            copiedToConfig: 'Passwords to move',
            copiesRemoved: 'Old copies to delete',
            unverifiable: 'Left alone: could not verify',
        },
        leftAlone: ['unverifiable'],
    },
]);
