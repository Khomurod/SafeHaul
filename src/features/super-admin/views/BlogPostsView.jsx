import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, RefreshCw, Trash2 } from 'lucide-react';

import { Badge, Button, Card, DataTable, FieldMessage } from '@/design-system/components';
import { Stack } from '@/design-system/layouts';
import { ConfirmDialog } from '@shared/components/modals/ConfirmDialog';
import { useToast } from '@shared/components/feedback';

import {
    deleteBlogPost,
    describeBlogError,
    isReauthCancelled,
    isReauthRequired,
    listBlogPosts,
    ReauthCancelledError,
    runBlogPublicationNow,
} from '../services/blogPosts';
import { ReauthenticateModal } from '../components/environment/ReauthenticateModal';

/**
 * Super Admin → Blog Posts.
 *
 * Deliberately minimal. Publishing is automatic and there is nothing to approve,
 * schedule or edit, so the screen shows article titles and a Delete action and
 * stops there. It is not a content-management system, and turning it into one
 * would mean building an editor for content nobody is supposed to hand-edit.
 *
 * The publication date is shown because two articles can share a subject and the
 * date is what distinguishes them; a status badge appears only once a post has
 * been removed, so the common case stays a plain list.
 *
 * Deletion goes through the same guards as every other privileged action:
 * exact super-admin role, recent authentication, a shared confirmation dialog
 * naming the article, server-side authorization and a value-free audit record.
 * The post leaves the public site immediately.
 *
 * No `PageHeader`: the Super Admin masthead owns the single `<h1>`.
 */
