import path, { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import autoprefixer from 'autoprefixer';
import tailwindcss from 'tailwindcss';
import catalogTailwindConfig from './tailwind.config.js';

const currentDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(currentDir, '..');

/**
 * SafeHaul component catalog.
 *
 * The catalog documents the *design system* and business-neutral page patterns.
 * It deliberately does not load feature screens, so nothing here can reach
 * Firebase, Cloud Functions, Storage, application context, or production data.
 * Every story renders from a local fixture.
 *
 * `@storybook/react-vite` loads the project's own `vite.config.js`, so stories
 * resolve `@`, `@design-system`, `@shared` and friends exactly the way the
 * application does, and PostCSS/Tailwind run from the same root config. The
 * `viteFinal` hook below strips the few application-build-only settings that do
 * not belong in a catalog build (see the comments there).
 *
 * @type {import('@storybook/react-vite').StorybookConfig}
 */
const config = {
  stories: [
    '../src/design-system/stories/**/*.mdx',
    '../src/design-system/**/*.stories.@(js|jsx)',
    // The accessible `Modal` and `ConfirmDialog` still live in `shared` because
    // the design system must not depend on `shared` (see the note in
    // `ConfirmDialog.jsx`). Their stories are colocated with them and are pulled
    // into the same catalog until those primitives move.
    '../src/shared/components/modals/*.stories.@(js|jsx)',
  ],

  addons: ['@storybook/addon-docs', '@storybook/addon-a11y'],

  framework: {
    name: '@storybook/react-vite',
    options: {},
  },

  core: {
    disableTelemetry: true,
    disableWhatsNewNotifications: true,
  },

  docs: {
    defaultName: 'Documentation',
  },

  viteFinal: async (viteConfig) => {
    // The application build pins a single `index.html` entry and emits hidden
    // sourcemaps for the Sentry upload. Storybook supplies its own entry, and a
    // catalog has no Sentry release, so both are dropped rather than inherited.
    if (viteConfig.build?.rollupOptions?.input) {
      delete viteConfig.build.rollupOptions.input;
    }
    if (viteConfig.build) {
      viteConfig.build.sourcemap = false;
    }

    // `vite.config.js` pins the app dev server to port 5000 with
    // `strictPort: true`. Inheriting that would make `npm run storybook` fight
    // the app dev server (and the Playwright suite) for the same port.
    viteConfig.server = {
      ...viteConfig.server,
      port: undefined,
      strictPort: false,
    };

    // Tailwind runs from `.storybook/tailwind.config.js` — the application's
    // config plus the story files the application deliberately excludes from its
    // own stylesheet. Declaring the PostCSS plugins here replaces the root
    // `postcss.config.js` for the catalog build only; the application's PostCSS
    // pipeline is untouched.
    viteConfig.css = {
      ...viteConfig.css,
      postcss: {
        plugins: [tailwindcss(catalogTailwindConfig), autoprefixer()],
      },
    };

    // Aliases are inherited from `vite.config.js`; restating them here keeps the
    // catalog resolvable even if the app config is ever reorganised.
    viteConfig.resolve = {
      ...viteConfig.resolve,
      alias: {
        '@': path.resolve(projectRoot, 'src'),
        '@app': path.resolve(projectRoot, 'src/app'),
        '@features': path.resolve(projectRoot, 'src/features'),
        '@shared': path.resolve(projectRoot, 'src/shared'),
        '@design-system': path.resolve(projectRoot, 'src/design-system'),
        '@lib': path.resolve(projectRoot, 'src/lib'),
        ...viteConfig.resolve?.alias,
      },
    };

    return viteConfig;
  },
};

export default config;
