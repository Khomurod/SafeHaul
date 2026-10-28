import React, { useState } from 'react';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UnsavedChangesProvider, useUnsavedChanges, useUnsavedChangesGuard } from './useUnsavedChanges';

function beforeUnloadListeners(spy) {
  return spy.mock.calls.filter(([type]) => type === 'beforeunload').map(([, listener]) => listener);
}

/** An editor that holds a change, as a section of a page does. */
function Editor({ name }) {
  const [dirty, setDirty] = useState(false);
  useUnsavedChanges(dirty);
  return (
    <button type="button" onClick={() => setDirty((value) => !value)}>
      {`${dirty ? 'Undo' : 'Change'} ${name}`}
    </button>
  );
}

/** A shell that moves between sections through the guard. */
function Shell({ children, onMove }) {
  const guard = useUnsavedChangesGuard();
  return (
    <>
      <p>{guard.dirty ? 'Dirty' : 'Clean'}</p>
      <button type="button" onClick={() => guard.request(onMove)}>Move</button>
      {guard.pending && (
        <div role="dialog" aria-label="Leave without saving?">
          <button type="button" onClick={guard.confirm}>Discard changes</button>
          <button type="button" onClick={guard.cancel}>Keep editing</button>
        </div>
      )}
      {children}
    </>
  );
}

function renderShell() {
  const onMove = vi.fn();
  render(
    <UnsavedChangesProvider>
      <Shell onMove={onMove}>
        <Editor name="first" />
        <Editor name="second" />
      </Shell>
    </UnsavedChangesProvider>,
  );
  return { onMove };
}

describe('useUnsavedChanges', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('asks the browser before leaving only while there is a change', () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    const { rerender, unmount } = renderHook(({ dirty }) => useUnsavedChanges(dirty), { initialProps: { dirty: false } });
    expect(beforeUnloadListeners(add)).toHaveLength(0);

    rerender({ dirty: true });
    const [listener] = beforeUnloadListeners(add);
    const event = new Event('beforeunload', { cancelable: true });
    listener(event);
    expect(event.defaultPrevented).toBe(true);

    rerender({ dirty: false });
    expect(beforeUnloadListeners(remove)).toContain(listener);
    unmount();
  });

  it('works without a provider', () => {
    const add = vi.spyOn(window, 'addEventListener');

    renderHook(() => useUnsavedChanges(true));

    expect(beforeUnloadListeners(add)).toHaveLength(1);
  });

  it('tells the provider while any part of the page holds a change', () => {
    renderShell();
    expect(screen.getByText('Clean')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Change first' }));
    fireEvent.click(screen.getByRole('button', { name: 'Change second' }));
    fireEvent.click(screen.getByRole('button', { name: 'Undo first' }));
    expect(screen.getByText('Dirty')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Undo second' }));
    expect(screen.getByText('Clean')).toBeInTheDocument();
  });

  it('forgets a part that goes away', () => {
    function Page() {
      const [shown, setShown] = useState(true);
      return (
        <>
          <button type="button" onClick={() => setShown(false)}>Close editor</button>
          {shown && <Editor name="first" />}
        </>
      );
    }
    render(
      <UnsavedChangesProvider>
        <Shell onMove={vi.fn()}><Page /></Shell>
      </UnsavedChangesProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Change first' }));
    expect(screen.getByText('Dirty')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close editor' }));

    expect(screen.getByText('Clean')).toBeInTheDocument();
  });
});

describe('useUnsavedChangesGuard', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('moves at once when nothing is changed', () => {
    const { onMove } = renderShell();

    fireEvent.click(screen.getByRole('button', { name: 'Move' }));

    expect(onMove).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('holds the move and asks while a change is held', () => {
    const { onMove } = renderShell();
    fireEvent.click(screen.getByRole('button', { name: 'Change first' }));

    fireEvent.click(screen.getByRole('button', { name: 'Move' }));

    expect(onMove).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Leave without saving?' })).toBeInTheDocument();
  });

  it('drops the move when the person keeps editing', () => {
    const { onMove } = renderShell();
    fireEvent.click(screen.getByRole('button', { name: 'Change first' }));
    fireEvent.click(screen.getByRole('button', { name: 'Move' }));

    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));

    expect(onMove).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('makes the move when the person discards', () => {
    const { onMove } = renderShell();
    fireEvent.click(screen.getByRole('button', { name: 'Change first' }));
    fireEvent.click(screen.getByRole('button', { name: 'Move' }));

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    });

    expect(onMove).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('needs a provider above it', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => renderHook(() => useUnsavedChangesGuard())).toThrow('needs an UnsavedChangesProvider');
  });
});
