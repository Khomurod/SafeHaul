/**
 * pdf.js worker wiring, imported by every module that renders or reads a PDF.
 *
 * Until 2026-09-06 this lived in `main.jsx`, which made `react-pdf` — and with
 * it the 399 kB `pdfjs` chunk (117 kB over the wire) — part of the entry bundle
 * for EVERY route, including the public application a driver opens on a phone
 * at a truck stop, where no PDF is ever rendered. Measured against the
 * production build: the entry preloaded that chunk on `/apply` and `/login`
 * alike. Moving the wiring here lets it travel with the PDF features (signing
 * room, envelope creator, application prep), which are already lazy chunks.
 *
 * The worker file is served from `public/pdf.worker.min.mjs` on purpose — no
 * CDN, so a production outage of someone else's host cannot break signing.
 *
 * Every non-test module that imports `react-pdf` must import this module too;
 * `src/tests/pdfWorkerWiring.test.js` refuses the tree otherwise. Test mocks of
 * `react-pdf` may omit `pdfjs`, hence the guard.
 */
import { pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/TextLayer.css';
import 'react-pdf/dist/Page/AnnotationLayer.css';

export const PDF_WORKER_SRC = '/pdf.worker.min.mjs';

if (pdfjs?.GlobalWorkerOptions) {
    pdfjs.GlobalWorkerOptions.workerSrc = PDF_WORKER_SRC;
}
