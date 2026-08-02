import React, { useRef, useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { describe, expect, it } from 'vitest';
import { WorkspaceFrame } from './WorkspaceFrame';

function MobileHarness() {
  const [open, setOpen] = useState(false);
  const returnRef = useRef(null);

  return (
    <>
      <button ref={returnRef} type="button" onClick={() => setOpen(true)}>Open menu</button>
      <WorkspaceFrame
        navigation={<nav><a href="/one">One</a><button type="button">Last</button></nav>}
        topbar={<span>Topbar</span>}
        navigationOpen={open}
        onNavigationClose={() => setOpen(false)}
        focusReturnRef={returnRef}
      >
        Content
      </WorkspaceFrame>
    </>
  );
}

describe('WorkspaceFrame', () => {
  it('closes modal navigation with Escape and returns focus', () => {
    render(<MobileHarness />);
    const trigger = screen.getByRole('button', { name: 'Open menu' });
    fireEvent.click(trigger);

    const navigation = screen.getByRole('dialog', { name: 'Primary navigation' });
    expect(navigation).toHaveAttribute('data-open', 'true');
    expect(screen.getByRole('link', { name: 'One' })).toHaveFocus();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(navigation).toHaveAttribute('data-open', 'false');
    expect(navigation).toHaveAttribute('aria-hidden', 'true');
    expect(navigation).toHaveAttribute('inert');
    expect(trigger).toHaveFocus();
  });

  it('has no structural accessibility violations', async () => {
    const { container } = render(
      <WorkspaceFrame
        navigation={<nav aria-label="Example"><a href="/one">One</a></nav>}
        topbar={<span>Topbar</span>}
      >
        <h1>Page</h1>
      </WorkspaceFrame>,
    );
    expect((await axe(container)).violations).toEqual([]);
  });
});
