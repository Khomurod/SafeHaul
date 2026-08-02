/**
 * Public-application status screens: frozen strings, one `<main>` landmark and
 * exactly one `<h1>` per screen, live-region announcements, and the confirmation
 * / checklist gates.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  ApplyLoadingScreen,
  ApplyLinkErrorScreen,
  ParsingCdlScreen,
  SubmissionSuccessScreen,
  SubmissionQueuedScreen,
} from './PublicApplyScreens';
import { DOC_STATUS } from './postApplyDocsStorage';

const TEMPLATES = [
  { templateId: 'req-1', title: 'Post-Application Form', required: true, order: 0 },
];

const successProps = (overrides = {}) => ({
  postApplicationTemplates: [],
  submittedApplicationId: 'app-1',
  docStates: {},
  openingTemplateId: '',
  handleOpenPostApplicationTemplate: vi.fn(),
  onGoHome: vi.fn(),
  onStartNewApplication: vi.fn(),
  confirmationNumber: 'CONF-123',
  ...overrides,
});

const expectSingleH1 = (text) => {
  const headings = screen.getAllByRole('heading', { level: 1 });
  expect(headings).toHaveLength(1);
  expect(headings[0]).toHaveTextContent(text);
};

describe('ApplyLoadingScreen', () => {
  it('announces itself and keeps the frozen copy', () => {
    render(<ApplyLoadingScreen />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading Application...');
    expect(screen.getByRole('main')).toBeInTheDocument();
  });
});

describe('ApplyLinkErrorScreen', () => {
  it('is a labelled main landmark with one h1 and an alert body', () => {
    render(<ApplyLinkErrorScreen error="Company not found." />);
    expectSingleH1('Link Error');
    expect(screen.getByRole('alert')).toHaveTextContent('Company not found.');
    expect(screen.getByRole('main')).toHaveAttribute('aria-labelledby');
  });
});

describe('ParsingCdlScreen', () => {
  it('keeps the frozen heading and body and announces progress', () => {
    render(<ParsingCdlScreen autoFillStoragePath="guest_uploads/e2e/cdl.png" />);
    expectSingleH1('Reading your CDL...');
    expect(screen.getByText(/extracting your basic details/)).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText('guest_uploads/e2e/cdl.png')).toBeInTheDocument();
  });

  it('omits the storage path when there is none', () => {
    render(<ParsingCdlScreen autoFillStoragePath="" />);
    expect(screen.queryByText(/guest_uploads/)).toBeNull();
  });
});

describe('SubmissionSuccessScreen', () => {
  beforeEach(() => sessionStorage.clear());

  it('is a labelled main landmark with one h1 and takes focus', () => {
    render(<SubmissionSuccessScreen {...successProps()} />);
    expectSingleH1('Application Submitted!');
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1 }));
  });

  it('shows the confirmation number and its frozen caption', () => {
    render(<SubmissionSuccessScreen {...successProps()} />);
    expect(screen.getByText('Confirmation Number')).toBeInTheDocument();
    expect(screen.getByText('CONF-123')).toBeInTheDocument();
    expect(screen.getByText('Save this number for your records.')).toBeInTheDocument();
  });

  it('falls back to the session-stored confirmation number', () => {
    sessionStorage.setItem('lastConfirmationNumber', 'SESSION-9');
    render(<SubmissionSuccessScreen {...successProps({ confirmationNumber: '' })} />);
    expect(screen.getByText('SESSION-9')).toBeInTheDocument();
  });

  it('omits the confirmation block entirely when there is no number', () => {
    render(<SubmissionSuccessScreen {...successProps({ confirmationNumber: '' })} />);
    expect(screen.queryByText('Confirmation Number')).toBeNull();
  });

  it('uses the recruiter message when nothing is outstanding', () => {
    render(<SubmissionSuccessScreen {...successProps()} />);
    expect(screen.getByText(/a recruiter will contact you soon/)).toBeInTheDocument();
  });

  it('switches to the required-documents message while a required form is pending', () => {
    render(<SubmissionSuccessScreen {...successProps({ postApplicationTemplates: TEMPLATES })} />);
    expect(screen.getByText(/please complete the required documents below/i)).toBeInTheDocument();
    expect(screen.getByTestId('required-documents-section')).toBeInTheDocument();
  });

  it('returns to the recruiter message once every required form is complete', () => {
    render(
      <SubmissionSuccessScreen
        {...successProps({
          postApplicationTemplates: TEMPLATES,
          docStates: { 'req-1': { status: DOC_STATUS.COMPLETED } },
        })}
      />,
    );
    expect(screen.getByText(/a recruiter will contact you soon/)).toBeInTheDocument();
  });

  it('hides the checklist until an application id exists', () => {
    render(
      <SubmissionSuccessScreen
        {...successProps({ postApplicationTemplates: TEMPLATES, submittedApplicationId: '' })}
      />,
    );
    expect(screen.queryByTestId('required-documents-section')).toBeNull();
  });

  it('exposes both navigation actions as real buttons', () => {
    const props = successProps();
    render(<SubmissionSuccessScreen {...props} />);
    expect(screen.getByRole('button', { name: 'Go to home' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start a new application' })).toBeInTheDocument();
  });

  it('omits "Start a new application" when no handler is supplied', () => {
    render(<SubmissionSuccessScreen {...successProps({ onStartNewApplication: undefined })} />);
    expect(screen.queryByRole('button', { name: 'Start a new application' })).toBeNull();
  });
});

describe('SubmissionQueuedScreen', () => {
  it('keeps its frozen heading and offline copy and announces itself', () => {
    render(<SubmissionQueuedScreen onGoHome={vi.fn()} />);
    expectSingleH1('Application Saved');
    expect(screen.getByRole('status')).toHaveTextContent(
      /will be automatically submitted when your connection is restored/,
    );
    expect(screen.getByText('You can safely close this page. No data will be lost.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Go to home' })).toBeInTheDocument();
  });
});
