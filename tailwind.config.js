/*
 * The generated 49 CFR §391.23 document's print values, frozen.
 *
 * `VOEDocument.jsx` is immutable legal content (design-system roadmap §5): a
 * themeable role must never restyle an exported verification. Its colours,
 * type sizes, radii, shadow and watermark layer are Tailwind 3.4's own defaults,
 * copied here as literals under a `voe` name, so the strict theme below keeps
 * the document exactly as it renders and no change to the theme or to Tailwind
 * can move it. Only `VOEDocument.jsx` uses them.
 */
const VOE_PRINT = {
  colors: {
    white: '#fff',
    gray: { 300: '#d1d5db' },
    slate: {
      50: '#f8fafc', 100: '#f1f5f9', 200: '#e2e8f0', 300: '#cbd5e1', 400: '#94a3b8',
      500: '#64748b', 600: '#475569', 700: '#334155', 800: '#1e293b', 900: '#0f172a',
    },
    blue: { 500: '#3b82f6', 600: '#2563eb' },
    red: { 50: '#fef2f2', 400: '#f87171', 500: '#ef4444', 600: '#dc2626' },
  },
  fontSize: {
    'voe-xs': ['0.75rem', { lineHeight: '1rem' }],
    'voe-sm': ['0.875rem', { lineHeight: '1.25rem' }],
    'voe-lg': ['1.125rem', { lineHeight: '1.75rem' }],
    'voe-xl': ['1.25rem', { lineHeight: '1.75rem' }],
    'voe-2xl': ['1.5rem', { lineHeight: '2rem' }],
    'voe-4xl': ['2.25rem', { lineHeight: '2.5rem' }],
  },
  borderRadius: {
    'voe-sm': '0.125rem',
    voe: '0.25rem',
    'voe-lg': '0.5rem',
    'voe-xl': '0.75rem',
  },
  boxShadow: {
    'voe-xl': '0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)',
  },
  zIndex: {
    'voe-watermark': '-10',
  },
};

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
    /*
     * Storybook stories are excluded from the APPLICATION's stylesheet.
     *
     * Tailwind's extractor pulls candidate class names out of any scanned file,
     * including prose. A story that merely writes the word "shadow" in its
     * documentation caused a `.shadow` rule to be compiled into the shipped
     * `dist/assets/main-*.css` — dead weight the application never uses, and an
     * unintended change to a production artifact.
     *
     * The catalog still gets full Tailwind coverage of these files: Storybook
     * runs Tailwind with `.storybook/tailwind.config.js`, which re-adds them.
     * Keep the two in step — a utility class used only in a story renders in
     * Storybook and is deliberately absent from the app bundle.
     */
    "!./src/**/*.stories.jsx",
  ],
  theme: {
    /*
     * A strict theme. Colours, type sizes, radii, shadows and stacking layers are
     * the `--ds-*` roles and nothing else, so a Tailwind default such as
     * `bg-white`, `text-sm`, `rounded-lg`, `shadow-md` or `z-10` compiles to no
     * CSS at all. Each of these scales is declared at the top level of `theme`,
     * which replaces Tailwind's own; `extend` below adds the `--ds-*` roles to
     * Tailwind's spacing, opacity and height scales, which stay.
     *
     * Kept beside the roles: `transparent`, `currentColor`, `inherit`, `none`
     * and `auto`, which are values rather than a palette, and the VOE
     * document's frozen print values (`VOE_PRINT` above).
     */
    colors: {
      transparent: 'transparent',
      current: 'currentColor',
      inherit: 'inherit',
      'ds-canvas': 'var(--ds-color-canvas)',
      'ds-surface': 'var(--ds-color-surface)',
      'ds-surface-subtle': 'var(--ds-color-surface-subtle)',
      'ds-content': 'var(--ds-color-content)',
      'ds-content-secondary': 'var(--ds-color-content-secondary)',
      'ds-content-muted': 'var(--ds-color-content-muted)',
      'ds-content-inverse': 'var(--ds-color-content-inverse)',
      'ds-content-link': 'var(--ds-color-content-link)',
      // Gaps found by the 2026-08 UI audit: feature code reached for a raw
      // palette class because these roles had no utility to reach for.
      'ds-content-danger': 'var(--ds-color-content-danger)',
      'ds-surface-hover': 'var(--ds-color-surface-hover)',
      'ds-surface-selected': 'var(--ds-color-surface-selected)',
      'ds-border-strong': 'var(--ds-color-border-strong)',
      'ds-action-secondary': 'var(--ds-color-action-secondary)',
      'ds-action-secondary-hover': 'var(--ds-color-action-secondary-hover)',
      'ds-action-danger-hover': 'var(--ds-color-action-danger-hover)',
      'ds-action-success': 'var(--ds-color-action-success)',
      'ds-action-success-hover': 'var(--ds-color-action-success-hover)',
      'ds-table-header-bg': 'var(--ds-table-header-bg)',
      'ds-table-header-fg': 'var(--ds-table-header-fg)',
      'ds-table-row-hover-bg': 'var(--ds-table-row-hover-bg)',
      'ds-table-row-selected-bg': 'var(--ds-table-row-selected-bg)',
      'ds-table-divider': 'var(--ds-table-divider)',
      'ds-overlay': 'var(--ds-color-overlay)',
      'ds-surface-inverse': 'var(--ds-color-surface-inverse)',
      'ds-surface-inverse-subtle': 'var(--ds-color-surface-inverse-subtle)',
      'ds-border-inverse': 'var(--ds-color-border-inverse)',
      'ds-content-on-inverse': 'var(--ds-color-content-on-inverse)',
      'ds-content-on-inverse-muted': 'var(--ds-color-content-on-inverse-muted)',
      'ds-status-info-fg-on-inverse': 'var(--ds-color-status-info-fg-on-inverse)',
      'ds-status-success-fg-on-inverse': 'var(--ds-color-status-success-fg-on-inverse)',
      'ds-status-warning-fg-on-inverse': 'var(--ds-color-status-warning-fg-on-inverse)',
      'ds-status-danger-fg-on-inverse': 'var(--ds-color-status-danger-fg-on-inverse)',
      'ds-surface-inverse-hover': 'var(--ds-color-surface-inverse-hover)',
      'ds-brand-primary': 'var(--ds-color-brand-primary)',
      'ds-brand-accent': 'var(--ds-color-brand-accent)',
      'ds-brand-accent-soft': 'var(--ds-color-brand-accent-soft)',
      'ds-border': 'var(--ds-color-border)',
      'ds-border-subtle': 'var(--ds-color-border-subtle)',
      'ds-focus': 'var(--ds-color-focus)',
      'ds-action-primary': 'var(--ds-color-action-primary)',
      'ds-action-primary-hover': 'var(--ds-color-action-primary-hover)',
      'ds-action-danger': 'var(--ds-color-action-danger)',
      'ds-status-info-bg': 'var(--ds-color-status-info-bg)',
      'ds-status-info-fg': 'var(--ds-color-status-info-fg)',
      'ds-status-info-border': 'var(--ds-color-status-info-border)',
      'ds-status-accent-bg': 'var(--ds-color-status-accent-bg)',
      'ds-status-accent-fg': 'var(--ds-color-status-accent-fg)',
      'ds-status-accent-border': 'var(--ds-color-status-accent-border)',
      'ds-status-success-bg': 'var(--ds-color-status-success-bg)',
      'ds-status-success-fg': 'var(--ds-color-status-success-fg)',
      'ds-status-success-border': 'var(--ds-color-status-success-border)',
      'ds-status-warning-bg': 'var(--ds-color-status-warning-bg)',
      'ds-status-warning-fg': 'var(--ds-color-status-warning-fg)',
      'ds-status-warning-border': 'var(--ds-color-status-warning-border)',
      'ds-status-danger-bg': 'var(--ds-color-status-danger-bg)',
      'ds-status-danger-fg': 'var(--ds-color-status-danger-fg)',
      'ds-status-danger-border': 'var(--ds-color-status-danger-border)',
      'ds-status-neutral-bg': 'var(--ds-color-status-neutral-bg)',
      'ds-status-neutral-fg': 'var(--ds-color-status-neutral-fg)',
      'ds-status-neutral-border': 'var(--ds-color-status-neutral-border)',
      voe: VOE_PRINT.colors,
    },

    fontSize: {
      'ds-xs': ['var(--ds-font-size-xs)', { lineHeight: 'var(--ds-line-height-body)' }],
      'ds-sm': ['var(--ds-font-size-sm)', { lineHeight: 'var(--ds-line-height-body)' }],
      'ds-body': ['var(--ds-font-size-body)', { lineHeight: 'var(--ds-line-height-body)' }],
      'ds-body-lg': ['var(--ds-font-size-body-lg)', { lineHeight: 'var(--ds-line-height-body)' }],
      'ds-heading-sm': ['var(--ds-font-size-heading-sm)', { lineHeight: 'var(--ds-line-height-tight)' }],
      'ds-heading-md': ['var(--ds-font-size-heading-md)', { lineHeight: 'var(--ds-line-height-tight)' }],
      'ds-heading-lg': ['var(--ds-font-size-heading-lg)', { lineHeight: 'var(--ds-line-height-tight)' }],
      'ds-heading-xl': ['var(--ds-font-size-heading-xl)', { lineHeight: 'var(--ds-line-height-tight)' }],
      // Not a step of the scale: iOS Safari's no-zoom size, for a control that
      // cannot be `.ds-form-control`. See `--ds-font-size-control-mobile`.
      'ds-control-mobile': ['var(--ds-font-size-control-mobile)', { lineHeight: 'var(--ds-line-height-body)' }],
      ...VOE_PRINT.fontSize,
    },

    borderRadius: {
      none: '0px',
      'ds-sm': 'var(--ds-radius-sm)',
      'ds-md': 'var(--ds-radius-md)',
      'ds-lg': 'var(--ds-radius-lg)',
      'ds-xl': 'var(--ds-radius-xl)',
      'ds-full': 'var(--ds-radius-full)',
      'ds-card': 'var(--ds-card-radius)',
      ...VOE_PRINT.borderRadius,
    },

    boxShadow: {
      none: '0 0 #0000',
      'ds-xs': 'var(--ds-shadow-xs)',
      'ds-sm': 'var(--ds-shadow-sm)',
      'ds-md': 'var(--ds-shadow-md)',
      'ds-lg': 'var(--ds-shadow-lg)',
      'ds-focus': 'var(--ds-focus-ring)',
      ...VOE_PRINT.boxShadow,
    },

    /*
     * The stacking layers as utilities, so a class list can name one instead
     * of outbidding the last number it lost to. See `foundation.css` — the
     * tree carried fourteen different raw values, `z-[9999]` among them.
     */
    zIndex: {
      auto: 'auto',
      'ds-raised': 'var(--ds-z-raised)',
      'ds-sticky': 'var(--ds-z-sticky)',
      'ds-dropdown': 'var(--ds-z-dropdown)',
      'ds-drawer-backdrop': 'var(--ds-z-drawer-backdrop)',
      'ds-drawer': 'var(--ds-z-drawer)',
      'ds-modal': 'var(--ds-z-modal)',
      'ds-toast': 'var(--ds-z-toast)',
      // Local layers — see `foundation.css`. They order siblings inside one
      // stacking context and mean nothing outside it.
      'ds-layer-1': 'var(--ds-z-layer-1)',
      'ds-layer-2': 'var(--ds-z-layer-2)',
      'ds-layer-3': 'var(--ds-z-layer-3)',
      'ds-layer-4': 'var(--ds-z-layer-4)',
      ...VOE_PRINT.zIndex,
    },

    extend: {
      /*
       * Disabled dimming as a utility, so a JSX control can reach the same role
       * a stylesheet does instead of picking `opacity-75` and hoping.
       */
      opacity: {
        'ds-disabled': 'var(--ds-opacity-disabled)',
        'ds-disabled-soft': 'var(--ds-opacity-disabled-soft)',
      },

      spacing: {
        'ds-1': 'var(--ds-space-1)',
        'ds-2': 'var(--ds-space-2)',
        'ds-3': 'var(--ds-space-3)',
        'ds-4': 'var(--ds-space-4)',
        'ds-5': 'var(--ds-space-5)',
        'ds-6': 'var(--ds-space-6)',
        'ds-8': 'var(--ds-space-8)',
        'ds-10': 'var(--ds-space-10)',
        'ds-12': 'var(--ds-space-12)',
        // Surface geometry roles. A feature-owned panel that must match a Card's
        // rhythm references the role instead of guessing `p-4` or `p-6`.
        'ds-card': 'var(--ds-card-padding)',
        'ds-card-compact': 'var(--ds-card-padding-compact)',
        'ds-card-spacious': 'var(--ds-card-padding-spacious)',
        'ds-page-gutter': 'var(--ds-page-gutter)',
        'ds-section-gap': 'var(--ds-section-gap)',
        'ds-field-gap': 'var(--ds-field-gap)',
      },

      // Control heights, so a feature-owned control that genuinely cannot be a
      // Button (a nav row, a PDF field overlay) still lands on the scale.
      height: {
        'ds-control-sm': 'var(--ds-control-height-sm)',
        'ds-control': 'var(--ds-control-height-md)',
        'ds-control-lg': 'var(--ds-control-height-lg)',
      },
      minHeight: {
        'ds-control-sm': 'var(--ds-control-height-sm)',
        'ds-control': 'var(--ds-control-height-md)',
        'ds-control-lg': 'var(--ds-control-height-lg)',
      },

      /*
       * Preflight gives every element `border-color: theme('borderColor.DEFAULT')`,
       * which Tailwind derives from its own grey 200. That grey is not in the
       * palette above, so the value is pinned here: without it every bare
       * `border` would take the text colour.
       */
      borderColor: {
        DEFAULT: '#e5e7eb',
      },
    },
  },
  plugins: [],
}
