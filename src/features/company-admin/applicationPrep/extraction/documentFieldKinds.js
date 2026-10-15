/**
 * The application's upload fields, mapped to what the reader calls each
 * document. Its own module so the screens that only list the attached documents
 * do not load the reader itself (pdf.js, the page rasterizer, OCR).
 */
export const DOCUMENT_FIELD_KINDS = Object.freeze({
    'cdl-front': 'cdl',
    'cdl-back': 'cdl',
    'medical-card-upload': 'medical',
    'psp-report-upload': 'psp',
    'mvr-upload': 'mvr',
});
