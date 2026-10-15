export { auth, db, functions } from './config.js';
// Storage is not exported here: anything this barrel exports reaches every page's
// first download. Import `storage` and `uploadCompanyLogo` from
// `@lib/firebase/storage`, which only the features that handle files load.
