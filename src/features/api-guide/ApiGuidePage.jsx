import React from 'react';
import { Badge, Card, Notice } from '@/design-system/components';
import { PageContainer, PageHeader, Stack } from '@/design-system/layouts';
import {
    BASE_URL, CURL_EXAMPLE, ENDPOINTS, ERRORS, LIMITS, NODE_EXAMPLE, PERMISSIONS,
} from './apiGuideContent';

/** A block of code or JSON, scrolled sideways rather than wrapped, so it can be copied as written. */
function CodeSample({ label, children }) {
    return (
        <pre
            aria-label={label}
            tabIndex={0}
            className="overflow-x-auto rounded-ds-md border border-ds-border-subtle bg-ds-surface-subtle p-ds-4 font-mono text-ds-xs text-ds-content"
        >
            <code>{children}</code>
        </pre>
    );
}

function Heading({ id, children }) {
    return <h2 id={id} className="text-ds-heading-md font-bold text-ds-content">{children}</h2>;
}

function Endpoint({ endpoint }) {
    return (
        <Card as="section" padding="md" aria-labelledby={`endpoint-${endpoint.id}`}>
            <Stack gap="sm">
                <h3 id={`endpoint-${endpoint.id}`} className="flex flex-wrap items-center gap-ds-2 font-mono text-ds-sm font-bold text-ds-content">
                    <Badge tone="info">GET</Badge>
                    <span className="[overflow-wrap:anywhere]">{endpoint.path}</span>
                </h3>
                <p className="text-ds-sm text-ds-content-secondary">{endpoint.summary}</p>
                <p className="text-ds-xs text-ds-content-muted">
                    {endpoint.needs.length
                        ? `Needs ${endpoint.needs.join(' and ')}, as well as applications:read.`
                        : 'Needs applications:read, which every key has.'}
                </p>
                {endpoint.params.length > 0 && (
                    <dl className="grid gap-ds-1 text-ds-sm sm:grid-cols-[8rem_1fr]">
                        {endpoint.params.map((param) => (
                            <React.Fragment key={param.name}>
                                <dt className="font-mono font-semibold text-ds-content">{param.name}</dt>
                                <dd className="text-ds-content-secondary">{param.text}</dd>
                            </React.Fragment>
                        ))}
                    </dl>
                )}
                <CodeSample label={`Example answer from ${endpoint.path}`}>{endpoint.example}</CodeSample>
            </Stack>
        </Card>
    );
}

/**
 * The company API for the developers who connect to it: public, read-only text.
 * The Company Admin's half is Settings → API Keys, which links here.
 */
export function ApiGuidePage() {
    return (
        <div className="min-h-screen bg-ds-canvas py-ds-8 text-ds-content">
            <PageContainer width="standard">
                <main className="mx-auto max-w-3xl">
                    <Stack gap="lg">
                        <PageHeader
                            title="SafeHaul API"
                            description="Read the driver applications submitted to a trucking company, with an API key the company gives you."
                        />

                        <Notice tone="info" title="Read-only" titleAs="h2">
                            The API reads applications and their files. It cannot change anything at SafeHaul.
                        </Notice>

                        <Stack gap="sm">
                            <Heading id="connect">Connect</Heading>
                            <p className="text-ds-sm">
                                A Company Admin creates a key under Settings → API Keys and gives it to you. Send it
                                with every request; all endpoints are under this address:
                            </p>
                            <CodeSample label="Base address">{BASE_URL}</CodeSample>
                            <CodeSample label="Example request">{CURL_EXAMPLE}</CodeSample>
                            <p className="text-ds-sm">
                                Call it from your server. The key opens the company’s applications, so it never goes
                                in a browser or a mobile app; the API sends no CORS headers for that reason. Answers
                                are JSON, and times are UTC in ISO 8601.
                            </p>
                        </Stack>

                        <Stack gap="sm">
                            <Heading id="permissions">What a key may read</Heading>
                            <dl className="grid gap-ds-3 text-ds-sm">
                                {PERMISSIONS.map((permission) => (
                                    <div key={permission.scope}>
                                        <dt className="font-mono font-semibold text-ds-content">
                                            {permission.scope} <span className="font-sans font-normal text-ds-content-muted">— {permission.grant}</span>
                                        </dt>
                                        <dd className="text-ds-content-secondary">{permission.gives}</dd>
                                    </div>
                                ))}
                            </dl>
                            <p className="text-ds-sm">
                                <code className="font-mono">GET /v1/key</code> says which permissions a key has, and{' '}
                                <code className="font-mono">ssnIncluded</code> in each answer says whether a full SSN was in it.
                            </p>
                        </Stack>

                        <Stack gap="sm">
                            <Heading id="sync">Keeping in step</Heading>
                            <ol className="list-decimal space-y-ds-1 ps-ds-5 text-ds-sm">
                                <li>Every few minutes, call <code className="font-mono">/v1/submissions</code> with the cursor you saved last time (none the first time).</li>
                                <li>For each submission, fetch <code className="font-mono">/v1/applications/{'{id}'}?version=…</code>, and its documents if you need them.</li>
                                <li>Save <code className="font-mono">nextCursor</code>; while <code className="font-mono">hasMore</code> is true, call again with it.</li>
                            </ol>
                            <p className="text-ds-sm text-ds-content-secondary">
                                A resubmission is a new version of the same application; keep the newest. An application
                                from before SafeHaul kept submitted records is rebuilt from what survives, says so in{' '}
                                <code className="font-mono">provenance</code>, keeps its original date, and so may appear behind
                                your cursor: a sync from the start, without a cursor, picks those up.
                            </p>
                            <CodeSample label="Example sync in Node.js">{NODE_EXAMPLE}</CodeSample>
                        </Stack>

                        <Stack gap="md">
                            <Heading id="endpoints">Endpoints</Heading>
                            {ENDPOINTS.map((endpoint) => <Endpoint key={endpoint.id} endpoint={endpoint} />)}
                        </Stack>

                        <Stack gap="sm">
                            <Heading id="errors">Errors</Heading>
                            <p className="text-ds-sm">
                                An error answers with its HTTP status and{' '}
                                <code className="font-mono">{'{ "error": { "code": "...", "message": "..." } }'}</code>. Act on the
                                code; the message is for people.
                            </p>
                            <dl className="grid gap-ds-2 text-ds-sm sm:grid-cols-[13rem_1fr]">
                                {ERRORS.map((error) => (
                                    <React.Fragment key={error.code}>
                                        <dt className="font-mono font-semibold text-ds-content">{error.status} {error.code}</dt>
                                        <dd className="text-ds-content-secondary">{error.meaning}</dd>
                                    </React.Fragment>
                                ))}
                            </dl>
                        </Stack>

                        <Stack gap="sm">
                            <Heading id="limits">Limits and records</Heading>
                            <ul className="list-disc space-y-ds-1 ps-ds-5 text-ds-sm">
                                {LIMITS.map((limit) => <li key={limit}>{limit}</li>)}
                                <li>Every request is recorded: which key, which application, whether a full SSN went out. The company can turn a key off at any time.</li>
                            </ul>
                        </Stack>
                    </Stack>
                </main>
            </PageContainer>
        </div>
    );
}

export default ApiGuidePage;
