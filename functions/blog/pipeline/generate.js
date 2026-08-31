/**
 * The article pipeline.
 *
 * One slot in, one published post or one recorded refusal out. The stages run
 * in a fixed order and any of them may stop the run:
 *
 *   1. gather current source items
 *   2. drop stale and duplicate items
 *   3. pick a candidate topic for the theme
 *   4. compare against the last 60 days
 *   5. build a fact package from the sources
 *   6. generate a structured draft through the shared AI router
 *   7. validate title, slug, description and structure
 *   8. verify claims against the sources (a separate AI request)
 *   9. verify SafeHaul claims against the approved capability package
 *  10. check originality against recent articles
 *  11. find a legally usable image
 *  12. sanitize
 *  13. save
 *
 * Refusing to publish is a valid, recorded outcome. There is no path in this
 * file that fills a slot with a fabricated topic, an unsupported claim or an
 * unlicensed image because the daily count would otherwise be short.
 */

const { getTheme } = require('./themes');
const { gatherSourceItems, fetchDocumentText } = require('../research/fetchSources');
const { isPrimary } = require('../research/sources');
const dedupe = require('./dedupe');
const sanitize = require('./sanitize');
const { findLicensedImage, isLicenceComplete } = require('../media/imageProviders');
const knowledgePackage = require('../../ai/knowledge/safehaulCapabilities');
const { generateArticle, verifyArticleClaims } = require('../../ai/tasks/articleGeneration');
const { MAX_CANDIDATES, isRoadFreightRelevant, buildCandidates } = require('./candidates');
const { buildFactPackage, sourcingIsSufficient } = require('./evidence');
const { MIN_WORD_COUNT, validateDraft } = require('./validation');
const { PUBLIC_ORIGIN, buildSeo } = require('./seo');

/** Outcomes, so a refusal is as legible as a success. */
const OUTCOME = Object.freeze({
    PUBLISHED: 'published',
    SKIPPED_NO_SOURCES: 'skipped_no_sources',
    SKIPPED_ALL_DUPLICATES: 'skipped_all_duplicates',
    SKIPPED_VALIDATION: 'skipped_validation',
    SKIPPED_UNSUPPORTED_CLAIMS: 'skipped_unsupported_claims',
    SKIPPED_PROHIBITED_CLAIM: 'skipped_prohibited_claim',
    SKIPPED_NOT_ORIGINAL: 'skipped_not_original',
    SKIPPED_SLOT_TAKEN: 'skipped_slot_taken',
    FAILED_GENERATION: 'failed_generation',
});

/*
 * `runSlot` is 342 lines and is deliberately kept whole. It is the pipeline's
 * control-flow spine: thirteen stages in a fixed order, each with a return
 * site that records why a slot was refused, and `runLedger` documents itself
 * against those return sites. The helpers it decides with live in
 * `candidates.js`, `evidence.js`, `validation.js` and `seo.js`; decomposing
 * the loop itself is a behaviour-risk refactor that deserves its own unit and
 * its own evidence, not a side effect of a size campaign.
 */

/**
 * Runs the pipeline for one slot.
 *
 * @param {object} slot `{ themeId, publicationDate, key }`
 * @param {object} context
 * @param {object} context.store blog store
 * @param {Map} [context.mediaCredentials]
 * @param {Function} [context.fetchImpl]
 * @param {object} [context.aiDeps]
 * @returns {Promise<{ outcome: string, slot: object, detail?: string, post?: object }>}
 */
