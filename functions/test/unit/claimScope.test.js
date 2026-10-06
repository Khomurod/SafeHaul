/**
 * The SafeHaul claim check: where a phrase is a claim, and where it is not.
 *
 * It used to match each pattern against the whole text, so it refused the
 * limitations the capability package requires an article to state, refused
 * industry advice that never mentioned SafeHaul, and let "SafeHaul pulls MVRs and
 * PSP reports automatically" through. `blogPipeline.sourcing.test.js` covers the
 * check inside the pipeline; this file covers the check itself.
 */

const knowledge = require('../../ai/knowledge/safehaulCapabilities');

const ok = (text, options) => knowledge.checkClaims(text, options).ok;

describe('a limitation is not a claim', () => {
    it.each([
        'This article is not legal advice.',
        'SafeHaul stores and organises documents. It does not monitor expiry dates or send renewal reminders.',
        'SafeHaul does not run MVR, PSP or Clearinghouse checks.',
        'Two-way conversation threads and automated drip sequences are not available.',
        "A job board isn't part of SafeHaul.",
        // The negation nearest the claim decides, and "or" stays inside it.
        'SafeHaul does not monitor expiry dates and does not send renewal reminders.',
        'SafeHaul neither pulls MVRs nor orders PSP reports.',
    ])('accepts %p', (text) => {
        expect(ok(text)).toBe(true);
    });

    it('accepts every approved claim and every limitation in the capability package', () => {
        // The generator is told to state these limitations, so a check that
        // refuses them refuses every article that follows its instructions.
        // Three of them were refused before this file existed.
        const texts = knowledge.FEATURES.flatMap((feature) => [...feature.approvedClaims, ...feature.limitations]);
        const refused = texts.filter((text) => !ok(text));
        expect(refused).toEqual([]);
    });
});

describe('a claim is still a claim', () => {
    it.each([
        ['SafeHaul pulls MVRs and PSP reports automatically.', 'SafeHaul runs MVR or PSP checks'],
        ['SafeHaul does not run MVR checks, but it integrates with PSP screening providers.', 'SafeHaul runs MVR or PSP checks'],
        ['SafeHaul runs MVR checks, so you never have to.', 'SafeHaul runs MVR or PSP checks'],
        ['SafeHaul runs drip campaigns that are not spammy.', 'SafeHaul runs drip campaigns'],
        ['SafeHaul sends automated expiry reminders for every driver document.', 'SafeHaul sends expiry reminders'],
        ['We give you legal advice on every hire.', 'SafeHaul provides legal advice'],
        // A negation denies its own predicate, not every claim after it in the
        // clause: "and", or a comma and a new subject, starts another predicate.
        ['SafeHaul is not a staffing agency and pulls MVRs automatically.', 'SafeHaul runs MVR or PSP checks'],
        ['SafeHaul does not replace your compliance team, and it sends automated expiry reminders.', 'SafeHaul sends expiry reminders'],
        ["SafeHaul isn't a background-check vendor, it pulls MVRs straight from the states.", 'SafeHaul runs MVR or PSP checks'],
        ['SafeHaul runs drip campaigns and texting is not available.', 'SafeHaul runs drip campaigns'],
    ])('refuses %p', (text, claim) => {
        expect(knowledge.checkClaims(text).violations).toContainEqual({ claim });
    });

    it('names a claim once, however many patterns or sentences make it', () => {
        const result = knowledge.checkClaims('SafeHaul runs MVR checks. SafeHaul also pulls MVRs for you.');
        expect(result.violations).toEqual([{ claim: 'SafeHaul runs MVR or PSP checks' }]);
    });
});

describe('who is speaking', () => {
    const advice = 'Carriers should run an MVR check on every applicant and a Clearinghouse query before hiring.';

    it('reads an industry article only where it speaks about SafeHaul', () => {
        expect(ok(advice, { scope: 'mentions' })).toBe(true);
        expect(ok(`${advice} SafeHaul pulls MVRs for you.`, { scope: 'mentions' })).toBe(false);
    });

    it('reads the sentence after a mention too, where "it" may still be SafeHaul', () => {
        expect(ok('SafeHaul helps carriers hire. It also pulls MVRs for you.', { scope: 'mentions' })).toBe(false);
        expect(ok('SafeHaul helps carriers hire. Drivers move often. Carriers still run MVR checks.', { scope: 'mentions' }))
            .toBe(true);
    });

    it('reads every sentence on SafeHaul\'s own pages and articles, the default', () => {
        expect(ok(advice)).toBe(false);
    });
});
