import appConfig from '../tailwind.config.js';

/**
 * Tailwind configuration for the component catalog.
 *
 * It is the application's configuration — same theme, same tokens, same
 * `--ds-*` bridge — with one difference: the story files the application config
 * deliberately excludes are scanned again here.
 *
 * Why the split exists: Tailwind's extractor treats every scanned file as a
 * source of candidate class names, prose included. Leaving stories in the
 * application's `content` compiled a stray `.shadow` rule into the shipped
 * production stylesheet purely because a documentation paragraph used the word.
 * Story files must not be able to grow the application bundle.
 *
 * Everything except `content` is inherited by reference, so a theme change made
 * in `tailwind.config.js` cannot fail to reach the catalog.
 *
 * @type {import('tailwindcss').Config}
 */
export default {
  ...appConfig,
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
    './.storybook/**/*.{js,jsx}',
  ],
};
