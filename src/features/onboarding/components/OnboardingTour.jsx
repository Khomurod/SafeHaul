import React, { useState, useEffect } from 'react';
import { X, ChevronRight, Check, Info } from 'lucide-react';
import { Button, IconButton } from '@/design-system/components';

const TOUR_STEPS = [
  {
    target: null,
    title: "Welcome to SafeHaul",
    content: "Let's take a quick tour of your new recruiting dashboard to get you started.",
    position: 'center'
  },
  {
    target: 'stat-card-applications',
    title: "Direct Applications",
    content: "View full applications submitted directly to your company here.",
    position: 'bottom'
  },

  {
    target: 'stat-card-company_leads',
    title: "Imported Leads",
    content: "Manage leads you've imported via Excel or Google Sheets.",
    position: 'bottom'
  },
  {
    target: 'user-menu-btn',
    title: "Settings & Profile",
    content: "Update your company profile, manage your team, and configure email settings here.",
    position: 'left'
  }
];

export function OnboardingTour({ onComplete }) {
  const [currentStep, setCurrentStep] = useState(0);
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const [isVisible, setIsVisible] = useState(false);
  const stepData = TOUR_STEPS[currentStep];

  const updatePosition = () => {
    if (stepData.position === 'center') {
      setIsVisible(true);
      return;
    }

    const element = document.getElementById(stepData.target);
    if (element) {
      const rect = element.getBoundingClientRect();
      const scrollY = window.scrollY;
      const scrollX = window.scrollX;

      let top = 0;
      let left = 0;

      if (stepData.position === 'bottom') {
        top = rect.bottom + scrollY + 15;
        left = rect.left + scrollX + (rect.width / 2) - 160;
      } else if (stepData.position === 'left') {
        top = rect.top + scrollY;
        left = rect.left + scrollX - 340;
      }

      if (left < 10) left = 10;

      setCoords({ top, left });
      setIsVisible(true);

      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else {
      console.warn(`Target ${stepData.target} not found, skipping.`);
      handleNext();
    }
  };

  useEffect(() => {
    const timer = setTimeout(updatePosition, 500);
    window.addEventListener('resize', updatePosition);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', updatePosition);
    };
  }, [currentStep]);

  const handleNext = () => {
    if (currentStep < TOUR_STEPS.length - 1) {
      setIsVisible(false);
      setCurrentStep(prev => prev + 1);
    } else {
      onComplete();
    }
  };

  if (!isVisible && stepData.position !== 'center') return null;

  const isCenter = stepData.position === 'center';

  const isLastStep = currentStep === TOUR_STEPS.length - 1;

  return (
    /*
     * `fixed inset-0` here is a *positioning canvas*, not a dialog backdrop:
     * it is `pointer-events-none` and exists so a coach mark can be placed
     * against a page element's coordinates. It is recorded as an exception to
     * the hand-built-overlay rule for that reason — `Modal` centres and traps
     * focus, which is the opposite of what a coach mark attached to a toolbar
     * button needs. See the roadmap for the open item on this component's
     * dialog semantics.
     */
    <div className="pointer-events-none fixed inset-0 z-[100]">
      {isCenter && <div className="pointer-events-auto absolute inset-0 bg-ds-overlay backdrop-blur-sm transition-opacity duration-500" />}

      <div
        className={`pointer-events-auto absolute w-80 rounded-ds-xl border border-ds-border-subtle bg-ds-surface p-ds-6 shadow-ds-lg transition-all duration-500 ease-in-out ${isCenter ? 'top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2' : ''}`}
        style={!isCenter ? { top: coords.top, left: coords.left } : {}}
      >
        {!isCenter && stepData.position === 'bottom' && (
          <div aria-hidden="true" className="absolute -top-2 left-1/2 h-4 w-4 -translate-x-1/2 rotate-45 transform border-t border-l border-ds-border-subtle bg-ds-surface"></div>
        )}
        {!isCenter && stepData.position === 'left' && (
          <div aria-hidden="true" className="absolute top-6 -right-2 h-4 w-4 rotate-45 transform border-t border-r border-ds-border-subtle bg-ds-surface"></div>
        )}

        <div className="relative z-10 mb-ds-3 flex items-start justify-between">
          <span aria-hidden="true" className="rounded-ds-lg bg-ds-status-warning-bg p-ds-2 text-ds-status-warning-fg">
            <Info size={20} />
          </span>
          {/* This was a bare `<button>` wrapping an X glyph, with no accessible
              name at all — the one control that ends the tour announced as
              "button". */}
          <IconButton label="Close tour" variant="ghost" size="sm" onClick={onComplete}>
            <X aria-hidden="true" />
          </IconButton>
        </div>

        <h3 className="mb-ds-2 text-ds-heading-md font-bold text-ds-content">{stepData.title}</h3>
        <p className="mb-ds-6 text-ds-body leading-relaxed text-ds-content-secondary">
          {stepData.content}
        </p>

        <div className="relative z-10 flex items-center justify-between">
          {/* The dots were colour-alone: the current step was a blue dot among
              grey ones and nothing said so in text. */}
          <span className="flex items-center gap-ds-1">
            <span aria-hidden="true" className="flex gap-ds-1">
              {TOUR_STEPS.map((_, idx) => (
                <span
                  key={idx}
                  className={`h-2 w-2 rounded-ds-full transition-colors ${idx === currentStep ? 'bg-ds-action-primary' : 'bg-ds-border'}`}
                />
              ))}
            </span>
            <span className="ds-visually-hidden">
              {`Step ${currentStep + 1} of ${TOUR_STEPS.length}`}
            </span>
          </span>

          <Button variant="primary" size="sm" onClick={handleNext}>
            {isLastStep ? 'Finish' : 'Next'}
            {isLastStep ? <Check aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
          </Button>
        </div>
      </div>
    </div>
  );
}
