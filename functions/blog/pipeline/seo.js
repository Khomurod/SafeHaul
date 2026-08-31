/**
 * The SEO metadata a published post ships with. Extracted from `generate.js`.
 */

const PUBLIC_ORIGIN = 'https://safehaul.io';

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

module.exports = {
    PUBLIC_ORIGIN,
    buildSeo,
};
