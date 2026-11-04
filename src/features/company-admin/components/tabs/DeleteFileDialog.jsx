import React from 'react';
import { ConfirmDialog } from '@design-system/patterns';

/**
 * Replaces the blocking `window.confirm` that guarded DQ file deletion. The
 * question is preserved verbatim.
 *
 * The approved `ConfirmDialog`, which wraps a long description in
 * `[overflow-wrap:anywhere]` — a DQ file name can be one unbroken string.
 */
export function DeleteFileDialog({ file, onCancel, onConfirm }) {
  const keeps = file.isSynced ? ' The application keeps its own copy.' : '';
  return (
    <ConfirmDialog
      tone="danger"
      title="Delete this DQ file?"
      description={`Are you sure you want to delete "${file.fileName}"?${keeps}`}
      confirmLabel="Delete file"
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}
