/**
 * What the delete dialog is handed from the server's preview: the application,
 * the same driver's others, and the day before which uploaded files stay. The
 * page's whole flow is `views/UnfinishedApplicationsPage.purge.test.jsx`.
 */
import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

const preview = vi.hoisted(() => vi.fn());

vi.mock('firebase/functions', () => ({ httpsCallable: () => preview }));
vi.mock('@lib/firebase', () => ({ functions: {} }));

import { useUnfinishedDraftDelete } from './useUnfinishedDraftDelete';

const DANA = { applicantKey: 'aaaa1111bbbb2222cccc', firstName: 'Dana' };

describe('the preview', () => {
    it('hands the dialog the day before which uploaded files stay', async () => {
        preview.mockResolvedValue({
            data: { application: { ...DANA, fileCount: 1, olderFileCount: 2 }, related: [], filesKeptBefore: '2026-10-12' },
        });
        const { result } = renderHook(() => useUnfinishedDraftDelete({ companyId: 'company-1', onDeleted: vi.fn() }));

        await act(() => result.current.ask(DANA));

        expect(preview).toHaveBeenCalledWith({ companyId: 'company-1', applicantKey: DANA.applicantKey, preview: true });
        expect(result.current.target.preview).toEqual({
            application: { ...DANA, fileCount: 1, olderFileCount: 2 }, related: [], filesKeptBefore: '2026-10-12',
        });
    });

    it('hands it no day from a server that gives none', async () => {
        preview.mockResolvedValue({ data: { application: DANA, related: [] } });
        const { result } = renderHook(() => useUnfinishedDraftDelete({ companyId: 'company-1', onDeleted: vi.fn() }));

        await act(() => result.current.ask(DANA));

        expect(result.current.target.preview.filesKeptBefore).toBeNull();
    });
});
