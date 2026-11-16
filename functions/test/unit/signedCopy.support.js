/**
 * Doubles shared by the company signature and signed-copy suites: a Storage
 * bucket that keeps bytes by path, and real tiny images and PDFs to put in it,
 * so pdf-lib embeds and reads them for real. Every value is artificial.
 */
const fs = require('fs');
const zlib = require('zlib');
const { PDFDocument, PDFDict, PDFName, StandardFonts } = require('pdf-lib');

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function pngChunk(type, data) {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body));
    return Buffer.concat([length, body, crc]);
}

/** A real PNG, `width` × `height` pixels of one RGB colour. */
function tinyPng(width, height, rgb = [0, 0, 0]) {
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width, 0);
    header.writeUInt32BE(height, 4);
    header[8] = 8; // bits per channel
    header[9] = 2; // truecolour
    const row = Buffer.concat([Buffer.from([0]), ...Array.from({ length: width }, () => Buffer.from(rgb))]);
    const pixels = Buffer.concat(Array.from({ length: height }, () => row));
    return Buffer.concat([
        PNG_SIGNATURE,
        pngChunk('IHDR', header),
        pngChunk('IDAT', zlib.deflateSync(pixels)),
        pngChunk('IEND', Buffer.alloc(0)),
    ]);
}

/** A real 1 × 1 greyscale JPEG. */
const TINY_JPEG = Buffer.from(
    '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////'
    + '////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=',
    'base64',
);

/** A real one-page Letter PDF. */
async function onePagePdf(text = 'Synthetic document') {
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([612, 792]);
    page.drawText(text, { x: 50, y: 740, size: 12, font: await pdfDoc.embedFont(StandardFonts.Helvetica) });
    return Buffer.from(await pdfDoc.save());
}

/** For each page of `pdfBytes`, the images it draws, as `{ width, height }` in pixels. */
async function imagesOnPages(pdfBytes) {
    const pdfDoc = await PDFDocument.load(pdfBytes);
    return pdfDoc.getPages().map((page) => {
        const xObjects = page.node.Resources()?.lookupMaybe(PDFName.of('XObject'), PDFDict);
        if (!xObjects) return [];
        return xObjects.entries()
            .map(([, ref]) => pdfDoc.context.lookup(ref))
            .filter((stream) => stream.dict.get(PDFName.of('Subtype')) === PDFName.of('Image'))
            .map((stream) => ({
                width: stream.dict.get(PDFName.of('Width')).asNumber(),
                height: stream.dict.get(PDFName.of('Height')).asNumber(),
            }));
    });
}

/**
 * The text drawn in `pdfBytes`. Content streams are Flate-compressed and a
 * standard font's glyphs are hex `Tj` operands, so they are read back here.
 */
function drawnText(pdfBytes) {
    const latin = Buffer.from(pdfBytes).toString('latin1');
    let body = '';
    let cursor = 0;
    for (;;) {
        const start = latin.indexOf('stream', cursor);
        if (start < 0) break;
        let from = start + 'stream'.length;
        if (latin[from] === '\r') from += 1;
        if (latin[from] === '\n') from += 1;
        const end = latin.indexOf('endstream', from);
        if (end < 0) break;
        const chunk = Buffer.from(latin.slice(from, end), 'latin1');
        try {
            body += zlib.inflateSync(chunk).toString('latin1');
        } catch {
            body += chunk.toString('latin1');
        }
        cursor = end + 'endstream'.length;
    }
    return Array.from(body.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g))
        .map((match) => Buffer.from(match[1], 'hex').toString('latin1'))
        .join(' ')
        .replace(/\s+/g, ' ');
}

/**
 * A Storage bucket in memory: `files` maps a path to its bytes, `calls` records
 * what was read, written and deleted, and `failures` makes a path's download
 * throw. A download hands back a fresh small Buffer, as the SDK does.
 */
function createStorageFake() {
    const files = new Map();
    const failures = new Map();
    const calls = { downloads: [], uploads: [], saves: [], deletes: [], signed: [] };
    const missing = (path) => Object.assign(new Error(`No such object: ${path}`), { code: 404 });

    const file = (path) => ({
        name: path,
        exists: async () => [files.has(path)],
        download: async (options = {}) => {
            calls.downloads.push(path);
            if (failures.has(path)) throw failures.get(path);
            if (!files.has(path)) throw missing(path);
            const bytes = Buffer.from(files.get(path));
            if (options.destination) {
                fs.writeFileSync(options.destination, bytes);
                return [];
            }
            return [bytes];
        },
        save: async (buffer) => {
            calls.saves.push(path);
            files.set(path, Buffer.from(buffer));
        },
        delete: async () => {
            calls.deletes.push(path);
            if (!files.delete(path)) throw missing(path);
        },
        getSignedUrl: async ({ action, expires }) => {
            calls.signed.push({ path, action, expires });
            return [`https://storage.example.test/${path}?expires=${expires}`];
        },
    });

    const bucket = {
        name: 'test-bucket',
        file,
        upload: async (localPath, { destination }) => {
            calls.uploads.push(destination);
            files.set(destination, fs.readFileSync(localPath));
        },
    };

    const reset = () => {
        files.clear();
        failures.clear();
        Object.values(calls).forEach((list) => { list.length = 0; });
    };

    return { files, failures, calls, reset, storage: { bucket: () => bucket } };
}

module.exports = { TINY_JPEG, createStorageFake, drawnText, imagesOnPages, onePagePdf, tinyPng };
