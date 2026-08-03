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

/** Candidate stories considered per slot. */
const MAX_CANDIDATES = 12;

/**
 * An article shorter than this is not worth publishing.
 *
 * **300, down from 450, on the owner's explicit decision** after the trade-off was
 * put to them: the free tiers of both AI providers cannot sustain a longer
 * article, and the alternative was a paid tier. This is recorded at length because
 * it is a deliberate reduction in article substance below the 700-1,200 words
 * originally specified — not a constant that drifted.
 *
 * The owner asked for "up to 350". The floor sits at 300 because that is where
 * articles measurably land once the pipeline is sized to fit Groq's 8,000
 * tokens-per-minute ceiling: observed drafts ran 311 words. A 350 floor would
 * discard a sound 311-word article and publish nothing, which is the failure this
 * whole change exists to end.
 *
 * The prompt still asks for 350-600 so the model aims above the floor rather than
 * at it. Under-shooting is tolerated; padding is still forbidden.
 *
 * Three numbers move together — this floor, `maxOutputTokens` in
 * articleGeneration, and `MAX_DOCUMENT_TEXT_CHARS` in fetchSources. Raise all
 * three if a provider tier is upgraded.
 */
const MIN_WORD_COUNT = 300;

const PUBLIC_ORIGIN = 'https://safehaul.io';

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

/**
 * Whether an item is actually about road freight.
 *
 * ## Why a feed's topics are not enough
 *
 * `gatherSourceItems` stamps every item with **its source's** declared topics,
 * not topics derived from the item itself. `federal-register-dot` queries the
 * whole Department of Transportation, so an FAA airspace notice, an FRA
 * locomotive rule and a TVA environmental finding all arrive tagged
 * `regulation, compliance, freight-market` and all pass a theme-topic filter.
 *
 * That is not a hypothetical. On 2026-08-03 the twelve top candidates for the
 * industry-news slot were, in order: high-speed train noise standards, three VHF
 * omnidirectional range amendments, Class D/E airspace over Morgantown WV, a TVA
 * categorical exclusion, an unleaded aviation gasoline transition plan,
 * locomotive engineer certification, and Jet Route J-24. Not one concerned
 * trucking. A trucking publication that runs an article about jet routes is
 * worse than one that runs nothing, so this gate is deliberately applied before
 * anything reaches an editor or a model.
 *
 * A keyword gate is crude, and it is chosen over asking a model precisely
 * because it is deterministic, free, and cannot be talked into approving an
 * aviation notice. It is a floor on relevance, not a judgement of newsworthiness
 * — that judgement stays with topic selection, further down.
 *
 * If this proves too narrow the fix is to add terms here, not to remove the
 * gate: the failure it prevents is publishing off-topic content under
 * SafeHaul's name.
 */
const ROAD_FREIGHT_PATTERN = new RegExp([
    'truck', 'trucking', 'motor carrier', 'motor-carrier', 'commercial motor vehicle', '\\bcmv\\b',
    'tractor[- ]trailer', 'semi[- ]trailer', '\\bfmcsa\\b', 'hours of service', '\\bhos\\b',
    'commercial driver', '\\bcdl\\b', 'electronic logging', '\\beld\\b', 'drayage',
    'freight broker', 'for-hire carrier', 'owner[- ]operator', 'fleet safety', 'roadside inspection',
    'driver qualification', 'drug and alcohol clearinghouse', 'unified carrier registration',
    'hazardous materials transport', 'interstate trucking', 'highway freight', 'driver shortage',
].join('|'), 'i');

function isRoadFreightRelevant(item) {
    return ROAD_FREIGHT_PATTERN.test(`${item?.title || ''} ${item?.summary || ''}`);
}

/**
 * Builds the candidate list for a theme from gathered items.
 *
 * For a regulatory theme, candidates are ordered primary-source-first, because
 * an article about a rule should be written from the rule.
 */
function buildCandidates(items, theme) {
    const wanted = new Set(theme.topics);
    const relevant = items
        .filter((item) => item.topics.some((topic) => wanted.has(topic)))
        // Feed topics are coarse; the item must be about road freight itself.
        .filter(isRoadFreightRelevant);

    const seen = new Set();
    const deduped = [];
    for (const item of relevant) {
        const key = dedupe.canonicalizeUrl(item.url) || dedupe.normalizeTitle(item.title);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        deduped.push(item);
    }

    deduped.sort((a, b) => {
        if (theme.requiresPrimarySource && a.tier !== b.tier) return a.tier === 'primary' ? -1 : 1;
        // A ten-page rule supports an article; a one-page exemption withdrawal
        // does not, however recent it is. Federal Register documents carry
        // `pageLength`, so prefer substance before recency where it is known.
        // Without this, the freshest candidate is routinely a one-paragraph
        // notice and the resulting draft is honestly too short to publish.
        const weightA = Number.isFinite(a.pageLength) ? a.pageLength : 0;
        const weightB = Number.isFinite(b.pageLength) ? b.pageLength : 0;
        if (theme.requiresPrimarySource && weightA !== weightB) return weightB - weightA;
        const dateA = a.publishedAt ? Date.parse(a.publishedAt) : 0;
        const dateB = b.publishedAt ? Date.parse(b.publishedAt) : 0;
        return dateB - dateA;
    });

    return deduped.slice(0, MAX_CANDIDATES);
}

