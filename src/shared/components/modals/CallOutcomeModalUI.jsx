import React, { useState } from 'react';
import {
  Phone, X, Save, Loader2, MessageSquare, CheckCircle, XCircle,
  Clock, AlertCircle, Ban, ThumbsDown, Truck, ExternalLink, Briefcase,
  BellPlus, Send, Copy, Check, User
} from 'lucide-react';
import { normalizePhone, formatPhoneNumber } from '@shared/utils/helpers';
import { auth } from '@lib/firebase';
import { EXPERIENCE_OPTIONS } from '../../../config/form-options';

const OUTCOMES_CONFIG = [
  {
    id: 'interested',
    label: 'Connected / Interested',
    icon: <CheckCircle size={18} className="text-green-600" />,
    color: 'border-green-200 bg-green-50 text-green-800'
  },
  {
    id: 'callback',
    label: 'Connected / Scheduled Callback',
    icon: <Clock size={18} className="text-blue-600" />,
    color: 'border-blue-200 bg-blue-50 text-blue-800'
  },
  {
    id: 'not_qualified',
    label: 'Connected / Not Qualified',
    icon: <Ban size={18} className="text-orange-600" />,
    color: 'border-orange-200 bg-orange-50 text-orange-800'
  },
  {
    id: 'not_interested',
    label: 'Connected / Not Interested',
    icon: <ThumbsDown size={18} className="text-gray-600" />,
    color: 'border-gray-200 bg-gray-50 text-gray-800'
  },
  {
    id: 'hired_elsewhere',
    label: 'Connected / Hired Elsewhere',
    icon: <Briefcase size={18} className="text-purple-600" />,
    color: 'border-purple-200 bg-purple-50 text-purple-800'
  },
  {
    id: 'voicemail',
    label: 'Left Voicemail',
    icon: <MessageSquare size={18} className="text-yellow-600" />,
    color: 'border-yellow-200 bg-yellow-50 text-yellow-800'
  },
  {
    id: 'no_answer',
    label: 'No Answer',
    icon: <XCircle size={18} className="text-red-600" />,
    color: 'border-red-200 bg-red-50 text-red-800'
  },
  {
    id: 'wrong_number',
    label: 'Wrong Number',
    icon: <AlertCircle size={18} className="text-red-400" />,
    color: 'border-red-200 bg-red-50 text-red-800'
  }
];

const DRIVER_TYPES = [
  'Dry Van', 'Reefer', 'Flatbed', 'Tanker', 'Box Truck', 'Car Hauler',
  'Step Deck', 'Lowboy', 'Conestoga', 'Intermodal', 'Power Only', 'Hotshot'
];

const POSITIONS = [
  'Company Driver (Solo)', 'Company Driver (Team)',
  'Lease Operator (Solo)', 'Lease Operator (Team)',
  'Owner Operator (Solo)', 'Owner Operator (Team)',
  'Lease to Purchase (Solo)', 'Lease to Purchase (Team)'
];



const getTelegramLink = (rawPhone) => {
  if (!rawPhone) return '';
  let cleaned = normalizePhone(rawPhone);
  if (cleaned.length === 10) cleaned = '1' + cleaned;
  return `https://t.me/+${cleaned}`;
};

