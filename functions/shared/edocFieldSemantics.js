/**
 * Canonical E-Docs signer-field vocabulary, shared by the AI field-placement
 * callable and its tests.
 *
 * This file MIRRORS the frontend contract in
 * `src/features/signing/components/envelope-creator/fieldDefinitions.jsx`
 * (FIELD_TEMPLATES) and `src/features/signing/utils/prefillEngine.js`
 * (BINDING_LABELS / buildPrefillContext). The two cannot import each other —
 * `functions/` is CommonJS and deployed separately — so any change here must be
 * made in both places. The frontend re-validates every suggestion it receives,
 * so this list is a server-side security control, not the only gate.
 *
 * Deliberately NOT extended with new persisted field types: only the five
 * signer field types the signing room, sealer and serializer already understand
 * may ever be produced.
 */

/** The only `type` values that may be persisted on a template/signing request. */
const SUPPORTED_FIELD_TYPES = ['signature', 'initial', 'date', 'text', 'checkbox'];

/** The only prefill binding keys the prefill engine resolves. */
const SUPPORTED_BINDING_KEYS = [
  'full_name',
  'first_name',
  'last_name',
  'email',
  'phone',
  'company_name',
  'address',
  'city',
  'state',
  'zip',
  'current_date',
];

/**
 * Semantic category → persisted field type + prefill binding.
 * These are the ONLY categories the model is allowed to return.
 */
const SEMANTIC_FIELD_MAP = {
  signature: { type: 'signature', bindingKey: '', label: 'Signature', required: true },
  initials: { type: 'initial', bindingKey: '', label: 'Initial', required: true },
  full_name: { type: 'text', bindingKey: 'full_name', label: 'Full name', required: true },
  first_name: { type: 'text', bindingKey: 'first_name', label: 'First name', required: true },
  last_name: { type: 'text', bindingKey: 'last_name', label: 'Last name', required: true },
  date: { type: 'date', bindingKey: 'current_date', label: 'Date signed', required: true },
  email: { type: 'text', bindingKey: 'email', label: 'Email', required: true },
  phone: { type: 'text', bindingKey: 'phone', label: 'Phone', required: false },
  company: { type: 'text', bindingKey: 'company_name', label: 'Company', required: false },
  address: { type: 'text', bindingKey: 'address', label: 'Address', required: false },
  city: { type: 'text', bindingKey: 'city', label: 'City', required: false },
  state: { type: 'text', bindingKey: 'state', label: 'State', required: false },
  zip: { type: 'text', bindingKey: 'zip', label: 'ZIP code', required: false },
  checkbox: { type: 'checkbox', bindingKey: '', label: 'Checkbox', required: false },
  text: { type: 'text', bindingKey: '', label: 'Text', required: false },
};

const SEMANTIC_CATEGORIES = Object.keys(SEMANTIC_FIELD_MAP);

/**
 * Structures the signer field model cannot represent. The model reports these
 * so the reviewer is warned instead of receiving a silently lossy conversion —
 * notably, a mutually exclusive choice must never become plain checkboxes
 * without the reviewer being told.
 */
const MANUAL_REVIEW_KINDS = [
  'radio_group',
  'dropdown',
  'multiline',
  'repeating_rows',
  'table',
];

module.exports = {
  SUPPORTED_FIELD_TYPES,
  SUPPORTED_BINDING_KEYS,
  SEMANTIC_FIELD_MAP,
  SEMANTIC_CATEGORIES,
  MANUAL_REVIEW_KINDS,
};
