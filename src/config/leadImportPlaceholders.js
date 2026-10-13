/**
 * The values the lead import fills in for what a file does not give, so a new
 * lead and the preview read sensibly. The import worker writes them and the
 * lead upload recognises them: a re-import never writes one over an existing
 * lead's real value. (Placeholder emails: `placeholderDomains.js`.)
 */
export const LEAD_IMPORT_PLACEHOLDERS = Object.freeze({
    firstName: 'Unknown',
    lastName: 'Driver',
    driverType: 'unidentified',
});
