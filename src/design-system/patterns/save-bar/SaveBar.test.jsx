import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SaveBar } from './SaveBar';

function renderBar(props = {}) {
  const onSave = vi.fn();
  const onDiscard = vi.fn();
  const view = render(<SaveBar summary="2 fields changed" onSave={onSave} onDiscard={onDiscard} {...props} />);
  return { onSave, onDiscard, ...view };
}

describe('SaveBar', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is a named region that says what changed', () => {
    renderBar();

    const region = screen.getByRole('region', { name: 'Unsaved changes' });
    expect(within(region).getByRole('status')).toHaveTextContent('2 fields changed');
  });

  it('reports Discard and Save', () => {
    const { onSave, onDiscard } = renderBar();

    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('puts Discard before Save, so Save is the last stop', () => {
    renderBar();

    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual(['Discard', 'Save']);
  });

  it('holds both while saving', () => {
    renderBar({ saving: true });

    expect(screen.getByRole('button', { name: 'Discard' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Save/ })).toHaveAttribute('aria-busy', 'true');
  });

  it('takes the page’s own words for the buttons', () => {
    renderBar({ saveLabel: 'Save templates', discardLabel: 'Undo' });

    expect(screen.getByRole('button', { name: 'Save templates' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument();
  });

  it('shows a failed save as an alert, under the buttons', () => {
    renderBar({ error: 'Could not save. Try again.' });

    expect(screen.getByRole('alert')).toHaveTextContent('Could not save. Try again.');
  });

  it('keeps the whole summary in its title, as the line may be cut short', () => {
    renderBar({ summary: 'A long account of every field that changed on this page' });

    expect(screen.getByRole('status')).toHaveAttribute('title', 'A long account of every field that changed on this page');
  });

  describe('refuses a setting it cannot act on', () => {
    it.each([
      ['a blank summary', { summary: ' ' }, 'needs a summary'],
      ['no save', { onSave: undefined }, 'needs onSave and onDiscard'],
      ['no discard', { onDiscard: 'discard' }, 'needs onSave and onDiscard'],
    ])('%s', (_name, props, message) => {
      vi.spyOn(console, 'error').mockImplementation(() => {});

      expect(() => renderBar(props)).toThrow(message);
    });
  });

  it('has no accessibility violations, with an error shown', async () => {
    const { container } = renderBar({ error: 'Could not save. Try again.' });

    expect((await axe(container)).violations).toEqual([]);
  });
});
