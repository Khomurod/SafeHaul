/**
 * Contract freeze for the dossier Documents tab: the eight standard document
 * keys and their labels in order, the URL resolution precedence, the
 * only-render-when-a-url-exists rule, the date fallback, the empty state, and
 * the preview/download behaviour.
 */
import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { formatDate } from '@shared/utils/helpers';
import { DocumentsTab } from './DocumentsTab';

afterEach(cleanup);

const DOC_CONTRACT = [
  ['cdl-front', 'CDL Front'],
  ['cdl-back', 'CDL Back'],
  ['medical-card-upload', 'Medical Card'],
  ['ssc-upload', 'SSN Card'],
  ['twic-card-upload', 'TWIC Card'],
  ['mvr-upload', 'MVR Report'],
  ['mvr-consent-upload', 'MVR Consent'],
  ['drug-test-consent-upload', 'Drug Test Consent'],
];

describe('DocumentsTab document set', () => {
  it('lists all eight standard documents in their frozen order with frozen labels', () => {
    const fileUrls = Object.fromEntries(DOC_CONTRACT.map(([key]) => [key, `https://x/${key}.pdf`]));
    render(<DocumentsTab fileUrls={fileUrls} appData={{ updatedAt: '2026-01-15' }} />);

    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(8);
    const labels = DOC_CONTRACT.map(([, label]) => label);
    labels.forEach((label, i) => {
      expect(items[i]).toHaveTextContent(label);
    });
  });

  it('omits any document that has no resolvable url', () => {
    render(<DocumentsTab fileUrls={{ 'cdl-front': 'https://x/f.pdf' }} appData={{}} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getByText('CDL Front')).toBeInTheDocument();
    expect(screen.queryByText('CDL Back')).toBeNull();
  });
});

describe('DocumentsTab url resolution precedence', () => {
  it('prefers the resolved fileUrls entry above everything else', () => {
    render(
      <DocumentsTab
        fileUrls={{ 'cdl-front': 'https://resolved/a.pdf' }}
        appData={{
          'cdl-front': { url: 'https://direct/b.pdf' },
          uploadedDocuments: { 'cdl-front': 'https://uploaded/c.pdf' },
        }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /CDL Front/ }));
    // Scoped to the dialog: the card also carries a `title` tooltip for its
    // truncated label, so an unscoped getByTitle would match both.
    expect(within(screen.getByRole('dialog')).getByTitle('CDL Front')).toHaveAttribute('src', 'https://resolved/a.pdf');
  });

  it('falls back to the appData field url', () => {
    render(
      <DocumentsTab
        fileUrls={{}}
        appData={{
          'cdl-front': { url: 'https://direct/b.pdf' },
          uploadedDocuments: { 'cdl-front': 'https://uploaded/c.pdf' },
        }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /CDL Front/ }));
    // Scoped to the dialog: the card also carries a `title` tooltip for its
    // truncated label, so an unscoped getByTitle would match both.
    expect(within(screen.getByRole('dialog')).getByTitle('CDL Front')).toHaveAttribute('src', 'https://direct/b.pdf');
  });

  it('falls back last to uploadedDocuments', () => {
    render(
      <DocumentsTab fileUrls={{}} appData={{ uploadedDocuments: { 'cdl-front': 'https://uploaded/c.pdf' } }} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /CDL Front/ }));
    // Scoped to the dialog: the card also carries a `title` tooltip for its
    // truncated label, so an unscoped getByTitle would match both.
    expect(within(screen.getByRole('dialog')).getByTitle('CDL Front')).toHaveAttribute('src', 'https://uploaded/c.pdf');
  });
});

