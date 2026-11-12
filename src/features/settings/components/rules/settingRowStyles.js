/*
 * The class lists every settings row shares (`SettingRows.jsx`, the rule rows
 * in `ApplicationRulesPanel.jsx`), so a title, its help and a row's inset look
 * the same in Rules and in Report uploads.
 */

/** A row's inset: 16px on a phone, 20 × 24px from 768px up. */
export const SETTING_ROW_INSET = 'p-ds-4 md:px-ds-6 md:py-ds-5';

/** A setting's title, and the help under it (at most 600px a line). */
export const SETTING_TITLE = 'text-ds-body font-semibold text-ds-content [text-wrap:pretty]';
export const SETTING_HELP = 'max-w-[37.5rem] text-ds-xs text-ds-content-secondary [text-wrap:pretty]';
