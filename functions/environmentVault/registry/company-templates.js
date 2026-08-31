/**
 * Company-scoped integration credential templates.
 */

const { SENSITIVITY, REASONS } = require('./vocabulary');

// ---------------------------------------------------------------------------
// Company-scoped integration credential templates
//
// Each field gets its own row and its own permission policy. An integration
// document is never treated as one secret.
// ---------------------------------------------------------------------------

/** `companies/{companyId}/integrations/sms_provider` */
const SMS_PROVIDER_FIELDS = [
    {
        field: 'provider',
        displayName: 'SMS provider',
        description: 'Which SMS provider this company sends through (ringcentral or 8x8).',
        encrypted: false,
        sensitivity: SENSITIVITY.PUBLIC,
        editable: false,
        deletable: false,
        // The provider row carries the integration-level connectivity test, so
        // "Test integration" has exactly one home per company instead of one per
        // credential field.
        testable: true,
        editReason: REASONS.REFERENCED,
        deleteReason: REASONS.REFERENCED,
    },
    {
        field: 'clientId',
        inConfig: true,
        displayName: 'RingCentral client ID',
        description: 'RingCentral app client ID used for JWT login.',
        encrypted: true,
        sensitivity: SENSITIVITY.SENSITIVE,
        providers: ['ringcentral'],
        editable: true,
        deletable: false,
        deleteReason: REASONS.REFERENCED,
    },
    {
        field: 'clientSecret',
        inConfig: true,
        displayName: 'RingCentral client secret',
        description: 'RingCentral app client secret used for JWT login.',
        encrypted: true,
        sensitivity: SENSITIVITY.CRITICAL,
        providers: ['ringcentral'],
        editable: true,
        deletable: false,
        deleteReason: REASONS.REFERENCED,
    },
    {
        field: 'jwt',
        inConfig: true,
        displayName: 'RingCentral JWT',
        description: 'Account-level RingCentral JWT credential.',
        encrypted: true,
        sensitivity: SENSITIVITY.CRITICAL,
        providers: ['ringcentral'],
        editable: true,
        deletable: true,
        optional: true,
    },
    {
        field: 'apiKey',
        inConfig: true,
        displayName: '8x8 API key',
        description: '8x8 SMS API key, used directly as the bearer token.',
        encrypted: true,
        sensitivity: SENSITIVITY.CRITICAL,
        providers: ['8x8'],
        editable: true,
        deletable: false,
        deleteReason: REASONS.REFERENCED,
    },
    {
        field: 'apiSecret',
        inConfig: true,
        displayName: '8x8 API secret',
        description: '8x8 platform API secret, retained for platform API use.',
        encrypted: true,
        sensitivity: SENSITIVITY.CRITICAL,
        providers: ['8x8'],
        editable: true,
        deletable: true,
        optional: true,
    },
    {
        field: 'subAccountId',
        inConfig: true,
        displayName: '8x8 sub-account ID',
        description: '8x8 sub-account the SMS API sends under.',
        encrypted: true,
        sensitivity: SENSITIVITY.INTERNAL,
        providers: ['8x8'],
        editable: true,
        deletable: true,
        optional: true,
    },
    {
        field: 'phoneNumber',
        inConfig: true,
        displayName: 'Configured sender number',
        description: 'Sender number stored on the provider configuration.',
        encrypted: true,
        sensitivity: SENSITIVITY.INTERNAL,
        editable: true,
        deletable: true,
        optional: true,
    },
    {
        field: 'senderId',
        inConfig: true,
        displayName: 'Alphanumeric sender ID',
        description: 'Non-US alphanumeric sender identifier used when no sender number is configured.',
        encrypted: true,
        sensitivity: SENSITIVITY.INTERNAL,
        editable: true,
        deletable: true,
        addable: true,
        optional: true,
    },
    {
        field: 'isSandbox',
        inConfig: true,
        displayName: 'Sandbox mode',
        description: 'When true, the RingCentral adapter targets the sandbox platform instead of production.',
        encrypted: false,
        sensitivity: SENSITIVITY.PUBLIC,
        editable: true,
        deletable: false,
        deleteReason: REASONS.REFERENCED,
        valueType: 'boolean',
    },
    {
        field: 'defaultPhoneNumber',
        displayName: 'Default line',
        description: 'Line used when a send has no explicit or assigned number.',
        encrypted: false,
        sensitivity: SENSITIVITY.INTERNAL,
        editable: false,
        deletable: false,
        editReason: REASONS.READ_ONLY_GENERATED,
        deleteReason: REASONS.REFERENCED,
    },
];

