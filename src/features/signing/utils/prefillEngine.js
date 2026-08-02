import { parseIsoDateParts } from '@shared/utils/dateFormHelpers';

const TOKEN_PATTERN = /{{\s*([a-zA-Z0-9_]+)\s*}}/g;

const isPresent = (value) => value !== null && value !== undefined && String(value).trim() !== '';

const normalizeString = (value) => {
  if (value === null || value === undefined) return '';
  return String(value);
};

const normalizeTokenKey = (value) => normalizeString(value).trim().toLowerCase();

const formatDateForPlaceholder = (date = new Date()) =>
  date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

export function extractTemplateTokens(template) {
  const text = normalizeString(template);
  const tokens = new Set();
  let match;

  TOKEN_PATTERN.lastIndex = 0;
  while ((match = TOKEN_PATTERN.exec(text)) !== null) {
    const key = normalizeTokenKey(match[1]);
    if (key) tokens.add(key);
  }

  return Array.from(tokens);
}

export function buildPrefillContext({
  recipientName = '',
  recipientEmail = '',
  recipientPhone = '',
  companyName = '',
  now = new Date(),
  extra = {},
} = {}) {
  const fullName = normalizeString(recipientName).trim();
  const email = normalizeString(recipientEmail).trim();
  const phone = normalizeString(recipientPhone).trim();
  const company = normalizeString(companyName).trim();

  const nameParts = fullName.split(/\s+/).filter(Boolean);
  const firstName = nameParts[0] || '';
  const lastName = nameParts.slice(1).join(' ');
  const fullDate = formatDateForPlaceholder(now);

  const baseContext = {
    full_name: fullName,
    first_name: firstName,
    last_name: lastName,
    name: fullName,
    email,
    phone,
    company_name: company,
    current_date: fullDate,
    date: fullDate,
    address: '',
    city: '',
    state: '',
    zip: '',
  };

  Object.entries(extra || {}).forEach(([key, value]) => {
    const normalizedKey = normalizeTokenKey(key);
    if (!normalizedKey) return;
    baseContext[normalizedKey] = normalizeString(value).trim();
  });

  return baseContext;
}

export function resolveTemplateText(template, context = {}) {
  const raw = normalizeString(template);
  const tokens = extractTemplateTokens(raw);
  const unresolvedTokens = [];

  TOKEN_PATTERN.lastIndex = 0;
  const value = raw.replace(TOKEN_PATTERN, (_, tokenKey) => {
    const key = normalizeTokenKey(tokenKey);
    const mapped = context[key];
    if (!isPresent(mapped)) {
      unresolvedTokens.push(key);
      return '';
    }
    return normalizeString(mapped);
  });

  return {
    value,
    tokens,
    unresolvedTokens: Array.from(new Set(unresolvedTokens)),
  };
}

export function normalizePrefillPolicy(field = {}) {
  if (field.prefillPolicy === 'locked') return 'locked';
  if (field.prefillPolicy === 'editable') return 'editable';
  return field.readOnly ? 'locked' : 'editable';
}

export function isFieldLocked(field = {}) {
  return normalizePrefillPolicy(field) === 'locked';
}

export function resolveFieldForSend(field = {}, context = {}, options = {}) {
  const policy = normalizePrefillPolicy(field);
  const overrideMap = options.overridesByFieldId || {};

  const hasOverride = Object.prototype.hasOwnProperty.call(overrideMap, field.id);
  const chosenTemplate = hasOverride ? overrideMap[field.id] : field.defaultValue;
  const templateText = normalizeString(chosenTemplate);

  const bindingKey = normalizeTokenKey(field.bindingKey);

  let resolved = resolveTemplateText(templateText, context);
  if (!templateText && bindingKey && isPresent(context[bindingKey])) {
    resolved = {
      value: normalizeString(context[bindingKey]),
      tokens: [],
      unresolvedTokens: [],
    };
  }

  const resolvedValue = resolved.value;
  const hasResolvedValue = isPresent(resolvedValue);
  const readOnly = policy === 'locked' && hasResolvedValue;
  const shouldBlockMissingLockedRequired =
    Boolean(field.required) && policy === 'locked' && !hasResolvedValue;

  return {
    field: {
      ...field,
      defaultValue: resolvedValue,
      readOnly,
      prefillPolicy: policy,
    },
    meta: {
      policy,
      tokens: resolved.tokens,
      unresolvedTokens: resolved.unresolvedTokens,
      hasResolvedValue,
      shouldBlockMissingLockedRequired,
    },
  };
}

/** BINDING_LABELS — canonical modal labels for E-Doc grouped prefills */
export const BINDING_LABELS = {
  full_name: 'Full name',
  first_name: 'First name',
  last_name: 'Last name',
  name: 'Name',
  email: 'Email',
  phone: 'Phone',
  company_name: 'Company',
  current_date: 'Date signed',
  date: 'Date',
  address: 'Address',
  city: 'City',
  state: 'State',
  zip: 'ZIP code',
};

const humanizeUnderscores = (s) =>
  normalizeString(s)
    .split('_')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

