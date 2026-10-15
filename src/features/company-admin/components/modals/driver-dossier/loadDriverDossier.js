// The dossier's code is a chunk of its own. `DriverDossier` loads it on the first
// open; a page where a record is likely to be opened can load it earlier.
export const loadDriverDossier = () => import('./DriverProfileModal');
