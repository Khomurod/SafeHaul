#!/usr/bin/env node
/**
 * Files what `scripts/check-release-health.mjs` found, where it will be seen.
 *
 * A failed scheduled run sends an email, which is easy to miss and says nothing
 * about WHAT is wrong. So a finding also becomes a GitHub issue: it has a title
 * you can read at a glance, a body written for a person rather than a log reader,
 * and a history.
 *
 * The rules that keep it from becoming noise, which is the only way a monitor
 * survives contact with a real week:
 *
 *   - ONE issue at a time. A problem that persists for a fortnight updates the
 *     same issue instead of opening fourteen. Found by label, not by title text,
 *     so retitling by hand does not spawn a duplicate.
 *   - It CLOSES ITSELF once the checks pass again, so a fixed problem does not
 *     sit in the list looking unresolved.
 *   - It never fails the workflow. The check itself already decided whether the
 *     system is healthy; if reporting hits a transient API error, saying so is
 *     better than turning a reporting hiccup into a second alarm.
 *
 * Usage: node scripts/report-release-health.mjs open|close
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { REPORT_FILE } from './check-release-health.mjs';

const LABEL = 'release-health';
const TITLE = 'Release health check found a problem';

const {
    GITHUB_TOKEN: token,
    GITHUB_REPOSITORY: repository = 'Khomurod/SafeHaul',
    RUN_URL: runUrl = '',
} = process.env;

async function api(path, { method = 'GET', body } = {}) {
    const response = await fetch(`https://api.github.com/repos/${repository}${path}`, {
        method,
        headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${token}`,
            'X-GitHub-Api-Version': '2022-11-28',
            ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) {
        throw new Error(`${method} ${path} -> ${response.status} ${(await response.text()).slice(0, 300)}`);
    }
    return response.json();
}

/** The open health issue, if there is one. Identified by label. */
async function findOpenIssue() {
    const issues = await api(`/issues?state=open&labels=${encodeURIComponent(LABEL)}&per_page=10`);
    // `/issues` also returns pull requests; they are not what we are looking for.
    return (Array.isArray(issues) ? issues : []).find((issue) => !issue.pull_request) || null;
}

/** The label has to exist before it can be applied. */
async function ensureLabel() {
    try {
        await api(`/labels/${encodeURIComponent(LABEL)}`);
    } catch {
        await api('/labels', {
            method: 'POST',
            body: {
                name: LABEL,
                color: 'b60205',
                description: 'Something that should be live is not — opened automatically',
            },
        });
    }
}

function readReport() {
    try {
        return readFileSync(REPORT_FILE, 'utf8');
    } catch {
        return '_The health check produced no report file; see the workflow run for details._';
    }
}

async function open() {
    const body = [
        readReport(),
        '',
        runUrl ? `[View the run that found this](${runUrl})` : '',
        '',
        '_Opened automatically by the daily release health check. It will close itself_',
        '_once the checks pass again._',
    ].join('\n');

    const existing = await findOpenIssue();
    if (existing) {
        // Update in place, and add a comment so the history shows it recurred
        // rather than silently rewriting yesterday's text.
        await api(`/issues/${existing.number}`, { method: 'PATCH', body: { body } });
        await api(`/issues/${existing.number}/comments`, {
            method: 'POST',
            body: { body: `Still failing as of this run.${runUrl ? `\n\n${runUrl}` : ''}` },
        });
        console.log(`Updated existing health issue #${existing.number}.`);
        return;
    }

    await ensureLabel();
    const created = await api('/issues', {
        method: 'POST',
        body: { title: TITLE, body, labels: [LABEL] },
    });
    console.log(`Opened health issue #${created.number}.`);
}

async function close() {
    const existing = await findOpenIssue();
    if (!existing) {
        console.log('Release health is fine and no issue was open.');
        return;
    }
    await api(`/issues/${existing.number}/comments`, {
        method: 'POST',
        body: { body: 'Release health checks are passing again. Closing automatically.' },
    });
    await api(`/issues/${existing.number}`, {
        method: 'PATCH',
        body: { state: 'closed', state_reason: 'completed' },
    });
    console.log(`Closed health issue #${existing.number}.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    const action = process.argv[2];
    if (!token) {
        console.warn('No GITHUB_TOKEN; skipping issue reporting.');
        process.exit(0);
    }
    const run = action === 'open' ? open : action === 'close' ? close : null;
    if (!run) {
        console.error('Usage: report-release-health.mjs open|close');
        process.exit(1);
    }
    // Never turn a reporting hiccup into a second alarm.
    run().catch((error) => {
        console.warn(`Could not update the health issue: ${error.message}`);
    });
}