export function getCanonicalPrefillLabel(groupKey) {
  if (!groupKey || groupKey.startsWith('singleton:')) return '';

  if (groupKey.startsWith('explicit:')) {
    return humanizeUnderscores(groupKey.slice('explicit:'.length));
  }

  if (groupKey.startsWith('binding:')) {
    const k = groupKey.slice('binding:'.length);
    return BINDING_LABELS[k] || humanizeUnderscores(k);
  }

  if (groupKey.startsWith('tokens:')) {
    const first = groupKey.slice('tokens:'.length).split('|').filter(Boolean)[0];
    if (!first) return '';
    return BINDING_LABELS[first] || humanizeUnderscores(first);
  }

  return '';
}

/** Plain text widget — independent placeholders per occurrence (no binding/tokens). */
export function isPlainTextPrefillField(field = {}) {
  if (field.type !== 'text') return false;
  const bk = normalizeTokenKey(field.bindingKey || '');
  const tv = extractTemplateTokens(normalizeString(field.defaultValue));
  return !bk && tv.length === 0;
}

/**
 * Stable grouping key for template-send prefills. Returns null when each field must stay independent.
 */
export function getPrefillGroupKey(field = {}) {
  if (isPlainTextPrefillField(field)) return null;

  const explicit = normalizeTokenKey(field.prefillGroupKey || '');
  if (explicit) return `explicit:${explicit}`;

  const bk = normalizeTokenKey(field.bindingKey || '');
  if (bk) return `binding:${bk}`;

  const tokens = extractTemplateTokens(normalizeString(field.defaultValue))
    .map(normalizeTokenKey)
    .filter(Boolean)
    .sort();

  if (tokens.length > 0) return `tokens:${tokens.join('|')}`;

  return `singleton:${field.id}`;
}

/** ISO date → same long US format as signing placeholders (see formatDateForPlaceholder). */
export function formatIsoDateAsPlaceholderLong(iso) {
  const p = parseIsoDateParts(iso);
  if (!p) return normalizeString(iso);
  const d = new Date(p.year, p.month - 1, p.day);
  return formatDateForPlaceholder(d);
}

/**
 * Partitions editable text/date fields into grouped controls vs plain-text-per-slot fields.
 */
export function buildEditablePrefillGroups(fields = []) {
  const editable = fields.filter(
    (f) =>
      (f.type === 'text' || f.type === 'date') && normalizePrefillPolicy(f) === 'editable'
  );

  const plainFields = [];
  const groupsMap = new Map();

  for (const field of editable) {
    const gk = getPrefillGroupKey(field);
    if (gk === null) {
      plainFields.push(field);
      continue;
    }
    if (!groupsMap.has(gk)) {
      groupsMap.set(gk, { groupKey: gk, members: [] });
    }
    groupsMap.get(gk).members.push(field);
  }

  const groups = Array.from(groupsMap.values()).map((g) => ({
    ...g,
    uiLabel: getCanonicalPrefillLabel(g.groupKey) || g.members[0]?.label || g.members[0]?.id || 'Field',
    appliesCount: g.members.length,
    useDateTriplet: g.members.every((m) => m.type === 'date'),
  }));

  return { groups, plainFields };
}

export function initialGroupedPrefillState(groups = []) {
  const initial = {};
  for (const g of groups) {
    initial[g.groupKey] = '';
  }
  return initial;
}

export function initialPlainPrefillState(plainFields = []) {
  const initial = {};
  for (const f of plainFields) {
    initial[f.id] = normalizeString(f.defaultValue || '');
  }
  return initial;
}

/**
 * Expand grouped modal values into per-field overrides for resolveFieldForSend.
 */
export function buildPrefillOverridesForSend(
  fields = [],
  { prefillValues = {}, prefillValuesByGroupKey = {} } = {}
) {
  const overridesByFieldId = {};
  const { groups, plainFields } = buildEditablePrefillGroups(fields);

  for (const field of plainFields) {
    const raw = prefillValues[field.id];
    if (isPresent(raw)) overridesByFieldId[field.id] = normalizeString(raw);
  }

  for (const group of groups) {
    const raw = prefillValuesByGroupKey[group.groupKey];
    if (!isPresent(raw)) continue;

    let value = normalizeString(raw);
    if (group.useDateTriplet) {
      value = formatIsoDateAsPlaceholderLong(value);
    }

    for (const field of group.members) {
      overridesByFieldId[field.id] = value;
    }
  }

  return overridesByFieldId;
}

/**
 * Resolve every field for delivery in one pass, collecting the labels of
 * locked required fields whose prefill data is missing (senders must fix
 * those before the document can go out). Shared by the template send flow
 * (DocumentsManager) and the envelope creator so the block-list logic can
 * never drift between them.
 *
 * @returns {{ fields: object[], missingLockedRequired: string[] }}
 */
export function resolveFieldsForSend(fields = [], context = {}, options = {}) {
  const missingLockedRequired = [];
  const resolvedFields = fields.map((field) => {
    const resolved = resolveFieldForSend(field, context, options);
    if (resolved.meta.shouldBlockMissingLockedRequired) {
      missingLockedRequired.push(field.label || field.id || 'Unnamed field');
    }
    return resolved.field;
  });
  return { fields: resolvedFields, missingLockedRequired };
}