async function runSlot(slot, context) {
    const { store, mediaCredentials = new Map(), fetchImpl, aiDeps = {}, now = Date.now() } = context;
    const theme = getTheme(slot.themeId);
    if (!theme) throw new Error(`Unknown theme "${slot.themeId}".`);

    /**
     * What the run ledger needs, accumulated as the pipeline goes.
     *
     * Held here rather than added at each of the fourteen `return` sites below:
     * a field that has to be remembered at every exit is a field the fifteenth
     * exit forgets, and the ledger's whole value is that it is always complete.
     * `runSlot` returns it once, at the end, through `finish`.
     */
    const trail = {
        transactions: { generation: null, verification: null },
        verification: null,
        providerId: null,
        model: null,
        fallbackCount: null,
    };

    const finish = (result) => ({ ...trail, ...result });

    // Cheap guard before spending any AI or network budget. The document-id
    // create is still the authoritative check.
    if (await store.slotIsFilled(slot.publicationDate, slot.themeId)) {
        return finish({ outcome: OUTCOME.SKIPPED_SLOT_TAKEN, slot });
    }

    const recentPosts = await store.recentForDeduplication({ now });
    const recentTitles = recentPosts.slice(0, 25).map((post) => post.title).filter(Boolean);

    // --- 1 & 2. Gather and clean source items ---------------------------------
    let sources = [];
    let topic = null;

    if (theme.requiresSources) {
        const { items } = await gatherSourceItems({
            sourceIds: undefined,
            // 21 days for every theme, including regulatory news.
            //
            // A 7-day window looked like editorial rigour and was actually a
            // guarantee of thin articles: FMCSA does not publish substantive
            // rules weekly. Measured on 2026-08-03, the only primary documents
            // inside 7 days were one-to-three page exemption notices, and an
            // honest article from a three-page notice runs ~355 words against a
            // 450-word floor. Widening to 21 days surfaced a ten-page rule —
            // real regulatory substance to write about.
            //
            // Recency is not abandoned, it is ranked: `buildCandidates` sorts by
            // tier, then document length, then date, and the 60-day duplicate
            // window still prevents re-covering the same story. A considered piece
            // on a rule from two weeks ago is better trade journalism than a
            // padded paragraph about yesterday's exemption withdrawal.
            maxAgeDays: 21,
            fetchImpl,
            now,
        });
        const candidates = buildCandidates(items, theme);

        if (candidates.length === 0) {
            return finish({ outcome: OUTCOME.SKIPPED_NO_SOURCES, slot, detail: 'no current items matched this theme' });
        }

        // --- 3 & 4. Choose a topic that is not a repeat -----------------------
        const fresh = candidates.filter((candidate) => !dedupe.checkForDuplicate(
            { title: candidate.title, sourceUrls: [candidate.url] },
            recentPosts,
        ).duplicate);

        if (fresh.length === 0) {
            return finish({
                outcome: OUTCOME.SKIPPED_ALL_DUPLICATES,
                slot,
                detail: `all ${candidates.length} candidates repeat recent coverage`,
            });
        }

        // Only offer leads that can actually satisfy this theme's sourcing bar.
        //
        // Topic selection and the sourcing rule used to disagree: the model was
        // shown every fresh candidate, sensibly picked the most newsworthy one,
        // and the run was then thrown away because the resulting fact package
        // held no primary source — a rule the model was never told about. In
        // production that produced `skipped_no_sources (no primary or official
        // source)` on four consecutive runs while perfectly publishable
        // primary-sourced candidates sat in the same list.
        //
        // Refusing to publish when a well-sourced option is available is a bug,
        // not caution. The sourcing bar itself is unchanged and still absolute:
        // if no candidate can meet it, the slot is still refused.
        const viable = fresh.filter(
            (candidate) => sourcingIsSufficient(buildFactPackage(candidate, fresh, theme), theme).ok,
        );

        if (viable.length === 0) {
            // Report the bar the whole set failed, not one arbitrary candidate's.
            const reason = sourcingIsSufficient(buildFactPackage(fresh[0], fresh, theme), theme).reason;
            return finish({
                outcome: OUTCOME.SKIPPED_NO_SOURCES,
                slot,
                detail: `${reason} (none of ${fresh.length} candidates)`,
            });
        }

        // Topic selection is no longer an AI call.
        //
        // It was always documented as "a convenience" — on failure the code fell
        // back to the freshest candidate and carried on. Two things have since made
        // it redundant and one has made it costly.
        //
        // Redundant: candidates are now ranked before the model ever sees them —
        // primary sources first, then document length, then recency — and filtered
        // to those that can satisfy the theme's sourcing bar. `viable[0]` is
        // therefore already the best-evidenced, most substantive story available,
        // which is the judgement the model was being asked to make.
        //
        // Costly: Groq's tier allows 8,000 tokens per minute and charges the full
        // requested output. Three sequential calls per run — selection, generation,
        // verification — overran that budget and generation was rejected outright
        // *after* selection had succeeded, which is the worst possible order. Two
        // calls fit; three did not.
        //
        // Claim verification is NOT dropped. That one is a safety control, not a
        // convenience: it is the check that an article asserts nothing its sources
        // do not support.
        const lead = viable[0];
        topic = { title: lead.title, angle: theme.editorialAngle };

        // --- 5. Fact package -------------------------------------------------
        //
        // Fetch the lead document's full text before building the package. An
        // article written from a one-paragraph abstract is a one-paragraph
        // article: drafts came in at 251 words against a 450-word floor because
        // the abstract was everything the model had. One extra request, for the
        // chosen lead only, and a failure falls back to the abstract.
        if (lead.rawTextUrl) {
            const fullText = await fetchDocumentText(lead.rawTextUrl, { fetchImpl });
            if (fullText) lead.fullText = fullText;
        }

        sources = buildFactPackage(lead, fresh, theme);
        // Belt and braces: `viable` was computed with this exact call, so this
        // cannot fire. It stays because publishing an under-sourced article is
        // the one failure this pipeline must never have.
        const sufficiency = sourcingIsSufficient(sources, theme);
        if (!sufficiency.ok) {
            return finish({ outcome: OUTCOME.SKIPPED_NO_SOURCES, slot, detail: sufficiency.reason });
        }
    } else {
        // The SafeHaul theme is written from the approved capability package.
        // Rotating by date keeps successive days on different features without
        // storing extra state.
        const features = knowledgePackage.availableFeatures();
        const dayNumber = Math.floor(Date.parse(`${slot.publicationDate}T00:00:00Z`) / 86400000);
        const feature = features[dayNumber % features.length];
        topic = {
            title: `${feature.name}: what it does and where it stops`,
            angle: `Explain the problem ${feature.name.toLowerCase()} addresses for a carrier, what SafeHaul actually does, and state its limitations honestly.`,
        };

        const repeat = dedupe.checkForDuplicate({ title: topic.title, sourceUrls: [] }, recentPosts);
        if (repeat.duplicate) {
            return finish({ outcome: OUTCOME.SKIPPED_ALL_DUPLICATES, slot, detail: `capability topic already covered (${repeat.reason})` });
        }
    }

    // --- 6. Generate -----------------------------------------------------------
    const knowledge = knowledgePackage.buildKnowledgeBriefing();
    const usesKnowledge = theme.id === 'safehaul-education';

    let generated;
    try {
        generated = await generateArticle({
            theme,
            topic,
            sources,
            knowledge: usesKnowledge ? knowledge : null,
            recentTitles,
        }, aiDeps);
    } catch (error) {
        return finish({
            outcome: OUTCOME.FAILED_GENERATION,
            slot,
            // `detail` carries the router's per-provider trail when there is one
            // — "groq=rate_limited, gemini=schema_validation_failed" — because
            // the bare category `all_providers_failed` is unactionable and cost
            // a full day of diagnosis. It is provider ids and categories only:
            // no credential, no prompt, no provider response body.
            detail: error?.detail || error?.category || 'generation failed',
        });
    }

    trail.transactions.generation = generated.transactionId || null;
    trail.providerId = generated.providerId || null;
    trail.model = generated.model || null;
    trail.fallbackCount = Number.isInteger(generated.fallbackCount) ? generated.fallbackCount : null;

    // --- 7. Structural validation ---------------------------------------------
    const validated = validateDraft(generated.article);
    if (!validated.ok) {
        return finish({ outcome: OUTCOME.SKIPPED_VALIDATION, slot, detail: validated.problems.join('; ') });
    }

    const plainText = sanitize.blocksToPlainText(validated.blocks);

    // --- 9. SafeHaul claim check (deterministic, runs for every theme) --------
    // Deliberately before the AI verification step: it is free, it cannot be
    // talked out of a verdict, and it applies even to a news article that
    // mentions SafeHaul in passing.
    const claimCheck = knowledgePackage.checkClaims(`${validated.title} ${plainText}`);
    if (!claimCheck.ok) {
        return finish({
            outcome: OUTCOME.SKIPPED_PROHIBITED_CLAIM,
            slot,
            detail: claimCheck.violations.map((violation) => violation.claim).join('; '),
        });
    }

    // --- 8. Source-backed claim verification ---------------------------------
    let verification = { supported: true, unsupportedClaims: [], notes: 'not run' };
    if (sources.length > 0 || usesKnowledge) {
        try {
            const checked = await verifyArticleClaims({
                articleText: `${validated.title}\n\n${plainText}`,
                sources,
                knowledge: usesKnowledge ? knowledge : null,
            }, aiDeps);
            verification = checked.verification;
            trail.transactions.verification = checked.transactionId || null;
        } catch {
            // A verification step that cannot run must not silently pass an
            // article. Publishing unverified factual claims is the failure mode
            // this whole pipeline exists to avoid.
            return finish({ outcome: OUTCOME.SKIPPED_UNSUPPORTED_CLAIMS, slot, detail: 'verification step unavailable' });
        }

        // The verdict, recorded whichever way it went. A successful fact-check
        // transaction that returned `supported: false` is the case that read as
        // two green rows and no article.
        trail.verification = {
            supported: Boolean(verification.supported),
            unsupportedClaimCount: Array.isArray(verification.unsupportedClaims)
                ? verification.unsupportedClaims.length
                : 0,
        };

        if (!verification.supported) {
            return finish({
                outcome: OUTCOME.SKIPPED_UNSUPPORTED_CLAIMS,
                slot,
                detail: verification.unsupportedClaims.slice(0, 3).join(' | '),
            });
        }
    }

    // --- 10. Originality against recent articles ------------------------------
    const originality = dedupe.checkForDuplicate(
        { title: validated.title, sourceUrls: sources.map((source) => source.url) },
        recentPosts,
    );
    if (originality.duplicate) {
        return finish({
            outcome: OUTCOME.SKIPPED_NOT_ORIGINAL,
            slot,
            detail: `${originality.reason} (similarity ${originality.similarity})`,
        });
    }

    // --- 11. Licensed image ---------------------------------------------------
    const image = await findLicensedImage({
        query: sanitize.cleanText(generated.article.imageQuery, 80) || 'semi truck highway',
        altText: sanitize.cleanText(generated.article.imageAltText, 200),
        credentials: mediaCredentials,
        fetchImpl,
        now,
    });

    if (!isLicenceComplete(image)) {
        // Should be unreachable: the fallback is always complete. If it ever
        // happens, publishing an image with unknown provenance is not the
        // answer.
        return finish({ outcome: OUTCOME.SKIPPED_VALIDATION, slot, detail: 'no image with complete licence metadata', stage: 'image' });
    }

    // --- 12 & 13. Assemble and save ------------------------------------------
    const post = {
        title: validated.title,
        slug: validated.slug,
        excerpt: validated.excerpt,
        contentBlocks: validated.blocks,
        theme: theme.id,
        publicationDate: slot.publicationDate,
        sources,
        image,
        seo: buildSeo({
            title: validated.title,
            slug: validated.slug,
            metaDescription: validated.metaDescription,
            image,
            publicationDate: slot.publicationDate,
        }),
        // Enough to explain later why this article was published, with no
        // hidden model reasoning: sources, checks and validation results only.
        generation: {
            providerId: generated.providerId,
            model: generated.model,
            fallbackCount: generated.fallbackCount,
            wordCount: validated.words,
            verification: {
                supported: verification.supported,
                unsupportedClaimCount: verification.unsupportedClaims.length,
            },
            claimCheckPassed: true,
            originalitySimilarity: originality.similarity,
            sourceCount: sources.length,
            hasPrimarySource: sources.some((source) => isPrimary(source.sourceId)),
            // The AI transactions behind this article, so a published post and the
            // Logs tab can be joined in both directions. The run ledger already
            // carries them for every outcome; a published article outlives its
            // ledger row's 30-day retention, so it keeps its own copy.
            // `publicApi.js` serves no generation metadata, so these stay internal.
            generationTransactionId: trail.transactions.generation || null,
            verificationTransactionId: trail.transactions.verification || null,
        },
        knowledgeVersion: knowledge.version,
        normalizedTitle: dedupe.normalizeTitle(validated.title),
        topicTokens: dedupe.topicTokens(validated.title),
        sourceFingerprint: dedupe.sourceFingerprint({
            title: validated.title,
            sourceUrls: sources.map((source) => source.url),
        }),
    };

    const saved = await store.createPost(post);
    if (!saved.created) {
        // Another run won the race. Correct outcome, not an error.
        return finish({ outcome: OUTCOME.SKIPPED_SLOT_TAKEN, slot });
    }

    return finish({ outcome: OUTCOME.PUBLISHED, slot, post: { ...post, id: saved.id } });
}

module.exports = {
    OUTCOME,
    MIN_WORD_COUNT,
    MAX_CANDIDATES,
    PUBLIC_ORIGIN,
    runSlot,
    buildCandidates,
    isRoadFreightRelevant,
    buildFactPackage,
    sourcingIsSufficient,
    validateDraft,
    buildSeo,
};
