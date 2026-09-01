/**
 * The Environment & Integrations presentation vocabulary: how a status, a
 * source, a category and an action are named and toned on screen, plus the
 * timestamp format. Extracted verbatim from
 * `views/EnvironmentIntegrationsView.jsx`, which keeps the behaviour these
 * words describe.
 */

import {
    AlertTriangle,
    CheckCircle2,
    ShieldCheck,
} from 'lucide-react';

const STATUS_PRESENTATION = {
    configured: { tone: 'success', label: 'Configured', icon: CheckCircle2 },
    missing: { tone: 'danger', label: 'Missing', icon: AlertTriangle },
    unknown: { tone: 'neutral', label: 'Not retrievable', icon: ShieldCheck },
};

const SOURCE_LABELS = {
    'vite-build': 'Browser build',
    'functions-env': 'Cloud Functions env',
    'secret-manager': 'Secret Manager',
    'github-actions-secret': 'GitHub Actions secret',
    'github-actions-variable': 'Workflow variable',
    'firebase-runtime': 'Firebase runtime',
    'repo-config': 'Repository config',
    'firestore-encrypted': 'Firestore (encrypted)',
    'firestore-plaintext': 'Firestore',
    'local-tooling': 'Deployment tooling',
};

const CATEGORY_LABELS = {
    'browser-build': 'Browser & build',
    'functions-env': 'Cloud Functions',
    'secret-manager': 'Secret Manager',
    'github-actions': 'GitHub Actions',
    'firebase-config': 'Firebase configuration',
    'global-integration': 'Global integrations',
    'company-integration': 'Company integrations',
    'infrastructure-security': 'Infrastructure & security',
    'public-config': 'Public configuration',
    'deployment-operations': 'Deployment & operations',
};

const ACTION_LABELS = {
    list: 'Listed the inventory',
    reveal: 'Revealed a value',
    update: 'Replaced a value',
    add: 'Added a value',
    delete: 'Deleted a value',
    test: 'Tested an integration',
};

const label = (map, value) => map[value] || value;

function formatTimestamp(millis) {
    if (!millis) return '—';
    return new Date(millis).toLocaleString('en-US', {
        year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    });
}

export {
    STATUS_PRESENTATION,
    SOURCE_LABELS,
    CATEGORY_LABELS,
    ACTION_LABELS,
    label,
    formatTimestamp,
};