describe('DocumentsTab empty state', () => {
  it('keeps the frozen empty copy when nothing is uploaded', () => {
    render(<DocumentsTab fileUrls={{}} appData={{}} />);
    expect(screen.getByText('No documents found for this applicant.')).toBeInTheDocument();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('treats missing props as empty rather than crashing', () => {
    render(<DocumentsTab />);
    expect(screen.getByText('No documents found for this applicant.')).toBeInTheDocument();
  });
});

describe('DocumentsTab dates', () => {
  it('shows the application updatedAt as the document date', () => {
    render(<DocumentsTab fileUrls={{ 'cdl-front': 'u' }} appData={{ updatedAt: '2026-01-15' }} />);
    // Asserted through the shared helper rather than a hardcoded format, so this
    // freezes "the date comes from appData.updatedAt via formatDate" without
    // also freezing the helper's own locale output.
    expect(screen.getByRole('listitem')).toHaveTextContent(formatDate('2026-01-15'));
  });

  it('falls back to the frozen unknown-date label', () => {
    render(<DocumentsTab fileUrls={{ 'cdl-front': 'u' }} appData={{}} />);
    expect(screen.getByRole('listitem')).toHaveTextContent('Unknown Date');
  });
});

describe('DocumentsTab preview', () => {
  it('opens a named preview dialog with the document in an iframe', () => {
    render(<DocumentsTab fileUrls={{ 'mvr-upload': 'https://x/mvr.pdf' }} appData={{}} />);
    fireEvent.click(screen.getByRole('button', { name: /MVR Report/ }));

    const dialog = screen.getByRole('dialog', { name: 'MVR Report' });
    expect(within(dialog).getByTitle('MVR Report')).toHaveAttribute('src', 'https://x/mvr.pdf');
  });

  it('offers a download that keeps the download attribute and safe rel', () => {
    render(<DocumentsTab fileUrls={{ 'mvr-upload': 'https://x/mvr.pdf' }} appData={{}} />);
    fireEvent.click(screen.getByRole('button', { name: /MVR Report/ }));

    const link = screen.getByRole('link', { name: /download/i });
    expect(link).toHaveAttribute('href', 'https://x/mvr.pdf');
    expect(link).toHaveAttribute('download');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noreferrer'));
  });

  it('closes the preview and returns to the list', () => {
    render(<DocumentsTab fileUrls={{ 'mvr-upload': 'https://x/mvr.pdf' }} appData={{}} />);
    fireEvent.click(screen.getByRole('button', { name: /MVR Report/ }));
    fireEvent.click(screen.getByRole('button', { name: /close preview/i }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes the preview on Escape', () => {
    render(<DocumentsTab fileUrls={{ 'mvr-upload': 'https://x/mvr.pdf' }} appData={{}} />);
    fireEvent.click(screen.getByRole('button', { name: /MVR Report/ }));
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'MVR Report' }), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  // The preview is a dialog opened from inside another dialog. Its focus
  // handling is what stops a keyboard user from being stranded in the dossier
  // behind it, so it is frozen here rather than left to the shared Modal.
  it('opens the preview with focus inside it, on the close control', () => {
    render(<DocumentsTab fileUrls={{ 'mvr-upload': 'https://x/mvr.pdf' }} appData={{}} />);
    fireEvent.click(screen.getByRole('button', { name: /MVR Report/ }));

    expect(document.activeElement).toBe(screen.getByRole('button', { name: /close preview/i }));
  });

  it('returns focus to the document card the preview was opened from', () => {
    render(
      <DocumentsTab
        fileUrls={{ 'cdl-front': 'https://x/f.pdf', 'mvr-upload': 'https://x/mvr.pdf' }}
        appData={{}}
      />,
    );
    const card = screen.getByRole('button', { name: /MVR Report/ });
    card.focus();
    fireEvent.click(card);
    fireEvent.click(screen.getByRole('button', { name: /close preview/i }));

    expect(document.activeElement).toBe(card);
  });

  it('names the preview dialog after the document it is showing', () => {
    render(
      <DocumentsTab
        fileUrls={{ 'cdl-front': 'https://x/f.pdf', 'mvr-upload': 'https://x/mvr.pdf' }}
        appData={{}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /CDL Front/ }));
    expect(screen.getByRole('dialog', { name: 'CDL Front' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'MVR Report' })).toBeNull();
  });
});
