import React from 'react';
import { AlertCircle, Icon } from '../../icons';
import { Button } from '@design-system/components';
import { contractViolation } from '../../contract';
import './SaveBar.css';

const isText = (value) => typeof value === 'string' && value.trim() !== '';

/**
 * The one bar a page shows while it has changes that are not saved: what
 * changed, Discard and Save. It sticks to the bottom of the scrolling page, so
 * Save stays next to whatever was changed, however long the page is.
 *
 * Rendering it means there are unsaved changes, as rendering a `Modal` means
 * the dialog is open: the page writes `{dirty && <SaveBar … />}` and the bar
 * goes away once the change is saved or discarded. The page owns the summary,
 * the save and the discard; this draws them.
 */
export function SaveBar({
  summary,
  onSave,
  onDiscard,
  saving = false,
  saveLabel = 'Save',
  discardLabel = 'Discard',
  error,
  className = '',
}) {
  if (!isText(summary)) {
    contractViolation('SaveBar needs a summary saying what changed.');
  }
  if (typeof onSave !== 'function' || typeof onDiscard !== 'function') {
    contractViolation('SaveBar needs onSave and onDiscard.');
  }

  return (
    <div role="region" aria-label="Unsaved changes" className={`ds-save-bar ${className}`.trim()}>
      <p role="status" className="ds-save-bar__summary" title={summary}>
        <Icon icon={AlertCircle} size="md" className="ds-save-bar__icon" />
        <span className="ds-save-bar__text">{summary}</span>
      </p>
      <div className="ds-save-bar__actions">
        <Button variant="ghost" onClick={onDiscard} disabled={saving}>{discardLabel}</Button>
        <Button variant="primary" onClick={onSave} loading={saving}>{saveLabel}</Button>
      </div>
      {error && <p role="alert" className="ds-save-bar__error">{error}</p>}
    </div>
  );
}
