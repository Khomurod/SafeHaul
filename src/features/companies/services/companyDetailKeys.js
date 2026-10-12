/**
 * The flat fields a company the older Create screen made holds its details in.
 * Its flat `address`, the street line, gives way to the saved `address` object.
 *
 * Apart from `companyDetails.js` so that `companyService.js`, which the first
 * download carries, brings only this list along.
 */
export const FLAT_DETAIL_KEYS = Object.freeze(['phone', 'email', 'city', 'state', 'zip', 'mcNumber', 'dotNumber']);
