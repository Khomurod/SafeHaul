/**
 * Splits the glyph registry into one module per glyph, in the production build.
 *
 * `glyphs.js` mints every token in one module, and Rollup puts a module whole
 * into one chunk. The first screen draws a few glyphs, so that chunk was the
 * entry, and every glyph any screen draws rode in every page's first download:
 * 168 lucide icons, 12 kB gzip. Here each line of the registry becomes a
 * module of its own and `glyphs.js` re-exports them, so a glyph lands in the
 * chunk of the screens that draw it.
 *
 * Only the build (`apply: 'build'`). Split for real, a page on the dev server
 * made 171 more requests and loaded 18% slower, and the tests would load 171
 * more modules; there the registry stays one module, which behaves the same.
 *
 * The registry keeps its one shape: each glyph one line exporting `X` as a
 * pure-marked `glyph(LucideX, 'X')`, with `LucideX` imported from
 * `lucide-react`. The build refuses a glyph in any other shape rather than
 * leave it behind in the entry.
 */

const REGISTRY = '/src/design-system/icons/glyphs.js';
const VIRTUAL = 'virtual:safehaul-glyph/';
const RESOLVED = `\0${VIRTUAL}`;
const GLYPH_LINE = /^export const (\w+) = \/\* #__PURE__ \*\/ glyph\((\w+), '(\w+)'\);$/gm;
const LUCIDE_IMPORT = /^import \{([^}]*)\} from 'lucide-react';\n/m;
const GLYPH_IMPORT = /^import \{ glyph \} from '\.\/glyph\.js';\n/m;

const withoutComments = (code) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

/**
 * The registry's source as a module that re-exports one virtual module per
 * glyph, and which lucide component each glyph wraps. Throws when a glyph
 * would stay behind.
 */
export function splitGlyphRegistrySource(code) {
    const lucideImport = code.match(LUCIDE_IMPORT);
    if (!lucideImport) throw new Error('glyphs.js: no `import { … } from \'lucide-react\'` to split.');
    const lucideNameOf = new Map();
    for (const specifier of lucideImport[1].split(',').map((s) => s.trim()).filter(Boolean)) {
        const [lucideName, local = lucideName] = specifier.split(/\s+as\s+/);
        lucideNameOf.set(local, lucideName);
    }

    const glyphs = new Map();
    const facade = code
        .replace(LUCIDE_IMPORT, '')
        .replace(GLYPH_IMPORT, '')
        .replace(GLYPH_LINE, (line, name, local, label) => {
            if (name !== label) throw new Error(`glyphs.js: ${name} is labelled '${label}'.`);
            if (!lucideNameOf.has(local)) throw new Error(`glyphs.js: ${name} wraps ${local}, which is not imported from lucide-react.`);
            if (glyphs.has(name)) throw new Error(`glyphs.js: ${name} is exported twice.`);
            glyphs.set(name, lucideNameOf.get(local));
            lucideNameOf.delete(local);
            return `export { ${name} } from '${VIRTUAL}${name}';`;
        });

    const left = withoutComments(facade);
    if (/\bglyph\(/.test(left)) throw new Error('glyphs.js: a glyph is minted in another shape; write it as `export const X = /* #__PURE__ */ glyph(LucideX, \'X\');`.');
    if (lucideNameOf.size) throw new Error(`glyphs.js: imported from lucide-react but never exported: ${[...lucideNameOf.keys()].join(', ')}.`);
    if (!glyphs.size) throw new Error('glyphs.js: no glyph to split.');
    return { facade, glyphs };
}

/** The module one glyph is minted in. */
export function glyphModuleSource(name, lucideName, registryDir) {
    return `import { ${lucideName} as Lucide } from 'lucide-react';\n`
        + `import { glyph } from '${registryDir}/glyph.js';\n`
        + `export const ${name} = /* #__PURE__ */ glyph(Lucide, '${name}');\n`;
}

export function splitGlyphRegistry() {
    let glyphs = new Map();
    let registryDir = null;
    return {
        name: 'safehaul:split-glyph-registry',
        apply: 'build',
        // Before any other plugin, so it reads the registry as written.
        enforce: 'pre',
        transform(code, id) {
            const file = id.split('?')[0];
            if (!file.endsWith(REGISTRY)) return null;
            try {
                const split = splitGlyphRegistrySource(code);
                glyphs = split.glyphs;
                registryDir = file.slice(0, file.lastIndexOf('/'));
                return { code: split.facade, map: null };
            } catch (error) {
                return this.error(error.message);
            }
        },
        resolveId(source) {
            return source.startsWith(VIRTUAL) ? `\0${source}` : null;
        },
        load(id) {
            if (!id.startsWith(RESOLVED)) return null;
            const name = id.slice(RESOLVED.length);
            if (!glyphs.has(name)) return this.error(`no glyph named ${name} in glyphs.js`);
            return glyphModuleSource(name, glyphs.get(name), registryDir);
        },
    };
}
