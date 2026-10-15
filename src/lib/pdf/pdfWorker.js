/**
 * pdf.js worker wiring, imported by every module that renders or reads a PDF.
 *
 * It lives here, not in `main.jsx`, so it travels with the PDF features (signing
 * room, envelope creator, application prep), which are lazy chunks. Wired in the
 * entry, `react-pdf` and the `pdfjs` chunk would load on EVERY route, including
 * the public application a driver opens on a phone, where no PDF is ever rendered.
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
