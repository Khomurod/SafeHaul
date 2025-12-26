import React, { useState } from 'react';
import { CheckCircle, XCircle, DollarSign, Calendar, Gift, Loader2 } from 'lucide-react';

export function JobOfferCard({ offer, onRespond }) {
  const [processing, setProcessing] = useState(false);

  if (!offer) return null;

  const handleAction = async (status) => {
    if (!window.confirm(`Are you sure you want to ${status === 'Offer Accepted' ? 'ACCEPT' : 'DECLINE'} this offer?`)) return;

    setProcessing(true);
    try {
        await onRespond(status);
    } catch (e) {
        console.error(e);
        setProcessing(false);
    }
  };

  return (
    <div className="bg-green-50 border border-green-200 rounded-2xl p-6 shadow-sm mb-6">
        <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-green-100 text-green-700 rounded-full">
                <Gift size={24} />
            </div>
            <div>
                <h3 className="text-xl font-bold text-green-900">Job Offer Received!</h3>
                <p className="text-green-700 text-sm">Review the details below.</p>
            </div>
        </div>

        <div className="bg-white rounded-xl p-4 border border-green-100 mb-4">
            <div className="grid grid-cols-2 gap-4">
                <div>
                    <p className="text-xs font-bold text-green-800 uppercase mb-1 flex items-center gap-1">
                        <DollarSign size={14}/> Pay Rate
                    </p>
                    <p className="text-lg font-bold text-gray-900">
                        {offer.payRate} <span className="text-xs font-medium text-gray-500">/ {offer.payType}</span>
                    </p>
                </div>
                <div>
                    <p className="text-xs font-bold text-green-800 uppercase mb-1 flex items-center gap-1">
                        <Calendar size={14}/> Start Date
                    </p>
                    <p className="text-lg font-bold text-gray-900">
                        {offer.startDate ? new Date(offer.startDate).toLocaleDateString() : 'TBD'}
                    </p>
                </div>
            </div>
        </div>

        <div className="flex gap-3">
            <button 
                onClick={() => handleAction('Offer Declined')}
                disabled={processing}
                className="flex-1 py-3 bg-white border border-gray-300 text-gray-600 font-bold rounded-xl hover:bg-gray-50 flex items-center justify-center gap-2"
            >
                <XCircle size={18} /> Decline
            </button>
            <button 
                onClick={() => handleAction('Offer Accepted')}
                disabled={processing}
                className="flex-[2] py-3 bg-green-600 text-white font-bold rounded-xl hover:bg-green-700 shadow-md flex items-center justify-center gap-2"
            >
                {processing ? <Loader2 className="animate-spin" size={18}/> : <CheckCircle size={18} />}
                Accept Offer
            </button>
        </div>
    </div>
  );
}