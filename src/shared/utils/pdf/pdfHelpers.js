// src/shared/utils/pdf/pdfHelpers.js
import { PDF_CONFIG, TABLE_SECOND_COL_WIDTH } from './pdfConfig';
import { getFieldValue } from '@shared/utils/helpers';

// Helper to check if we need a new page based on content height
export function checkPageBreak(doc, y, requiredHeight = 0) {
    if (y + requiredHeight > PDF_CONFIG.PAGE_HEIGHT - PDF_CONFIG.MARGIN) {
        doc.addPage();
        return PDF_CONFIG.MARGIN; // Reset y to top margin
    }
    return y;
}

// Helper to draw a section header row
export function addTableHeader(doc, y, title) {
    y = checkPageBreak(doc, y, PDF_CONFIG.LINE_HEIGHT * 1.5);

    doc.setFont(PDF_CONFIG.FONT.BOLD, "bold");
    doc.setFontSize(11);
    doc.setTextColor(0, 0, 0);
    doc.setFillColor(PDF_CONFIG.TABLE_HEADER_FILL_COLOR);
    doc.setDrawColor(PDF_CONFIG.TABLE_LINE_COLOR);

    // Draw filled rectangle for header
    doc.rect(PDF_CONFIG.MARGIN, y, PDF_CONFIG.TABLE_FIRST_COL_WIDTH + TABLE_SECOND_COL_WIDTH, PDF_CONFIG.LINE_HEIGHT * 1.5, 'FD');

    // Text vertically centered
    doc.text(title, PDF_CONFIG.MARGIN + PDF_CONFIG.CELL_PADDING, y + (PDF_CONFIG.LINE_HEIGHT * 1.5) / 2 + 1.5);

    return y + PDF_CONFIG.LINE_HEIGHT * 1.5;
}

// Helper to draw a data row (Label | Value)
export function addTableRow(doc, y, key, value) {
    const displayValue = getFieldValue(value);
    doc.setFont(PDF_CONFIG.FONT.NORMAL, "normal");
    doc.setFontSize(10);

    // Calculate wrapped text height
    const keyLines = doc.splitTextToSize(key, PDF_CONFIG.TABLE_FIRST_COL_WIDTH - (PDF_CONFIG.CELL_PADDING * 2));
    const valueLines = doc.splitTextToSize(displayValue, TABLE_SECOND_COL_WIDTH - (PDF_CONFIG.CELL_PADDING * 2));

    const lineCount = Math.max(keyLines.length, valueLines.length);
    const rowHeight = lineCount * (PDF_CONFIG.LINE_HEIGHT * 0.9) + (PDF_CONFIG.CELL_PADDING * 2);

    y = checkPageBreak(doc, y, rowHeight);

    doc.setDrawColor(PDF_CONFIG.TABLE_LINE_COLOR);

    // Draw borders
    doc.rect(PDF_CONFIG.MARGIN, y, PDF_CONFIG.TABLE_FIRST_COL_WIDTH, rowHeight);
    doc.rect(PDF_CONFIG.MARGIN + PDF_CONFIG.TABLE_FIRST_COL_WIDTH, y, TABLE_SECOND_COL_WIDTH, rowHeight);

    // Calculate vertical center for text
    const textY = y + rowHeight / 2 - (lineCount * (PDF_CONFIG.LINE_HEIGHT * 0.9)) / 2 + (PDF_CONFIG.LINE_HEIGHT * 0.9) - (PDF_CONFIG.CELL_PADDING / 2);

    doc.setTextColor(0, 0, 0);
    doc.text(keyLines, PDF_CONFIG.MARGIN + PDF_CONFIG.CELL_PADDING, textY);
    doc.text(valueLines, PDF_CONFIG.MARGIN + PDF_CONFIG.TABLE_FIRST_COL_WIDTH + PDF_CONFIG.CELL_PADDING, textY);

    return y + rowHeight;
}

// Helper to draw full-width text blocks (for Agreements)
export function addFullWidthText(doc, y, text) {
    y = checkPageBreak(doc, y, 10); 
    const textWidth = PDF_CONFIG.PAGE_WIDTH - PDF_CONFIG.MARGIN * 2;
    doc.setFont(PDF_CONFIG.FONT.NORMAL, "normal");
    doc.setFontSize(10);
    doc.setTextColor(0, 0, 0);

    const paragraphs = text.split('\n'); 

    for (const paragraph of paragraphs) {
        const trimmedParagraph = paragraph.trim();
        if (trimmedParagraph.length === 0) {
            y += (PDF_CONFIG.LINE_HEIGHT * 0.5); 
            continue;
        }

        const splitText = doc.splitTextToSize(trimmedParagraph, textWidth);
        const requiredHeight = (Array.isArray(splitText) ? splitText.length : 1) * (PDF_CONFIG.LINE_HEIGHT * 0.8) + (PDF_CONFIG.LINE_HEIGHT * 0.5);

        y = checkPageBreak(doc, y, requiredHeight); 

        doc.text(splitText, PDF_CONFIG.MARGIN, y);
        const numLines = Array.isArray(splitText) ? splitText.length : 1;
        y += (numLines * (PDF_CONFIG.LINE_HEIGHT * 0.8)) + (PDF_CONFIG.LINE_HEIGHT * 0.5);
    }
    return y;
}