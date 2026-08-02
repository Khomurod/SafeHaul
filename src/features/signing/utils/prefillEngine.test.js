import { describe, expect, it } from 'vitest';
import {
  buildPrefillContext,
  resolveTemplateText,
  resolveFieldForSend,
  normalizePrefillPolicy,
  isFieldLocked,
  isPlainTextPrefillField,
  getPrefillGroupKey,
  buildEditablePrefillGroups,
  buildPrefillOverridesForSend,
  getCanonicalPrefillLabel,
  formatIsoDateAsPlaceholderLong,
} from './prefillEngine';

describe('prefillEngine', () => {
  it('replaces repeated placeholders globally', () => {
    const ctx = buildPrefillContext({
      recipientName: 'Ada Lovelace',
      recipientEmail: 'ada@example.com',
    });

    const resolved = resolveTemplateText(
      '{{full_name}} agrees that {{full_name}} can be contacted at {{email}}.',
      ctx
    );

    expect(resolved.value).toBe('Ada Lovelace agrees that Ada Lovelace can be contacted at ada@example.com.');
    expect(resolved.unresolvedTokens).toEqual([]);
  });

  it('marks locked required fields as blocking when unresolved', () => {
    const field = {
      id: 'driver_name',
      type: 'text',
      label: 'Driver Name',
      required: true,
      prefillPolicy: 'locked',
      defaultValue: '{{full_name}}',
    };

    const resolved = resolveFieldForSend(field, buildPrefillContext());

    expect(resolved.meta.shouldBlockMissingLockedRequired).toBe(true);
    expect(resolved.field.defaultValue).toBe('');
    expect(resolved.field.readOnly).toBe(false);
  });

  it('keeps editable prefilled fields editable', () => {
    const field = {
      id: 'driver_name',
      type: 'text',
      required: true,
      prefillPolicy: 'editable',
      defaultValue: '{{full_name}}',
    };

    const resolved = resolveFieldForSend(
      field,
      buildPrefillContext({ recipientName: 'Ada Lovelace' })
    );

    expect(resolved.field.defaultValue).toBe('Ada Lovelace');
    expect(resolved.field.readOnly).toBe(false);
    expect(resolved.meta.shouldBlockMissingLockedRequired).toBe(false);
  });

  it('supports bindingKey fallback when default template is empty', () => {
    const field = {
      id: 'company_name',
      type: 'text',
      required: false,
      prefillPolicy: 'locked',
      bindingKey: 'company_name',
      defaultValue: '',
    };

    const resolved = resolveFieldForSend(
      field,
      buildPrefillContext({ companyName: 'SafeHaul Logistics' })
    );

    expect(resolved.field.defaultValue).toBe('SafeHaul Logistics');
    expect(resolved.field.readOnly).toBe(true);
  });

  it('normalizes policy from readOnly fallback for legacy fields', () => {
    expect(normalizePrefillPolicy({ readOnly: true })).toBe('locked');
    expect(normalizePrefillPolicy({ readOnly: false })).toBe('editable');
    expect(isFieldLocked({ readOnly: true })).toBe(true);
    expect(isFieldLocked({ readOnly: false })).toBe(false);
  });
});

