/**
 * What happens to the files someone drops on a picker, decided in one place.
 *
 * This is pure, and separate from `FileInput.jsx`, for two reasons that arrived
 * together on 2026-08-26:
 *
 * - the rules are worth testing directly. `accept` has three syntaxes, case
 *   folding matters, and the message a rejection produces has more shapes than
 *   the component has states. Driving all of that through a rendered component
 *   and a synthetic `DataTransfer` tests the wiring, not the rules;
 * - the component was 411 lines and this is a whole responsibility — deciding
 *   *what a drop means* — that has nothing to do with rendering a picker.
 *
 * The native picker needs none of this: its own dialog will not offer a file
 * that `accept` refuses, and without `multiple` it will not offer two. A drop
 * inherits none of that, which is the whole reason this module exists.
 */

/**
 * Does a file satisfy an `accept` attribute, the way the native picker would?
 *
 * `accept` is a comma-separated list of three shapes and all three appear in this
 * product: an extension (`.pdf`), a MIME type (`application/pdf`), and a wildcard
 * MIME (`image/*`). An empty or absent `accept` accepts everything, which is the
 * attribute's own meaning.
 *
 * Deliberately compares lower-cased: a file called `LOGO.PNG` is a PNG, and a
 * browser reporting `IMAGE/PNG` is reporting an image.
 */
export function matchesAccept(file, accept) {
  const patterns = String(accept ?? '')
    .split(',')
    .map((pattern) => pattern.trim().toLowerCase())
    .filter(Boolean);
  if (patterns.length === 0) return true;

  const type = String(file?.type ?? '').toLowerCase();
  const name = String(file?.name ?? '').toLowerCase();

  return patterns.some((pattern) => {
    if (pattern.startsWith('.')) return name.endsWith(pattern);
    if (pattern.endsWith('/*')) return type.startsWith(pattern.slice(0, -1));
    return type === pattern;
  });
}

/** How many rejected files get named before the message switches to counting. */
const NAME_LIMIT = 3;

/** "a", "a and b", "a, b and c" — the same list voice the product uses elsewhere. */
function joinNames(names) {
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

const nameOf = (file) => String(file?.name ?? '').trim();

/**
 * The clause for files `accept` refused.
 *
 * Names them while there are few enough for a name to help, and counts them
 * after that — a screen reader reading nine filenames is worse than being told
 * there were nine. Falls back to counting if any file has no usable name, which
 * a `File` built by a script can manage even though a real drop cannot.
 */
function describeRejected(rejected) {
  const names = rejected.map(nameOf);
  const nameable = names.length <= NAME_LIMIT && names.every(Boolean);
  if (!nameable) {
    return `${names.length} files were not added. They are not accepted file types.`;
  }
  if (names.length === 1) {
    return `${names[0]} was not added. It is not an accepted file type.`;
  }
  return `${joinNames(names)} were not added. They are not accepted file types.`;
}

/**
 * Decide what a drop delivers, and what the user has to be told about it.
 *
 * Two things can quietly swallow a dropped file, and before this both did it in
 * silence:
 *
 * - `accept` refusing it. The panel looked exactly as it had a moment earlier,
 *   so the drop read as "nothing happened" rather than "that file is not
 *   allowed here";
 * - a single-file field taking only the first of several. That is what the
 *   native picker does, and it is right, but the picker also never let a second
 *   file be chosen in the first place.
 *
 * @param {{files: File[], accept?: string, multiple?: boolean}} options
 * @returns {{accepted: File[], message: string|null}} `message` is null when
 *   every dropped file made it through, so a clean drop clears any earlier one.
 */
export function resolveDroppedFiles({ files, accept, multiple = false }) {
  const dropped = Array.from(files ?? []);
  const allowed = dropped.filter((file) => matchesAccept(file, accept));
  const rejected = dropped.filter((file) => !matchesAccept(file, accept));

  // A single-file field takes the first ACCEPTED file, which is what the native
  // picker does when `multiple` is absent.
  const accepted = multiple ? allowed : allowed.slice(0, 1);
  const surplus = allowed.length - accepted.length;

  const clauses = [];
  if (rejected.length > 0) clauses.push(describeRejected(rejected));
  if (surplus > 0) {
    const kept = nameOf(accepted[0]);
    clauses.push(kept
      ? `This field takes one file, so only ${kept} was added.`
      : 'This field takes one file, so only the first was added.');
  }

  return { accepted, message: clauses.length > 0 ? clauses.join(' ') : null };
}
