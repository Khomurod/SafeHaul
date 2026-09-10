/**
 * The old "Start an application" URL must not become a dead end.
 *
 * That screen became the primary action inside the unified unfinished-applications
 * workspace on 2026-09-10, so the path has no component of its own. A recruiter
 * may still have it bookmarked, and internal links may still point at it.
 */
import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { StartApplicationRedirect } from './StartApplicationRedirect';

/** Reports where the router actually resolved to, rather than what we hoped. */
function Landed() {
    const { pathname, search } = useLocation();
    return <div data-testid="landed">{`${pathname}${search}`}</div>;
}

function renderAt(url) {
    return render(
        <MemoryRouter initialEntries={[url]}>
            <Routes>
                <Route path="/company/drivers/start-application" element={<StartApplicationRedirect />} />
                <Route path="/company/drivers/unfinished" element={<Landed />} />
            </Routes>
        </MemoryRouter>,
    );
}

describe('the old start-application URL', () => {
    it('lands on the unified workspace', async () => {
        renderAt('/company/drivers/start-application');

        expect(await screen.findByTestId('landed')).toHaveTextContent('/company/drivers/unfinished');
    });

    it('carries the query string over', async () => {
        // `?e2eAuth=company_admin` is how the browser suite authenticates, so a
        // redirect that dropped it would send an e2e run to a signed-out page — the
        // kind of "the redirect works, the test doesn't" failure that costs an
        // afternoon.
        renderAt('/company/drivers/start-application?e2eAuth=company_admin&r=rae');

        const landed = await screen.findByTestId('landed');
        expect(landed).toHaveTextContent('e2eAuth=company_admin');
        expect(landed).toHaveTextContent('r=rae');
    });

    it('replaces the entry rather than stacking one, so Back does not loop', async () => {
        // A push would leave the old URL in history: pressing Back would redirect
        // forward again and the recruiter would be stuck.
        const { container } = renderAt('/company/drivers/start-application');

        await screen.findByTestId('landed');
        // The redirect element is gone, not merely covered.
        expect(container.querySelectorAll('[data-testid="landed"]')).toHaveLength(1);
    });
});
