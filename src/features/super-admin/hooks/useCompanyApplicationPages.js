import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { countApplications, loadApplicationsPage } from '@features/applications/services/applicationService';
import { getE2EQueryParam, isE2ETestMode } from '@lib/runtime/e2eMode';
import { mockCompanyApplications } from '../components/companiesMock';

const LOAD_FAILED = 'Could not load applications. Please check your internet connection or permissions.';

const isMock = () => isE2ETestMode && getE2EQueryParam('e2eCompanies', '') === 'mock';

/**
 * A company's applications for the Super Admin's list of them, a page at a
 * time (`loadApplicationsPage`), with a server count of all of them (`total`,
 * null until counted or when the count failed; the rows never wait for it).
 *
 * `{ applications, total, loading, error, hasMore, loadMore, loadingMore,
 * loadMoreFailed }`: `loading` until the first page of this company answers,
 * `error` the sentence to show when it could not be read; `loadMore` adds the
 * next page once (a second press while one loads does nothing), and a failed
 * one sets `loadMoreFailed` and keeps the rows. An answer for another company
 * changes nothing. Under `?e2eCompanies=mock` (E2E test mode only) it is the
 * made-up records, all at once, and nothing is read.
 */
export function useCompanyApplicationPages(companyId) {
    const mock = isMock();
    const [page, setPage] = useState({ companyId: null, applications: [], next: null, error: '' });
    const [count, setCount] = useState({ companyId: null, total: null });
    const [more, setMore] = useState({ companyId: null, loading: false, failed: false });
    const moreInFlight = useRef(false);

    useEffect(() => {
        if (!companyId || mock) return undefined;
        let current = true;
        loadApplicationsPage(companyId).then((first) => {
            if (current) setPage({ companyId, applications: first.applications, next: first.next, error: '' });
        }, (error) => {
            console.error('Error loading applications:', error);
            if (current) setPage({ companyId, applications: [], next: null, error: LOAD_FAILED });
        });
        countApplications(companyId).then((total) => {
            if (current) setCount({ companyId, total });
        }, (error) => {
            console.error('Could not count the applications:', error);
        });
        return () => { current = false; };
    }, [companyId, mock]);

    const shown = page.companyId === companyId ? page : null;

    const loadMore = useCallback(async () => {
        if (!shown?.next || moreInFlight.current) return;
        moreInFlight.current = true;
        setMore({ companyId, loading: true, failed: false });
        try {
            const nextPage = await loadApplicationsPage(companyId, { after: shown.next });
            setPage((previous) => {
                if (previous.companyId !== companyId) return previous;
                const listed = new Set(previous.applications.map((application) => application.id));
                return {
                    ...previous,
                    applications: [...previous.applications, ...nextPage.applications.filter((application) => !listed.has(application.id))],
                    next: nextPage.next,
                };
            });
            setMore({ companyId, loading: false, failed: false });
        } catch (error) {
            console.error('Error loading more applications:', error);
            setMore({ companyId, loading: false, failed: true });
        } finally {
            moreInFlight.current = false;
        }
    }, [companyId, shown]);

    const mockApplications = useMemo(() => (mock && companyId ? mockCompanyApplications(companyId) : null), [mock, companyId]);
    if (mockApplications) {
        return {
            applications: mockApplications,
            total: mockApplications.length,
            loading: false,
            error: '',
            hasMore: false,
            loadMore,
            loadingMore: false,
            loadMoreFailed: false,
        };
    }

    const applications = shown ? shown.applications : [];
    const total = count.companyId === companyId ? count.total : null;
    const moreHere = more.companyId === companyId ? more : { loading: false, failed: false };
    return {
        applications,
        total,
        loading: !shown,
        error: shown?.error || '',
        hasMore: Boolean(shown?.next) && (total === null || applications.length < total),
        loadMore,
        loadingMore: moreHere.loading,
        loadMoreFailed: moreHere.failed,
    };
}

export default useCompanyApplicationPages;