export function CallOutcomeModalUI({
  lead,
  onClose,
  outcome,
  setOutcome,
  notes,
  setNotes,

  driverType, setDriverType,
  experienceLevel, setExperienceLevel,
  position, setPosition,

  callbackDate, setCallbackDate,
  callbackTime, setCallbackTime,
  saving,
  handleSave,

  showDetailInputs,
  showCallbackSelect,
  onQuickReminder,
  companySlug
}) {

  const [copied, setCopied] = useState(false);

  const handleQuickReminder = () => {
    const now = new Date();
    now.setHours(now.getHours() + 1);
    const dateStr = now.toISOString().split('T')[0];
    const timeStr = now.toTimeString().split(' ')[0].substring(0, 5);

    setCallbackDate(dateStr);
    setCallbackTime(timeStr);
    setOutcome('callback');
    setNotes('Quick reminder set: No Answer (1 hr follow-up)');
  };

  const driverAppBase = import.meta.env.VITE_DRIVER_APP_URL || window.location.origin;
  const currentRecruiterId = auth.currentUser?.uid;
  const safeSlug = companySlug || 'general';

  const recruiterLink = `${driverAppBase.replace(/\/$/, '')}/interest/${safeSlug}?r=${currentRecruiterId}&l=${lead.id}`;

  const copyLink = () => {
    navigator.clipboard.writeText(recruiterLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-[70] backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-md border border-gray-200 overflow-hidden max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bg-blue-600 p-4 text-white flex justify-between items-center shrink-0">
          <h3 className="font-bold flex items-center gap-2">
            <Phone size={20} /> Log Call Result
          </h3>
          <button
            onClick={onClose}
            className="p-1 hover:bg-white/20 rounded-full"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between shrink-0">
          <div className="text-sm">
            <span className="text-gray-500">Driver: </span>
            <span className="font-bold text-gray-900">{lead.firstName} {lead.lastName}</span>
          </div>

          {lead.phone && (
            <a
              href={`tel:${lead.phone}`}
              className="text-xs bg-green-100 text-green-700 px-3 py-1.5 rounded-full font-bold flex items-center gap-1 hover:bg-green-200 transition-colors"
              title="Call now"
            >
              <Phone size={12} fill="currentColor" /> {formatPhoneNumber(lead.phone)}
            </a>
          )}
        </div>

        <form onSubmit={handleSave} className="p-5 space-y-5 overflow-y-auto">

          <div className="grid grid-cols-2 gap-3">
            {OUTCOMES_CONFIG.map((opt) => {
              if (opt.id === 'hired_elsewhere' && !lead.isPlatformLead) return null;

              const isSelected = outcome === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setOutcome(opt.id)}
                  className={`p-3 rounded-lg border text-xs font-bold flex flex-col items-center gap-2 transition-all text-center ${isSelected
                      ? `${opt.color} ring-2 ring-offset-1 ring-blue-500`
                      : 'border-gray-200 hover:bg-gray-50 text-gray-600'
                    }`}
                >
                  {opt.icon}
                  {opt.label}
                </button>
              );
            })}
          </div>

          {outcome === 'interested' && (
            <div className="bg-blue-50 border border-blue-200 p-4 rounded-xl animate-in fade-in slide-in-from-top-2">
              <div className="flex gap-3 items-start">
                <div className="bg-blue-100 p-2 rounded-lg text-blue-600 shrink-0">
                  <Send size={20} />
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="text-sm font-bold text-blue-900">Next Step: Send Invite</h4>
                  <p className="text-xs text-blue-700 mt-1 mb-3 break-words">
                    Send this specific link. It asks "Are you interested?" and assigns them to <strong>YOU</strong> upon confirmation.
                  </p>
                  <div className="flex items-center gap-2 bg-white p-2 rounded border border-blue-100 w-full">
                    <code className="flex-1 text-xs font-mono text-gray-500 truncate block">{recruiterLink}</code>
                    <button type="button" onClick={copyLink} className="text-blue-600 hover:text-blue-800 shrink-0">
                      {copied ? <Check size={14} /> : <Copy size={14} />}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {outcome === 'no_answer' && (
            <div className="flex justify-center animate-in fade-in">
              <button
                type="button"
                onClick={handleQuickReminder}
                className="flex items-center gap-2 px-4 py-2 bg-orange-100 text-orange-700 text-xs font-bold rounded-full hover:bg-orange-200 transition-colors"
              >
                <BellPlus size={14} /> Remind me in 1 Hour
              </button>
            </div>
          )}

          {showCallbackSelect && (
            <div className="animate-in fade-in slide-in-from-top-2 bg-blue-50 p-3 rounded-lg border border-blue-100">
              <label className="block text-xs font-bold text-blue-800 uppercase mb-2 flex items-center gap-1">
                <Clock size={12} /> Schedule Callback
              </label>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] text-gray-500 mb-1">Date</label>
                  <input
                    type="date"
                    className="w-full p-2 border border-blue-200 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                    value={callbackDate}
                    onChange={(e) => setCallbackDate(e.target.value)}
                    min={new Date().toISOString().split('T')[0]}
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-gray-500 mb-1">Time</label>
                  <input
                    type="time"
                    className="w-full p-2 border border-blue-200 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                    value={callbackTime}
                    onChange={(e) => setCallbackTime(e.target.value)}
                  />
                </div>
              </div>
            </div>
          )}

          {showDetailInputs && (
            <div className="space-y-3 pt-2 border-t border-gray-100 animate-in fade-in slide-in-from-top-2">
              <h4 className="text-xs font-bold text-gray-500 uppercase">Verify Driver Details</h4>

              <div>
                <label className="block text-[10px] text-gray-400 mb-1">Position</label>
                <select
                  className="w-full p-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none"
                  value={position}
                  onChange={(e) => setPosition(e.target.value)}
                >
                  <option value="">-- Select Position --</option>
                  {POSITIONS.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-[10px] text-gray-400 mb-1">Experience</label>
                <select
                  className="w-full p-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none"
                  value={experienceLevel}
                  onChange={(e) => setExperienceLevel(e.target.value)}
                >
                  <option value="">-- Select Experience --</option>
                  {EXPERIENCE_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-[10px] text-gray-400 mb-1">Freight Type</label>
                <select
                  className="w-full p-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none"
                  value={driverType}
                  onChange={(e) => setDriverType(e.target.value)}
                >
                  <option value="">-- Select Type --</option>
                  {DRIVER_TYPES.map((type) => (
                    <option key={type} value={type}>{type}</option>
                  ))}
                </select>
              </div>
              <p className="text-[10px] text-gray-400 italic flex items-center gap-1">
                <User size={10} /> Updating these fields helps the network.
              </p>
            </div>
          )}

          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase mb-1">
              Recruiter Notes
            </label>
            <textarea
              className="w-full p-3 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              rows="3"
              placeholder="Add specific details..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            ></textarea>
          </div>

          {outcome === 'interested' && lead.phone && (
            <div className="bg-green-50 p-3 rounded-lg border border-green-100 text-sm text-green-800 animate-in fade-in flex justify-between items-center">
              <span className="text-xs font-medium">Chat open?</span>
              <a
                href={getTelegramLink(lead.phone)}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs text-green-700 hover:text-green-900 hover:underline font-bold"
              >
                <ExternalLink size={12} /> Open Telegram
              </a>
            </div>
          )}
        </form>

        <div className="p-4 bg-gray-50 border-t border-gray-200 flex justify-end gap-3 shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-600 font-medium hover:bg-gray-200 rounded-lg text-sm"
          >
            Cancel
          </button>
          <button
            type="submit"
            onClick={handleSave}
            disabled={saving}
            className="px-6 py-2 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2 text-sm shadow-md"
          >
            {saving ? (
              <Loader2 className="animate-spin" size={16} />
            ) : (
              <Save size={16} />
            )}
            {showCallbackSelect ? 'Schedule & Save' : 'Save Result'}
          </button>
        </div>
      </div>
    </div>
  );
}
