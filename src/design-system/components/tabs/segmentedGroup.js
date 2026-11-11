import './segmentedGroup.css';

/**
 * The drawing `TabList`, `TabNav` and `ListToolbar` share for a segmented or
 * pill strip (`segmentedGroup.css`). Importing this module brings the
 * stylesheet with it.
 */

/**
 * How many columns a segmented strip takes on a phone, where every option stays
 * in view: two items in halves, three in thirds, four in a 2 × 2 grid, five or
 * more in rows of three.
 */
export function phoneColumnsFor(count) {
  return count === 2 || count === 4 ? 2 : 3;
}
