import React from 'react';
import './Avatar.css';

/**
 * A disc standing for a person or an organisation.
 *
 * ## The size scale, and why it is fixed
 *
 * Every published design system this was checked against exposes a FIXED set of
 * avatar steps and lets the consumer pick one — GitHub Primer (16/20/24/32/40/
 * 48/64), Shopify Polaris (20/24/28/32/40), Atlassian (16/24/32/48/96) and Red
 * Hat, which states outright that the size is the consumer's choice. None of
 * them lets the component read the viewport and decide for itself.
 *
 * The five steps here are all Primer steps, and they are exactly the sizes this
 * application already used.
 */
const SIZES = new Set(['xs', 'sm', 'md', 'lg', 'xl']);

/**
 * `size` also takes `{ base, sm }`, and that is not an invention for one caller.
 *
 * Primer types its own prop `number | { narrow?, regular?, wide? }` — a
 * responsive avatar is first-class API in the reference system for exactly this
 * kind of dense application, because a profile header legitimately wants a
 * larger disc where there is room and a smaller one where there is not.
 *
 * The keys are this repository's own breakpoint vocabulary rather than Primer's:
 * `base` is the phone and `sm` is Tailwind's 640px, which is the breakpoint the
 * one consumer that needs this already used by hand.
 */
function normalizeSize(size) {
  if (typeof size === 'string') {
    if (!SIZES.has(size)) {
      throw new TypeError(
        `Unsupported Avatar size: ${size}. Expected one of ${[...SIZES].map((s) => `'${s}'`).join(', ')}, `
        + 'or a responsive { base, sm }.',
      );
    }
    return { base: size, sm: undefined };
  }
  if (size && typeof size === 'object') {
    const { base, sm } = size;
    if (!SIZES.has(base)) {
      throw new TypeError(`Avatar responsive size needs a valid \`base\`; got ${base}.`);
    }
    if (sm !== undefined && !SIZES.has(sm)) {
      throw new TypeError(`Unsupported Avatar size at \`sm\`: ${sm}.`);
    }
    if (sm === base) {
      throw new TypeError(
        `Avatar responsive size is the same at both steps ('${base}'). Pass the plain string instead.`,
      );
    }
    return { base, sm };
  }
  throw new TypeError(`Unsupported Avatar size: ${size}. Expected a step name or { base, sm }.`);
}

/**
 * `circle` for a person, `square` for anything that is not one.
 *
 * Primer states the distinction as a rule rather than a preference: "Circle
 * Avatars represent individual people. Square Avatars represent non-human
 * entities, such as bots, AI agents, teams, or organizations." A square avatar
 * keeps the control radius rather than going fully sharp, so it still reads as
 * part of the same family.
 */
const SHAPES = new Set(['circle', 'square']);

const TONES = new Set([
  'neutral', 'info', 'success', 'warning', 'danger', 'accent', 'primary', 'inverse',
]);

export function Avatar({
  children,
  size = 'md',
  shape = 'circle',
  tone = 'neutral',
  bordered = false,
  className = '',
  ...props
}) {
  const { base, sm } = normalizeSize(size);
  if (!SHAPES.has(shape)) {
    throw new TypeError(`Unsupported Avatar shape: ${shape}. Expected 'circle' or 'square'.`);
  }
  if (!TONES.has(tone)) {
    throw new TypeError(`Unsupported Avatar tone: ${tone}.`);
  }

  return (
    <span
      {...props}
      /*
       * Always hidden. An avatar restates a name that is already beside it, so
       * announcing "M" before "Maria Garcia" is noise — and five of the eight
       * discs this replaced were NOT hidden, so a screen-reader user heard the
       * initial read out as content.
       */
      aria-hidden="true"
      className={`ds-avatar ${className}`.trim()}
      data-size={base}
      data-size-sm={sm}
      data-shape={shape === 'circle' ? undefined : shape}
      data-tone={tone}
      data-bordered={bordered || undefined}
    >
      {children}
    </span>
  );
}
