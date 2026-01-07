import React, { useState, useEffect } from 'react';
import { X, ChevronRight, Check, Info } from 'lucide-react';

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
    target: 'stat-card-find_driver',
    title: "SafeHaul Leads",
    content: "Access our exclusive pool of high-intent drivers. These leads are time-sensitive!",
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

  return (
    <div className="fixed inset-0 z-[100] pointer-events-none">
      {isCenter && <div className="absolute inset-0 bg-black/40 backdrop-blur-sm pointer-events-auto transition-opacity duration-500" />}

      <div 
        className={`absolute pointer-events-auto bg-white rounded-xl shadow-2xl border border-blue-100 p-6 w-80 transition-all duration-500 ease-in-out ${isCenter ? 'top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2' : ''}`}
        style={!isCenter ? { top: coords.top, left: coords.left } : {}}
      >
        {!isCenter && stepData.position === 'bottom' && (
          <div className="absolute -top-2 left-1/2 -translate-x-1/2 w-4 h-4 bg-white border-t border-l border-blue-100 transform rotate-45"></div>
        )}
        {!isCenter && stepData.position === 'left' && (
          <div className="absolute top-6 -right-2 w-4 h-4 bg-white border-t border-r border-blue-100 transform rotate-45"></div>
        )}

        <div className="flex justify-between items-start mb-3 relative z-10">
          <div className="bg-yellow-100 p-2 rounded-lg text-yellow-700">
            <Info size={20} fill="currentColor" className="text-yellow-500/20" />
          </div>
          <button onClick={onComplete} className="text-gray-400 hover:text-gray-600 transition-colors">
            <X size={18} />
          </button>
        </div>

        <h3 className="text-lg font-bold text-gray-900 mb-2">{stepData.title}</h3>
        <p className="text-sm text-gray-600 mb-6 leading-relaxed">
          {stepData.content}
        </p>

        <div className="flex justify-between items-center relative z-10">
          <div className="flex gap-1">
            {TOUR_STEPS.map((_, idx) => (
              <div 
                key={idx} 
                className={`w-2 h-2 rounded-full transition-colors ${idx === currentStep ? 'bg-blue-600' : 'bg-gray-200'}`}
              />
            ))}
          </div>
          
          <button 
            onClick={handleNext}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-bold rounded-lg hover:bg-blue-700 transition-all shadow-md hover:shadow-lg hover:-translate-y-0.5"
          >
            {currentStep === TOUR_STEPS.length - 1 ? 'Finish' : 'Next'}
            {currentStep === TOUR_STEPS.length - 1 ? <Check size={16} /> : <ChevronRight size={16} />}
          </button>
        </div>
      </div>
    </div>
  );
}