/** `companies/{companyId}/integrations/sms_provider/keychain/{phone}` */
const SMS_KEYCHAIN_FIELDS = [
    {
        field: 'jwt',
        displayName: 'Dedicated line JWT',
        description: 'Per-line RingCentral JWT stored in the private keychain.',
        encrypted: true,
        sensitivity: SENSITIVITY.CRITICAL,
        editable: false,
        deletable: false,
        editReason: 'Replace the line through the Digital Wallet so its JWT is re-verified',
        deleteReason: REASONS.REFERENCED,
    },
    {
        field: 'clientId',
        displayName: 'Dedicated line client ID',
        description: 'Per-line RingCentral client ID, present only when the line has dedicated credentials.',
        encrypted: true,
        sensitivity: SENSITIVITY.SENSITIVE,
        optional: true,
        editable: false,
        deletable: false,
        editReason: 'Replace the line through the Digital Wallet so its JWT is re-verified',
        deleteReason: REASONS.REFERENCED,
    },
    {
        field: 'clientSecret',
        displayName: 'Dedicated line client secret',
        description: 'Per-line RingCentral client secret, present only when the line has dedicated credentials.',
        encrypted: true,
        sensitivity: SENSITIVITY.CRITICAL,
        optional: true,
        editable: false,
        deletable: false,
        editReason: 'Replace the line through the Digital Wallet so its JWT is re-verified',
        deleteReason: REASONS.REFERENCED,
    },
];

/** `companies/{companyId}/system_settings/email_config` */
const EMAIL_CONFIG_FIELDS = [
    {
        field: 'smtpHost',
        displayName: 'SMTP host',
        description: 'Outbound mail server hostname.',
        encrypted: false,
        sensitivity: SENSITIVITY.INTERNAL,
        editable: false,
        deletable: false,
        editReason: 'Edit through Company Settings so the connection is re-tested',
        deleteReason: REASONS.REFERENCED,
    },
    {
        field: 'smtpPort',
        displayName: 'SMTP port',
        description: 'Outbound mail server port.',
        encrypted: false,
        sensitivity: SENSITIVITY.PUBLIC,
        editable: false,
        deletable: false,
        editReason: 'Edit through Company Settings so the connection is re-tested',
        deleteReason: REASONS.REFERENCED,
    },
    {
        field: 'smtpUser',
        displayName: 'SMTP username',
        description: 'Account the mail server authenticates.',
        encrypted: false,
        sensitivity: SENSITIVITY.INTERNAL,
        editable: false,
        deletable: false,
        editReason: 'Edit through Company Settings so the connection is re-tested',
        deleteReason: REASONS.REFERENCED,
    },
    {
        field: 'smtpPass',
        displayName: 'SMTP password',
        description: 'Mail server password. Stored in plaintext on an admin-only subcollection by deliberate decision — see functions/saveEmailSettings.js.',
        encrypted: false,
        sensitivity: SENSITIVITY.CRITICAL,
        editable: false,
        deletable: false,
        editReason: 'Edit through Company Settings so the connection is re-tested',
        deleteReason: REASONS.REFERENCED,
    },
];

/** `integrations_index/{pageId}` — connected Facebook Lead Ads page. */
const FACEBOOK_PAGE_FIELDS = [
    {
        field: 'accessToken',
        displayName: 'Facebook page access token',
        description: 'Long-lived page token issued by the Facebook OAuth exchange and used to read submitted leads.',
        encrypted: false,
        sensitivity: SENSITIVITY.CRITICAL,
        editable: false,
        deletable: false,
        editReason: REASONS.READ_ONLY_GENERATED,
        deleteReason: REASONS.REFERENCED,
    },
    {
        field: 'pageName',
        displayName: 'Facebook page name',
        description: 'Display name of the connected Facebook page.',
        encrypted: false,
        sensitivity: SENSITIVITY.PUBLIC,
        editable: false,
        deletable: false,
        editReason: REASONS.READ_ONLY_GENERATED,
        deleteReason: REASONS.REFERENCED,
    },
];

const COMPANY_TEMPLATES = Object.freeze({
    sms_provider: Object.freeze({
        id: 'sms_provider',
        integration: 'SMS provider',
        docLabel: 'SMS provider configuration',
        fields: SMS_PROVIDER_FIELDS,
    }),
    sms_keychain: Object.freeze({
        id: 'sms_keychain',
        integration: 'SMS dedicated line',
        docLabel: 'SMS dedicated-line keychain',
        fields: SMS_KEYCHAIN_FIELDS,
    }),
    email_config: Object.freeze({
        id: 'email_config',
        integration: 'Company SMTP email',
        docLabel: 'Email configuration',
        fields: EMAIL_CONFIG_FIELDS,
    }),
    facebook_page: Object.freeze({
        id: 'facebook_page',
        integration: 'Facebook Lead Ads',
        docLabel: 'Connected Facebook page',
        fields: FACEBOOK_PAGE_FIELDS,
    }),
});

module.exports = { COMPANY_TEMPLATES };
