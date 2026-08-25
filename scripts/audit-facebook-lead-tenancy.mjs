#!/usr/bin/env node
// scripts/audit-facebook-lead-tenancy.mjs
//
// READ-ONLY. This script performs no writes of any kind — there is no --commit
// flag and nothing to enable. It reads, counts, and prints.
//
// WHY IT EXISTS
//
// Until 2026-08-25 `connectFacebookPage` set the tenant from the caller's uid:
//
//     const companyId = request.auth.uid; // Assumes 1:1 user-company mapping
//
// SafeHaul does not work that way — companies carry generated ids and users join
// them through `memberships`. So a connected page stored a USER id where a
// COMPANY id belongs, and every lead the webhook ingested afterwards was written
// to `companies/{uid}/leads`: a document tree belonging to no company, which no
// screen in the product reads. Those leads were not delivered to the wrong
// tenant. They went nowhere, and nobody saw them arrive or fail to arrive.
//
// The callable is fixed. This tells you whether anything was lost on the way,
// so the decision about what to do with it is made against numbers rather than
// a guess. Nothing is moved or deleted here — that is a separate, deliberate
// migration if you decide you want one.
//
// Usage:
//   GOOGLE_APPLICATION_CREDENTIALS=/path/sa.json \
//   FIREBASE_PROJECT=<projectId> node scripts/audit-facebook-lead-tenancy.mjs

import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(__dirname, '../functions/index.js'));
const { db } = require('./firebaseAdmin');

const iso = (ts) => {
    try { return ts?.toDate?.().toISOString() ?? String(ts ?? '—'); } catch { return '—'; }
};

(async () => {
    console.log('Facebook lead tenancy audit — READ ONLY, nothing is written.\n');

    // A real company has a document under `companies`. A uid does not. That is
    // the whole test: any integration whose companyId is not a real company was
    // bound to a user instead.
    const index = await db.collection('integrations_index').get();
    console.log(`integrations_index: ${index.size} connected page(s)\n`);

    const orphaned = [];
    for (const doc of index.docs) {
        const { companyId, pageName, connectedAt, platform } = doc.data();
        if (!companyId) { orphaned.push({ pageId: doc.id, companyId: '(missing)', pageName, connectedAt }); continue; }
        const company = await db.collection('companies').doc(companyId).get();
        if (!company.exists) {
            orphaned.push({ pageId: doc.id, companyId, pageName, connectedAt, platform });
        }
    }

    if (index.size > 0) {
        console.log(orphaned.length === 0
            ? '  All connected pages point at a real company. Nothing was misfiled.\n'
            : `  ${orphaned.length} page(s) point at an id that is not a company:\n`);
        for (const row of orphaned) {
            console.log(`    page ${row.pageId} ("${row.pageName || 'unknown'}")`);
            console.log(`      stored companyId : ${row.companyId}`);
            console.log(`      connected        : ${iso(row.connectedAt)}`);

            // Is that id a real user? If so this is the uid-instead-of-company
            // case rather than a deleted company, and the user is who to ask.
            const user = await db.collection('users').doc(row.companyId).get();
            console.log(user.exists
                ? `      looks like user  : ${user.data().email || '(no email on record)'}`
                : '      not a user either: id matches no user and no company');

            // And how many leads went there.
            const leads = await db.collection('companies').doc(row.companyId)
                .collection('leads').get();
            console.log(`      leads stranded   : ${leads.size}`);
            if (leads.size > 0) {
                const dates = leads.docs
                    .map((d) => d.data().createdAt)
                    .filter(Boolean)
                    .map((t) => iso(t))
                    .sort();
                console.log(`      oldest / newest  : ${dates[0]} / ${dates[dates.length - 1]}`);
                console.log(`      sources          : ${[...new Set(leads.docs.map((d) => d.data().source || '(none)'))].join(', ')}`);
            }
            console.log('');
        }
    }

    const stranded = [];
    for (const row of orphaned) {
        const leads = await db.collection('companies').doc(row.companyId).collection('leads').get();
        if (leads.size > 0) stranded.push({ id: row.companyId, count: leads.size });
    }

    console.log('---');
    if (orphaned.length > 0) {
        console.log('Reconnecting: the callable RECLAIMS a page whose stored id is not a company,');
        console.log('so the owning admin can simply connect it again — no cleanup needed first.');
        console.log('A page held by a REAL company is refused, and must be disconnected there.\n');
    }
    if (stranded.length === 0) {
        console.log('No stranded leads. The fix closes the fault and there is nothing to recover.');
    } else {
        const total = stranded.reduce((sum, s) => sum + s.count, 0);
        console.log(`${total} lead(s) are sitting under ${stranded.length} non-company id(s).`);
        console.log('Nothing has been changed. Decide whether to move them before doing anything else —');
        console.log('if they are from testing rather than real drivers, importing them would be worse');
        console.log('than leaving them.');
    }
    process.exit(0);
})().catch((error) => {
    console.error('Audit failed:', error?.message || error);
    process.exit(1);
});
