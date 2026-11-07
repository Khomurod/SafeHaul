import { isPlaceholderEmail } from '@/config/placeholderDomains';
import { isWellFormedEmail } from './validation';

/**
 * Whether a screen should offer to email a driver their link at `email`.
 *
 * The server decides (`functions/shared/linkDelivery.js`, `deliverableEmail`): a
 * real address on the record, never a placeholder an import made up. This only
 * decides whether the button is there, so a row with no address says why instead
 * of offering a press that can only be refused. `isWellFormedEmail` is the
 * server's `isValidEmail` rule (`emailValidation.parity.test.js`).
 */
export function canEmailLinkTo(email) {
    const value = typeof email === 'string' ? email.trim() : '';
    return !isPlaceholderEmail(value) && isWellFormedEmail(value);
}

export default canEmailLinkTo;
