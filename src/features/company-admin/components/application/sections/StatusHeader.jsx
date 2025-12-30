import React from 'react';
import { Phone, Mail } from 'lucide-react';
import { formatPhoneNumber, normalizePhone } from '@shared/utils/helpers';

// Telegram SVG Icon
function TelegramLogo({ className }) {
  return (
    <svg 
      xmlns="http://www.w3.org/2000/svg" 
      viewBox="0 0 24 24" 
      fill="none" 
      stroke="currentColor" 
      strokeWidth="2" 
      strokeLinecap="round" 
      strokeLinejoin="round" 
      className={className}
    >
      <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
      <path d="M15 10l-4 4l6 6l4 -16l-18 7l4 2l2 6l3 -4" />
    </svg>
  );
}

export function StatusHeader({ 
  appData, 
  currentStatus, 
  handleStatusUpdate, 
  canEdit, 
  isEditing,
  onPhoneClick 
}) {

  // Helper for Telegram Link
  const getTelegramLink = (phone) => {
      if (!phone) return '#';
      let cleaned = normalizePhone(phone);
      if (cleaned.length === 10) cleaned = '1' + cleaned;
      return `https://t.me/+${cleaned}`;
  };

  // Handle Telegram Click: Open Link AND Open Modal
  const handleTelegramClick = (e) => {
      if (e) e.stopPropagation();
      // 1. Open Telegram
      const link = getTelegramLink(appData.phone);
      if (link && link !== '#') {
          window.open(link, '_blank');
      }
      // 2. Open Log Modal
      if (onPhoneClick) onPhoneClick(e, appData);
  };

  return (
    <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200 flex flex-col sm:flex-row justify-between items-center gap-4">

      {/* Left Side: Status & Contact Actions */}
      <div className="flex flex-col sm:flex-row items-center gap-6 w-full sm:w-auto">
          <div>
             <span className="text-gray-500 text-sm font-semibold uppercase">Current Status</span>
             <div className="flex items-center gap-2 mt-1">
                <div className={`w-3 h-3 rounded-full ${currentStatus === 'Approved' ? 'bg-green-500' : 'bg-blue-500'}`}></div>
               <span className="text-xl font-bold text-gray-800">{currentStatus}</span>
             </div>
          </div>

          {/* QUICK ACTIONS (Phone / Telegram / Email) */}
          <div className="flex items-center gap-3 pl-0 sm:pl-6 sm:border-l sm:border-gray-200">
              {appData.phone && (
                  <>
                      {/* PHONE BUTTON (Opens Modal + Dials) */}
                      <button 
                        onClick={(e) => {
                              window.location.href = `tel:${appData.phone}`;
                              // Log
                              if (onPhoneClick) onPhoneClick(e, appData);
                          }}
                          className="w-10 h-10 flex items-center justify-center rounded-full bg-green-100 text-green-600 hover:bg-green-200 transition-colors shadow-sm"
                          title={`Call ${formatPhoneNumber(appData.phone)}`}
                      >
                          <Phone size={20} />
                      </button>

                      {/* TELEGRAM BUTTON (Opens Telegram + Modal) */}
                      <button 
                          onClick={handleTelegramClick}
                          className="w-10 h-10 flex items-center justify-center rounded-full bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors shadow-sm border border-blue-100"
                          title="Open Telegram Chat"
                      >
                          <TelegramLogo className="w-5 h-5" />
                      </button>
                  </>
              )}

              {appData.email && (
                  <a 
                      href={`mailto:${appData.email}`}
                      className="w-10 h-10 flex items-center justify-center rounded-full bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors shadow-sm"
                      title={`Email ${appData.email}`}
                  >
                      <Mail size={20} />
                  </a>
              )}
          </div>
      </div>

      {/* Right Side: Dropdown (If editable) */}
      {canEdit && !isEditing && (
         <div className="flex flex-col sm:flex-row gap-3 items-end sm:items-center w-full sm:w-auto">
            <select 
              className="w-full sm:w-auto p-2 border border-gray-300 rounded-lg bg-gray-50 text-sm font-medium focus:ring-2 focus:ring-blue-500 outline-none cursor-pointer"
             value={currentStatus}
             onChange={(e) => handleStatusUpdate(e.target.value)}
           >
              <option value="New Application">New Application</option>
              <option value="New Lead">New Lead</option>
              <option value="Contacted">Contacted</option>
              <option value="Attempted">Attempted</option>
              <option value="In Review">In Review</option>
              <option value="Background Check">Background Check</option>
              <option value="Awaiting Documents">Awaiting Documents</option>
              <option value="Approved">Approved</option>
              <option value="Rejected">Rejected</option>
              <option value="Disqualified">Disqualified</option>
           </select>
         </div>
      )}
    </div>
  );
}