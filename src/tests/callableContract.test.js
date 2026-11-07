/**
 * The callable contract check (`scripts/check-callable-contract.mjs`) and the
 * daily release health check read the same list of what the site calls. A name
 * passed through a local wrapper counts too, or a removed export it calls would
 * pass the check.
 */
import { describe, expect, it } from 'vitest';
import { callablesIn, readFrontendCallables } from '../../scripts/check-callable-contract.mjs';

describe('callablesIn', () => {
    it('reads a name passed straight to httpsCallable', () => {
        expect([...callablesIn("const f = httpsCallable(functions, 'listLeads');")]).toEqual(['listLeads']);
    });

    it('reads names passed to a wrapper hook', () => {
        const source = `
            const call = useCallback(
                (name, payload) => httpsCallable(functions, name)({ companyId, ...payload }).then((r) => r.data),
                [companyId],
            );
            await call('saveDraft', { a: 1 });
            await call("getDraft", { key });
        `;
        expect([...callablesIn(source)].sort()).toEqual(['getDraft', 'saveDraft']);
    });

    it('reads names passed to an async wrapper', () => {
        const source = `
            const run = async (name, payload, message) => {
                const call = httpsCallable(functions, name);
                await call(payload);
            };
            onPublish={() => run('publishWording', { id })}
        `;
        expect([...callablesIn(source)]).toEqual(['publishWording']);
    });

    it('reads only calls of the wrapper itself, not a method or a longer name ending in it', () => {
        const source = `
            const call = (name, data) => httpsCallable(functions, name)(data);
            await call('saveDraft', {});
            handler.call('ctx', 1);
            recall('notACallable');
        `;
        expect([...callablesIn(source)]).toEqual(['saveDraft']);
    });

    it('ignores a function that does not hand its first parameter to httpsCallable', () => {
        const source = `
            const say = (text) => console.log(text);
            say('notACallable');
        `;
        expect([...callablesIn(source)]).toEqual([]);
    });
});

describe('readFrontendCallables', () => {
    it('includes the callables the site reaches only through wrappers', () => {
        const names = readFrontendCallables();
        for (const name of [
            'saveCompanyPreparedApplication', 'getCompanyPreparedDraft',
            'publishCompanyAgreementWording', 'revertCompanyAgreementWording',
        ]) expect(names).toContain(name);
    });

    it('reads the app, not its tests: the samples above name callables nothing calls', () => {
        const names = readFrontendCallables();
        for (const sample of ['saveDraft', 'getDraft', 'publishWording', 'listLeads']) expect(names).not.toContain(sample);
    });
});
