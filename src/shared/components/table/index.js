/*
 * `SkeletonRow` / `SkeletonTable` were removed on 2026-08-21. They had no
 * consumers anywhere in the tree — `DataTable` renders its own skeleton, using
 * the `--ds-*` tokens — and they carried raw `bg-gray-200` placeholders that the
 * UI-contract ratchet would otherwise have had to tolerate forever.
 */
export { ModernDriverTable } from './ModernDriverTable';