/**
 * Assembles the evidence an article is allowed to draw on.
 *
 * Corroborating items are chosen by topic overlap with the lead item, so a
 * two-source article is genuinely about one story rather than two unrelated
 * ones stapled together.
 */
function buildFactPackage(lead, candidates, theme) {
    const sources = [lead];
    const leadTokens = dedupe.topicTokens(`${lead.title} ${lead.summary || ''}`);

    for (const candidate of candidates) {
        if (sources.length >= 4) break;
        if (candidate === lead) continue;
        if (dedupe.canonicalizeUrl(candidate.url) === dedupe.canonicalizeUrl(lead.url)) continue;

        const similarity = dedupe.tokenSimilarity(
            leadTokens,
            dedupe.topicTokens(`${candidate.title} ${candidate.summary || ''}`),
        );
        if (similarity >= 0.15) sources.push(candidate);
    }

    return sources.map((source) => ({
        title: source.title,
        publisher: source.publisher,
        url: source.url,
        summary: source.summary,
        publishedAt: source.publishedAt,
        sourceId: source.sourceId,
        tier: source.tier,
        retrievedAt: source.retrievedAt,
        // Regulatory context the model can legitimately explain to a carrier.
        action: source.action || null,
        docketIds: source.docketIds || [],
        cfrReferences: source.cfrReferences || [],
        // Populated for the lead only, by runSlot, after selection.
        fullText: source.fullText || null,
    }));
}

/**
 * Whether the evidence meets the theme's sourcing bar.
 *
 * Two rules, in priority order:
 *
 *  1. A claim about a law, rule or government action needs the body that issued
 *    it. This is absolute — a regulatory article sourced only from trade
 *    coverage is refused however many outlets reported it.
 *  2. Corroboration is required "where practical". Two independent sources is
 *    the target, but a single *primary* source already satisfies the intent: an
 *    article written from the Federal Register notice itself is better evidenced
 *    than one written from two publishers summarising it. Requiring a second
 *    source in that case would refuse the best-sourced article we can produce.
 *
 * A single *secondary* source is never enough.
 */
function sourcingIsSufficient(sources, theme) {
    if (!theme.requiresSources) return { ok: true, reason: null };
    if (sources.length === 0) return { ok: false, reason: 'no sources' };

    const hasPrimary = sources.some((source) => isPrimary(source.sourceId));

    if (theme.requiresPrimarySource && !hasPrimary) {
        return { ok: false, reason: 'no primary or official source' };
    }

    if (sources.length < theme.minSources && !hasPrimary) {
        return {
            ok: false,
            reason: `needs ${theme.minSources} sources or one primary source, has ${sources.length} secondary`,
        };
    }

    return { ok: true, reason: null };
}

/**
 * Structural validation of a generated draft. Runs before the AI verification
 * step because it is deterministic and free.
 */
function validateDraft(article) {
    const problems = [];
    const title = sanitize.cleanText(article?.title, 200);
    const slug = sanitize.slugify(title);
    const blocks = sanitize.sanitizeBlocks(article?.blocks);
    const words = sanitize.wordCount(blocks);

    if (title.length < 20) problems.push('title too short');
    if (title.length > 110) problems.push('title too long');
    if (!sanitize.isValidSlug(slug)) problems.push('title does not yield a usable slug');
    if (blocks.length < 4) problems.push('too few content blocks survived sanitization');
    if (words < MIN_WORD_COUNT) problems.push(`article too short (${words} words)`);

    const metaDescription = sanitize.cleanText(article?.metaDescription, 165);
    if (metaDescription.length < 60) problems.push('meta description too short');

    const excerpt = sanitize.cleanText(article?.excerpt, 320);
    if (excerpt.length < 60) problems.push('excerpt too short');

    // A heading identical to the title reads as a duplicated document title.
    const duplicateHeading = blocks.some(
        (block) => block.type === 'heading' && dedupe.normalizeTitle(block.text) === dedupe.normalizeTitle(title),
    );
    if (duplicateHeading) problems.push('a heading repeats the title');

    return { ok: problems.length === 0, problems, title, slug, blocks, words, metaDescription, excerpt };
}

