// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { build } from 'vite';
import { GLYPH_NAMES } from './glyphs.js';
import { glyphModuleSource, splitGlyphRegistry, splitGlyphRegistrySource } from './splitGlyphRegistry.js';
import viteConfig from '../../../vite.config.js';

const iconsDir = path.dirname(fileURLToPath(import.meta.url));
const registryFile = path.join(iconsDir, 'glyphs.js');
const registry = fs.readFileSync(registryFile, 'utf8');

const reExported = (facade) => [...facade.matchAll(/^export \{ (\w+) \} from 'virtual:safehaul-glyph\/\1';$/gm)].map(([, name]) => name);

describe('splitting the glyph registry', () => {
    it('re-exports every glyph from a module of its own, and keeps the rest of the registry', () => {
        const { facade, glyphs } = splitGlyphRegistrySource(registry);
        expect(reExported(facade).sort()).toEqual([...GLYPH_NAMES].sort());
        expect([...glyphs.keys()].sort()).toEqual([...GLYPH_NAMES].sort());
        expect(facade).not.toMatch(/from 'lucide-react'/);
        expect(facade).toMatch(/^export const GLYPH_NAMES = Object\.freeze\(\[/m);
    });

    it('mints each glyph from the lucide component the registry imported for it', () => {
        const { glyphs } = splitGlyphRegistrySource(registry);
        // `AlertTriangle` is a lucide compatibility alias; the module imports the
        // alias the registry wrote, under the name the codebase writes.
        expect(glyphs.get('AlertTriangle')).toBe('AlertTriangle');
        expect(glyphModuleSource('Trash2', glyphs.get('Trash2'), iconsDir)).toBe(
            "import { Trash2 as Lucide } from 'lucide-react';\n"
            + `import { glyph } from '${iconsDir}/glyph.js';\n`
            + "export const Trash2 = /* #__PURE__ */ glyph(Lucide, 'Trash2');\n",
        );
    });

    const registryWith = (lines) => "import {\n    Trash2 as LucideTrash2, X as LucideX,\n} from 'lucide-react';\n\n"
        + "import { glyph } from './glyph.js';\n\n" + lines.join('\n') + '\n';
    const trash = "export const Trash2 = /* #__PURE__ */ glyph(LucideTrash2, 'Trash2');";

    it.each([
        ['a glyph minted without the pure mark', [trash, "export const X = glyph(LucideX, 'X');"], /another shape/],
        ['a glyph labelled with another name', [trash, "export const X = /* #__PURE__ */ glyph(LucideX, 'Close');"], /X is labelled 'Close'/],
        ['a glyph wrapping a component lucide-react did not supply', [trash, "export const X = /* #__PURE__ */ glyph(LucideZ, 'X');"], /not imported from lucide-react/],
        ['an imported icon that is never exported', [trash], /never exported: LucideX/],
    ])('refuses %s', (_, lines, message) => {
        expect(() => splitGlyphRegistrySource(registryWith(lines))).toThrow(message);
    });

    it('applies to the production build only, and to no other module', () => {
        const plugin = splitGlyphRegistry();
        expect(plugin.apply).toBe('build');
        expect(plugin.transform.call({}, registry, path.join(iconsDir, 'Icon.jsx'))).toBeNull();
        expect(viteConfig.plugins.flat().map((p) => p?.name)).toContain('safehaul:split-glyph-registry');
    });
});

describe('a production build with the split registry', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'glyph-split-'));
    // The glyph modules import `lucide-react` from the build's root, as in the app.
    fs.symlinkSync(path.resolve(iconsDir, '../../../node_modules'), path.join(root, 'node_modules'));
    afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

    /** Builds an entry drawing one glyph and a lazy screen drawing another; returns each chunk's code. */
    async function chunksOf(plugins) {
        fs.writeFileSync(path.join(root, 'entry.js'),
            `import { AlertCircle } from ${JSON.stringify(registryFile)};\nconsole.log(AlertCircle);\nimport('./screen.js');\n`);
        fs.writeFileSync(path.join(root, 'screen.js'),
            `import { ServerCog } from ${JSON.stringify(registryFile)};\nconsole.log(ServerCog);\n`);
        const output = await build({
            root, configFile: false, logLevel: 'silent', plugins,
            build: { write: false, minify: false, rolldownOptions: { input: path.join(root, 'entry.js') } },
        });
        const chunks = (Array.isArray(output) ? output[0] : output).output.filter((file) => file.type === 'chunk');
        return {
            entry: chunks.find((chunk) => chunk.isEntry).code,
            screen: chunks.filter((chunk) => !chunk.isEntry).map((chunk) => chunk.code).join('\n'),
        };
    }

    it('puts a glyph in the chunk of the screen that draws it', async () => {
        const { entry, screen } = await chunksOf([splitGlyphRegistry()]);
        expect(entry).toMatch(/glyph\([\w$]+, "AlertCircle"\)/);
        expect(entry).not.toContain('ServerCog');
        expect(screen).toMatch(/glyph\([\w$]+, "ServerCog"\)/);
    }, 60_000);

    it('without the split, the entry carries every glyph a screen draws', async () => {
        const { entry } = await chunksOf([]);
        expect(entry).toMatch(/glyph\([\w$]+, "ServerCog"\)/);
    }, 60_000);
});