describe('E-Doc grouped template prefills', () => {
  const editableText = (overrides = {}) => ({
    type: 'text',
    prefillPolicy: 'editable',
    ...overrides,
  });

  const editableDate = (overrides = {}) => ({
    type: 'date',
    prefillPolicy: 'editable',
    ...overrides,
  });

  it('treats generic Text widgets as plain (no binding, no tokens)', () => {
    const field = editableText({
      id: 'x1',
      bindingKey: '',
      defaultValue: '',
      label: 'Clause',
    });
    expect(isPlainTextPrefillField(field)).toBe(true);
    expect(getPrefillGroupKey(field)).toBe(null);
  });

  it('does not treat token-backed text as plain text', () => {
    const field = editableText({
      id: 'n1',
      bindingKey: '',
      defaultValue: '{{full_name}}',
      label: 'Name',
    });
    expect(isPlainTextPrefillField(field)).toBe(false);
    expect(getPrefillGroupKey(field)).toBe('tokens:full_name');
  });

  it('prefers bindingKey over tokens when both exist', () => {
    const field = editableText({
      id: 'n1',
      bindingKey: 'full_name',
      defaultValue: '{{email}}',
      label: 'Also Name',
    });
    expect(getPrefillGroupKey(field)).toBe('binding:full_name');
  });

  it('merges multiple editable fields that share bindingKey', () => {
    const fields = [
      editableText({
        id: 'a',
        bindingKey: 'full_name',
        defaultValue: '{{full_name}}',
        label: 'Name',
      }),
      editableText({
        id: 'b',
        bindingKey: 'full_name',
        defaultValue: '{{full_name}}',
        label: 'Name',
      }),
    ];
    const { groups, plainFields } = buildEditablePrefillGroups(fields);
    expect(plainFields).toHaveLength(0);
    expect(groups).toHaveLength(1);
    expect(groups[0].members.map((m) => m.id).sort()).toEqual(['a', 'b']);
    expect(groups[0].appliesCount).toBe(2);
    expect(groups[0].uiLabel).toBe('Full name');
    expect(groups[0].useDateTriplet).toBe(false);
  });

  it('keeps two plain Text placements independent', () => {
    const fields = [
      editableText({ id: 't1', bindingKey: '', defaultValue: '', label: 'Notes' }),
      editableText({ id: 't2', bindingKey: '', defaultValue: '', label: 'Notes' }),
    ];
    const { groups, plainFields } = buildEditablePrefillGroups(fields);
    expect(groups).toHaveLength(0);
    expect(plainFields.map((p) => p.id).sort()).toEqual(['t1', 't2']);
  });

  it('groups token-only fields without bindingKey', () => {
    const fields = [
      editableText({
        id: 'e1',
        bindingKey: '',
        defaultValue: '{{email}}',
        label: 'Email line 1',
      }),
      editableText({
        id: 'e2',
        bindingKey: '',
        defaultValue: '{{email}}',
        label: 'Email line 2',
      }),
    ];
    const { groups } = buildEditablePrefillGroups(fields);
    expect(groups).toHaveLength(1);
    expect(groups[0].groupKey).toBe('tokens:email');
    expect(groups[0].members).toHaveLength(2);
  });

  it('excludes locked fields from editable partition', () => {
    const fields = [
      editableText({
        id: 'locked',
        bindingKey: 'full_name',
        defaultValue: '{{full_name}}',
        prefillPolicy: 'locked',
      }),
      editableText({
        id: 'open',
        bindingKey: 'full_name',
        defaultValue: '{{full_name}}',
        prefillPolicy: 'editable',
      }),
    ];
    const { groups } = buildEditablePrefillGroups(fields);
    expect(groups).toHaveLength(1);
    expect(groups[0].members.map((m) => m.id)).toEqual(['open']);
  });

  it('expands grouped override to every member field id', () => {
    const fields = [
      editableText({
        id: 'a',
        bindingKey: 'full_name',
        defaultValue: '{{full_name}}',
      }),
      editableText({
        id: 'b',
        bindingKey: 'full_name',
        defaultValue: '{{full_name}}',
      }),
      editableText({ id: 'p', bindingKey: '', defaultValue: '', label: 'Plain' }),
    ];
    const overrides = buildPrefillOverridesForSend(fields, {
      prefillValuesByGroupKey: { 'binding:full_name': 'Jordan Casey' },
      prefillValues: { p: 'Only once' },
    });
    expect(overrides.a).toBe('Jordan Casey');
    expect(overrides.b).toBe('Jordan Casey');
    expect(overrides.p).toBe('Only once');
  });

  it('does not emit overrides for empty grouped or plain values', () => {
    const fields = [
      editableText({
        id: 'a',
        bindingKey: 'full_name',
        defaultValue: '{{full_name}}',
      }),
      editableText({ id: 'p', bindingKey: '', defaultValue: '', label: 'Plain' }),
    ];
    const overrides = buildPrefillOverridesForSend(fields, {
      prefillValuesByGroupKey: { 'binding:full_name': '   ' },
      prefillValues: { p: '' },
    });
    expect(Object.keys(overrides)).toHaveLength(0);
  });

  it('uses DateTriplet groups and converts ISO to long US placeholder format', () => {
    const fields = [
      editableDate({
        id: 'd1',
        bindingKey: 'current_date',
        defaultValue: '{{current_date}}',
        label: 'Date Signed',
      }),
      editableDate({
        id: 'd2',
        bindingKey: 'current_date',
        defaultValue: '{{current_date}}',
        label: 'Date Signed',
      }),
    ];
    const { groups } = buildEditablePrefillGroups(fields);
    expect(groups).toHaveLength(1);
    expect(groups[0].useDateTriplet).toBe(true);

    const iso = '2026-05-07';
    expect(formatIsoDateAsPlaceholderLong(iso)).toMatch(/May/);
    expect(formatIsoDateAsPlaceholderLong(iso)).toMatch(/2026/);

    const overrides = buildPrefillOverridesForSend(fields, {
      prefillValuesByGroupKey: { 'binding:current_date': iso },
      prefillValues: {},
    });
    expect(overrides.d1).toBe(formatIsoDateAsPlaceholderLong(iso));
    expect(overrides.d2).toBe(formatIsoDateAsPlaceholderLong(iso));
  });

  it('isolates singleton date fields without binding/tokens', () => {
    const fields = [
      editableDate({
        id: 'lonely',
        bindingKey: '',
        defaultValue: '',
        label: 'Ad hoc date',
      }),
    ];
    const { groups, plainFields } = buildEditablePrefillGroups(fields);
    expect(plainFields).toHaveLength(0);
    expect(groups).toHaveLength(1);
    expect(groups[0].groupKey).toBe('singleton:lonely');
    expect(groups[0].useDateTriplet).toBe(true);
  });

  it('merges explicit prefillGroupKey across disparate bindings', () => {
    const fields = [
      editableText({
        id: 'x',
        bindingKey: 'full_name',
        prefillGroupKey: 'merged_slot',
        defaultValue: '{{full_name}}',
      }),
      editableText({
        id: 'y',
        bindingKey: 'email',
        prefillGroupKey: 'merged_slot',
        defaultValue: '{{email}}',
      }),
    ];
    const { groups } = buildEditablePrefillGroups(fields);
    expect(groups).toHaveLength(1);
    expect(groups[0].groupKey).toBe('explicit:merged_slot');
    expect(groups[0].members).toHaveLength(2);
    expect(getCanonicalPrefillLabel(groups[0].groupKey)).toBe('Merged Slot');
  });

  it('resolveFieldForSend receives expanded overrides for duplicate placements', () => {
    const ctx = buildPrefillContext({ recipientName: 'Ignored When Override', recipientEmail: 'x@y.z' });
    const fields = [
      {
        id: 'a',
        type: 'text',
        prefillPolicy: 'editable',
        bindingKey: 'full_name',
        defaultValue: '{{full_name}}',
        required: false,
      },
      {
        id: 'b',
        type: 'text',
        prefillPolicy: 'editable',
        bindingKey: 'full_name',
        defaultValue: '{{full_name}}',
        required: false,
      },
    ];
    const overrides = buildPrefillOverridesForSend(fields, {
      prefillValuesByGroupKey: { 'binding:full_name': 'Pat Override' },
      prefillValues: {},
    });
    const ra = resolveFieldForSend(fields[0], ctx, { overridesByFieldId: overrides });
    const rb = resolveFieldForSend(fields[1], ctx, { overridesByFieldId: overrides });
    expect(ra.field.defaultValue).toBe('Pat Override');
    expect(rb.field.defaultValue).toBe('Pat Override');
  });

  it('getCanonicalPrefillLabel returns empty for singleton keys', () => {
    expect(getCanonicalPrefillLabel('singleton:abc')).toBe('');
  });
});
