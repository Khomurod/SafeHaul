/**
 * The record the driver dossier shows under `?e2eDossier=loaded`, in E2E test
 * mode only (`useAppFetch`). E2E mode cannot reach Firestore, so without it the
 * dossier never gets past loading; with it the dossier opens on this record,
 * whatever row opened it, and the specs and screenshots see a loaded dossier.
 *
 * Everything here is made up: the person, the numbers (555-01xx), the companies
 * and the ids. The name is long on purpose, so a phone's one-line name is tested
 * on a name that does not fit.
 */

const ts = (iso) => {
    const millis = new Date(iso).getTime();
    return { seconds: Math.floor(millis / 1000), toMillis: () => millis, toDate: () => new Date(millis) };
};

/** A fresh copy each time, so nothing that changes a record changes the next one. */
export function e2eLoadedDossierRecord() {
    return {
        firstName: 'Maximiliano Alejandro',
        lastName: 'Castellanos-Whitfield',
        email: 'max.castellanos-whitfield@example.com',
        phone: '(512) 555-0187',
        status: 'Contact Attempt 2',
        assignedTo: 'e2e-company_admin',
        confirmationNumber: 'SAF-2026-MAXCW',
        createdAt: ts('2026-05-28T14:20:00Z'),
        submittedAt: ts('2026-05-28T14:20:00Z'),
        lastCallOutcome: 'Left Voicemail',
        lastContactedAt: ts('2026-06-02T16:05:00Z'),
        'sms-consent': 'yes',
        // Application tab: identity, license, safety, employment and consent.
        dob: '1986-09-14',
        street: '4810 Riverside Industrial Parkway, Apt 12B',
        city: 'San Antonio',
        state: 'TX',
        zip: '78219',
        cdlNumber: 'E2E-CDL-0187',
        cdlState: 'TX',
        cdlClass: 'A',
        cdlExpiration: '2029-03-31',
        'has-violations': 'no',
        'has-accidents': 'no',
        'agree-electronic': 'agreed',
        'agree-background-check': 'agreed',
        'agree-psp': 'agreed',
        'agree-clearinghouse': 'agreed',
        'final-certification': 'agreed',
        // Previous Employment tab: one verification sent, one not started.
        employers: [
            {
                companyName: 'Lone Star Refrigerated Logistics Cooperative',
                position: 'OTR Driver',
                city: 'Laredo',
                state: 'TX',
                startDate: '2021-04',
                endDate: '2026-04',
                reasonForLeaving: 'Wanted regional routes, home every weekend',
                mayContact: 'yes',
                verification: {
                    status: 'Sent',
                    method: 'Email',
                    history: [
                        { action: 'Sent via Portal', method: 'Email', recipient: 'safety@lonestar.example.com', timestamp: '2026-06-01T15:00:00.000Z' },
                    ],
                },
            },
            {
                companyName: 'Hill Country Flatbed Express',
                position: 'Regional Driver',
                city: 'Austin',
                state: 'TX',
                startDate: '2017-08',
                endDate: '2021-03',
                reasonForLeaving: 'The company closed',
                mayContact: 'yes',
            },
        ],
    };
}