/** Builds the SEO metadata block stored with the post. */
function buildSeo({ title, slug, metaDescription, image, publicationDate }) {
    const canonicalUrl = `${PUBLIC_ORIGIN}/news/${slug}`;
    return {
        canonicalUrl,
        metaDescription,
        openGraph: {
            title,
            description: metaDescription,
            image: image?.imageUrl || null,
            url: canonicalUrl,
            type: 'article',
        },
        twitter: {
            card: image?.imageUrl ? 'summary_large_image' : 'summary',
            title,
            description: metaDescription,
            image: image?.imageUrl || null,
        },
        author: 'SafeHaul Editorial Team',
        publicationDate,
    };
}

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

    // Cheap guard before spending any AI or network budget. The document-id
    // create is still the authoritative check.
    if (await store.slotIsFilled(slot.publicationDate, slot.themeId)) {
        return { outcome: OUTCOME.SKIPPED_SLOT_TAKEN, slot };
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
            return { outcome: OUTCOME.SKIPPED_NO_SOURCES, slot, detail: 'no current items matched this theme' };
        }

        // --- 3 & 4. Choose a topic that is not a repeat -----------------------
        const fresh = candidates.filter((candidate) => !dedupe.checkForDuplicate(
            { title: candidate.title, sourceUrls: [candidate.url] },
            recentPosts,
        ).duplicate);

        if (fresh.length === 0) {
            return {
                outcome: OUTCOME.SKIPPED_ALL_DUPLICATES,
                slot,
                detail: `all ${candidates.length} candidates repeat recent coverage`,
            };
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
            return {
                outcome: OUTCOME.SKIPPED_NO_SOURCES,
                slot,
                detail: `${reason} (none of ${fresh.length} candidates)`,
            };
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
            return { outcome: OUTCOME.SKIPPED_NO_SOURCES, slot, detail: sufficiency.reason };
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
            return { outcome: OUTCOME.SKIPPED_ALL_DUPLICATES, slot, detail: `capability topic already covered (${repeat.reason})` };
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
        return {
            outcome: OUTCOME.FAILED_GENERATION,
            slot,
            // `detail` carries the router's per-provider trail when there is one
            // — "groq=rate_limited, gemini=schema_validation_failed" — because
            // the bare category `all_providers_failed` is unactionable and cost
            // a full day of diagnosis. It is provider ids and categories only:
            // no credential, no prompt, no provider response body.
            detail: error?.detail || error?.category || 'generation failed',
        };
    }

    // --- 7. Structural validation ---------------------------------------------
    const validated = validateDraft(generated.article);
    if (!validated.ok) {
        return { outcome: OUTCOME.SKIPPED_VALIDATION, slot, detail: validated.problems.join('; ') };
    }

    const plainText = sanitize.blocksToPlainText(validated.blocks);

    // --- 9. SafeHaul claim check (deterministic, runs for every theme) --------
    // Deliberately before the AI verification step: it is free, it cannot be
    // talked out of a verdict, and it applies even to a news article that
    // mentions SafeHaul in passing.
    const claimCheck = knowledgePackage.checkClaims(`${validated.title} ${plainText}`);
    if (!claimCheck.ok) {
        return {
            outcome: OUTCOME.SKIPPED_PROHIBITED_CLAIM,
            slot,
            detail: claimCheck.violations.map((violation) => violation.claim).join('; '),
        };
    }

    // --- 8. Source-backed claim verification ---------------------------------
    let verification = { supported: true, unsupportedClaims: [], notes: 'not run' };
    if (sources.length > 0 || usesKnowledge) {
        try {
            verification = await verifyArticleClaims({
                articleText: `${validated.title}\n\n${plainText}`,
                sources,
                knowledge: usesKnowledge ? knowledge : null,
            }, aiDeps);
        } catch {
            // A verification step that cannot run must not silently pass an
            // article. Publishing unverified factual claims is the failure mode
            // this whole pipeline exists to avoid.
            return { outcome: OUTCOME.SKIPPED_UNSUPPORTED_CLAIMS, slot, detail: 'verification step unavailable' };
        }

        if (!verification.supported) {
            return {
                outcome: OUTCOME.SKIPPED_UNSUPPORTED_CLAIMS,
                slot,
                detail: verification.unsupportedClaims.slice(0, 3).join(' | '),
            };
        }
    }

    // --- 10. Originality against recent articles ------------------------------
    const originality = dedupe.checkForDuplicate(
        { title: validated.title, sourceUrls: sources.map((source) => source.url) },
        recentPosts,
    );
    if (originality.duplicate) {
        return {
            outcome: OUTCOME.SKIPPED_NOT_ORIGINAL,
            slot,
            detail: `${originality.reason} (similarity ${originality.similarity})`,
        };
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
        return { outcome: OUTCOME.SKIPPED_VALIDATION, slot, detail: 'no image with complete licence metadata' };
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
        return { outcome: OUTCOME.SKIPPED_SLOT_TAKEN, slot };
    }

    return { outcome: OUTCOME.PUBLISHED, slot, post: { ...post, id: saved.id } };
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
