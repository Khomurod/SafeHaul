import React from 'react';
import './preview.css';
import './catalog.css';

/**
 * Viewport presets.
 *
 * These are the three widths the SafeHaul UI standard reviews at: a wide desktop
 * workspace, a tablet/split-screen width where table action columns start to
 * compete for space, and a common Android phone width. Every pattern story is
 * expected to be checked at all three.
 */
const SAFEHAUL_VIEWPORTS = {
  safehaulDesktop: {
    name: 'Desktop — 1440',
    styles: { width: '1440px', height: '900px' },
    type: 'desktop',
  },
  safehaulTablet: {
    name: 'Tablet — 1024',
    styles: { width: '1024px', height: '768px' },
    type: 'tablet',
  },
  safehaulMobile: {
    name: 'Mobile — 412',
    styles: { width: '412px', height: '915px' },
    type: 'mobile',
  },
};

/**
 * Surface backgrounds.
 *
 * SafeHaul ships a **light appearance only**. There is no `prefers-color-scheme`
 * rule, no `data-theme` attribute and no dark token set anywhere in the product,
 * so this catalog does not offer a fake dark mode — a theme switch that renders
 * something the application cannot actually produce would be worse than none.
 *
 * What does exist is an *inverse surface role* (`--ds-color-surface-inverse` and
 * its content tokens), added for console/log output panels. It is a role for a
 * specific kind of content, not an appearance setting. It is offered here so the
 * few components that may legitimately sit on it can be reviewed against it.
 */
const SURFACES = [
  { name: 'canvas', value: 'var(--ds-color-canvas)' },
  { name: 'surface', value: 'var(--ds-color-surface)' },
  { name: 'surface-subtle', value: 'var(--ds-color-surface-subtle)' },
  { name: 'inverse (role, not a dark theme)', value: 'var(--ds-color-surface-inverse)' },
];

/** @type {import('@storybook/react-vite').Preview} */
const preview = {
  parameters: {
    layout: 'padded',

    controls: {
      expanded: true,
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },

    backgrounds: {
      options: SURFACES.reduce((options, surface) => {
        options[surface.name] = { name: surface.name, value: surface.value };
        return options;
      }, {}),
    },

    viewport: {
      options: SAFEHAUL_VIEWPORTS,
    },

    a11y: {
      // Serious/critical violations are a build-review failure, not a hint.
      // The story smoke lane in `src/tests/designSystemStories.a11y.test.jsx`
      // enforces the same expectation in CI without needing a browser.
      test: 'error',
    },

    options: {
      storySort: {
        order: [
          'Introduction',
          'Foundations',
          'Components',
          'Patterns',
        ],
      },
    },
  },

  initialGlobals: {
    backgrounds: { value: 'canvas' },
  },

  decorators: [
    (Story, context) => (
      // `sb-canvas` gives every story the same breathing room, so a spacing
      // difference between two stories is the component's, not the frame's.
      <div className="sb-canvas" data-story-id={context.id}>
        <Story />
      </div>
    ),
  ],

  tags: ['autodocs'],
};

export default preview;
