// src/shared/utils/pdf/pdfConfig.js

export const PDF_CONFIG = {
  MARGIN: 15,
  PAGE_WIDTH: 210, // A4 width in mm
  PAGE_HEIGHT: 297, // A4 height in mm
  LINE_HEIGHT: 6,
  SECTION_GAP: 8,
  TABLE_FIRST_COL_WIDTH: 70,
  TABLE_LINE_COLOR: 220,
  TABLE_HEADER_FILL_COLOR: 240,
  CELL_PADDING: 2,
  FONT: {
      BOLD: "helvetica",
      NORMAL: "helvetica"
  }
};

// Calculated values
export const TABLE_SECOND_COL_WIDTH = PDF_CONFIG.PAGE_WIDTH - (PDF_CONFIG.MARGIN * 2) - PDF_CONFIG.TABLE_FIRST_COL_WIDTH;