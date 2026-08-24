/**
 * A static server for the built catalog, started by the visual specs.
 *
 * Playwright's own `webServer` already runs the application dev server on port
 * 5000 for every project. Adding a second entry there would start Storybook for
 * every E2E run in the repository, including the sharded lanes that have no use
 * for it. The visual specs start this instead, for as long as they need it.
 *
 * Same shape as the server in `scripts/check-table-layout.mjs`.
 */
const { createReadStream, existsSync, statSync } = require('node:fs');
const { createServer } = require('node:http');
const { extname, join, normalize, resolve } = require('node:path');

const STATIC_DIR = resolve(__dirname, '../../storybook-static');

const MIME = {
    '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
    '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
    '.woff': 'font/woff', '.woff2': 'font/woff2', '.png': 'image/png',
    '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.map': 'application/json',
};

async function startCatalogServer() {
    if (!existsSync(STATIC_DIR)) {
        throw new Error('No built catalog at storybook-static. Run `npm run build-storybook` first.');
    }
    const server = createServer((request, response) => {
        const url = new URL(request.url, 'http://localhost');
        let target = join(STATIC_DIR, normalize(decodeURIComponent(url.pathname)));
        if (!target.startsWith(STATIC_DIR)) { response.writeHead(403); response.end(); return; }
        if (existsSync(target) && statSync(target).isDirectory()) target = join(target, 'index.html');
        if (!existsSync(target)) { response.writeHead(404); response.end(); return; }
        response.writeHead(200, { 'content-type': MIME[extname(target)] || 'application/octet-stream' });
        createReadStream(target).pipe(response);
    });
    await new Promise((r) => server.listen(0, r));
    return { server, base: `http://127.0.0.1:${server.address().port}` };
}

module.exports = { startCatalogServer };