export function BlogPostsView() {
    const { showSuccess, showError, showInfo } = useToast();

    const [posts, setPosts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(null);
    const [deleteTarget, setDeleteTarget] = useState(null);
    const [deleting, setDeleting] = useState(false);
    const [deleteError, setDeleteError] = useState(null);
    const [reauth, setReauth] = useState(null);
    const [publishing, setPublishing] = useState(false);

    /**
     * The control that opened the dialog. `ConfirmDialog` restores focus to
     * whatever was focused when it mounted, but the row's Delete button is
     * unmounted and replaced when the list reloads after a successful delete,
     * so focus is moved deliberately to the heading instead of being lost to
     * the document body.
     */
    const headingRef = useRef(null);

    const load = useCallback(async () => {
        setLoading(true);
        setLoadError(null);
        try {
            const result = await listBlogPosts();
            setPosts(result.posts || []);
        } catch (error) {
            setLoadError(describeBlogError(error, 'The article list could not be loaded.'));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const requestReauth = useCallback(() => new Promise((resolve, reject) => {
        setReauth({ resolve, reject });
    }), []);

    const runGuarded = useCallback(async (operation) => {
        try {
            return await operation();
        } catch (error) {
            if (!isReauthRequired(error)) throw error;
            await requestReauth();
            return operation();
        }
    }, [requestReauth]);

    const handleDelete = useCallback(async () => {
        setDeleting(true);
        setDeleteError(null);
        try {
            await runGuarded(() => deleteBlogPost(deleteTarget.id));
            const title = deleteTarget.title;
            setDeleteTarget(null);
            showSuccess(`"${title}" has been removed from the public site.`);
            await load();
            // The row that opened the dialog no longer exists; put focus
            // somewhere meaningful rather than letting it fall to the body.
            headingRef.current?.focus();
        } catch (error) {
            if (isReauthCancelled(error)) return;
            setDeleteError(describeBlogError(error, 'That article could not be deleted.'));
        } finally {
            setDeleting(false);
        }
    }, [deleteTarget, load, runGuarded, showSuccess]);

    const handlePublishNow = useCallback(async () => {
        setPublishing(true);
        showInfo('Checking today’s publication slots…');
        try {
            const result = await runGuarded(() => runBlogPublicationNow());
            if (result.published > 0) {
                showSuccess(`Published ${result.published} article(s).`);
            } else {
                // A run that publishes nothing is usually correct — the slots
                // are already filled — so it is reported as information.
                const reasons = result.results.map((entry) => entry.outcome).join(', ');
                showInfo(result.attempted === 0
                    ? 'Every due slot for today is already filled.'
                    : `Nothing new was published (${reasons}).`);
            }
            await load();
        } catch (error) {
            if (isReauthCancelled(error)) return;
            showError(describeBlogError(error, 'The publication run could not be started.'));
        } finally {
            setPublishing(false);
        }
    }, [load, runGuarded, showError, showInfo, showSuccess]);

    const columns = useMemo(() => [
        {
            key: 'title',
            header: 'Article title',
            rowHeader: true,
            priority: 'primary',
            width: 'xl',
            render: (post) => (
                <div className="flex flex-col gap-ds-1">
                    <span className="font-medium text-ds-content">{post.title}</span>
                    {post.status === 'deleted' && <Badge tone="neutral">Removed</Badge>}
                </div>
            ),
        },
        {
            key: 'publicationDate',
            header: 'Published',
            priority: 'secondary',
            width: 'sm',
            render: (post) => (
                <span className="text-ds-sm text-ds-content-secondary">{post.publicationDate}</span>
            ),
        },
        {
            key: 'actions',
            header: 'Actions',
            priority: 'actions',
            width: 'actions',
            align: 'end',
            render: (post) => (
                <div className="flex justify-end gap-ds-1">
                    {post.status !== 'deleted' && (
                        <>
                            <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => window.open(`/news/${post.slug}`, '_blank', 'noopener')}
                            >
                                <ExternalLink size={14} aria-hidden="true" /> View
                            </Button>
                            <Button
                                size="sm"
                                variant="danger"
                                onClick={() => {
                                    setDeleteError(null);
                                    setDeleteTarget(post);
                                }}
                            >
                                <Trash2 size={14} aria-hidden="true" /> Delete
                            </Button>
                        </>
                    )}
                </div>
            ),
        },
    ], []);

    return (
        <Stack gap="lg">
            <div>
                <h2
                    ref={headingRef}
                    tabIndex={-1}
                    className="text-ds-heading-lg font-bold text-ds-content"
                >
                    Blog Posts
                </h2>
                <p className="mt-1 text-ds-sm text-ds-content-secondary">
                    Articles published automatically to SafeHaul News &amp; Insights. Three articles
                    publish each day, one per theme. Deleting one removes it from the site, the index,
                    the feed and the sitemap immediately.
                </p>
            </div>

            <div className="flex flex-wrap gap-ds-2">
                <Button variant="secondary" onClick={load} disabled={loading}>
                    <RefreshCw size={14} aria-hidden="true" /> Refresh
                </Button>
                <Button variant="secondary" loading={publishing} onClick={handlePublishNow}>
                    Run today&rsquo;s publication check
                </Button>
            </div>

            {loadError && (
                <Card padding="md" tone="danger">
                    <FieldMessage tone="error">{loadError}</FieldMessage>
                    <div className="mt-ds-2">
                        <Button variant="secondary" onClick={load}>
                            <RefreshCw size={14} aria-hidden="true" /> Try again
                        </Button>
                    </div>
                </Card>
            )}

            <DataTable
                ariaLabel="Published blog posts"
                density="compact"
                minWidth="md"
                data={posts}
                columns={columns}
                isLoading={loading}
                loadingLabel="Loading articles"
                empty={{
                    title: 'No articles have been published yet.',
                    description: 'The scheduler publishes three articles a day once an AI provider is configured.',
                }}
            />

            {deleteTarget && (
                <ConfirmDialog
                    title="Delete this article?"
                    description={`"${deleteTarget.title}" will be removed from the landing page, /news, its own page, the sitemap and the feed immediately.`}
                    tone="danger"
                    confirmLabel="Delete article"
                    cancelLabel="Keep article"
                    loading={deleting}
                    error={deleteError}
                    onConfirm={handleDelete}
                    onCancel={() => { setDeleteTarget(null); setDeleteError(null); }}
                />
            )}

            {reauth && (
                <ReauthenticateModal
                    onSuccess={() => {
                        const { resolve } = reauth;
                        setReauth(null);
                        resolve();
                    }}
                    onCancel={() => {
                        const { reject } = reauth;
                        setReauth(null);
                        reject(new ReauthCancelledError());
                    }}
                />
            )}
        </Stack>
    );
}

export default BlogPostsView;
