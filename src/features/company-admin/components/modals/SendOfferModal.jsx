import React, { useState, useEffect } from 'react';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@lib/firebase';
import { sendNotification } from '@lib/notificationService';
import { getCompanyProfile } from '@features/companies/services/companyService';
import { X, CheckCircle2, DollarSign, Calendar, FileSignature, Loader2 } from 'lucide-react';

export function SendOfferModal({ companyId, applicationId, driverId, driverName, onClose, onOfferSent }) {
  const [loading, setLoading] = useState(false);
  const [initializing, setInitializing] = useState(true);

  // Offer Form State
  const [offerData, setOfferData] = useState({
    payRate: '',
    payType: 'CPM', // CPM, Percent, Flat
    startDate: '',
    orientationDate: '',
    benefits: [],
    notes: ''
  });

  // Load company defaults to pre-fill the offer
  useEffect(() => {
    async function loadDefaults() {
      const profile = await getCompanyProfile(companyId);
      if (profile && profile.jobOffers) {
        // Try to find a matching default, otherwise default to first available or empty
        // For simplicity, we just grab the first defined CPM we find or leave blank
        const firstOffer = Object.values(profile.jobOffers)[0]; 
        if (firstOffer) {
            setOfferData(prev => ({
                ...prev,
                payRate: firstOffer.cpm || '',
                benefits: firstOffer.benefits || []
            }));
        }
      }
      setInitializing(false);
    }
    loadDefaults();
  }, [companyId]);

  const handleSend = async (e) => {
    e.preventDefault();
    if (!offerData.payRate || !offerData.startDate) {
        alert("Please fill in Pay Rate and Start Date.");
        return;
    }

    setLoading(true);
    try {
        // 1. Update Application Document
        const appRef = doc(db, "companies", companyId, "applications", applicationId);
        await updateDoc(appRef, {
            status: "Offer Sent",
            offerDetails: {
                ...offerData,
                sentAt: new Date().toISOString()
            }
        });

        // 2. Notify Driver
        if (driverId) {
            await sendNotification({
                recipientId: driverId,
                title: "Job Offer Received!",
                message: `You have received a formal job offer. Tap to review details.`,
                type: "success",
                link: "/driver/dashboard"
            });
        }

        onOfferSent();
        onClose();
    } catch (error) {
        console.error("Error sending offer:", error);
        alert("Failed to send offer.");
    } finally {
        setLoading(false);
    }
  };

  if (initializing) return <div className="fixed inset-0 flex items-center justify-center bg-black/20 z-50"><Loader2 className="animate-spin" /></div>;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white w-full max-w-lg rounded-xl shadow-2xl border border-gray-200 flex flex-col" onClick={e => e.stopPropagation()}>

        <div className="p-5 border-b border-gray-200 flex justify-between items-center bg-blue-600 rounded-t-xl text-white">
          <h2 className="text-xl font-bold flex items-center gap-2">
            <FileSignature size={24} /> Send Job Offer
          </h2>
          <button onClick={onClose} className="p-1 hover:bg-blue-700 rounded-full transition"><X size={20} /></button>
        </div>

        <div className="p-6 space-y-5">
          <p className="text-gray-600 text-sm">
            You are extending a formal offer to <strong className="text-gray-900">{driverName}</strong>. 
            They will receive a notification to accept or decline.
          </p>

          <div className="grid grid-cols-2 gap-4">
              <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Pay Rate</label>
                  <div className="relative">
                    <DollarSign size={16} className="absolute left-3 top-3 text-gray-400" />
                    <input 
                        type="text" 
                        className="w-full pl-9 p-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                        placeholder="0.65"
                        value={offerData.payRate}
                        onChange={e => setOfferData({...offerData, payRate: e.target.value})}
                    />
                  </div>
              </div>
              <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Pay Type</label>
                  <select 
                    className="w-full p-2.5 border border-gray-300 rounded-lg bg-white"
                    value={offerData.payType}
                    onChange={e => setOfferData({...offerData, payType: e.target.value})}
                  >
                      <option value="CPM">Cents Per Mile</option>
                      <option value="Percent">Percent of Load</option>
                      <option value="Flat">Weekly Flat Rate</option>
                      <option value="Hourly">Hourly</option>
                  </select>
              </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
              <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Start Date</label>
                  <input 
                        type="date" 
                        className="w-full p-2.5 border border-gray-300 rounded-lg"
                        value={offerData.startDate}
                        onChange={e => setOfferData({...offerData, startDate: e.target.value})}
                    />
              </div>
              <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Orientation</label>
                  <input 
                        type="date" 
                        className="w-full p-2.5 border border-gray-300 rounded-lg"
                        value={offerData.orientationDate}
                        onChange={e => setOfferData({...offerData, orientationDate: e.target.value})}
                    />
              </div>
          </div>

          <div>
             <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Benefits Included</label>
             <textarea 
                className="w-full p-3 border border-gray-300 rounded-lg text-sm h-20"
                placeholder="List key benefits (e.g. Medical, Dental, Sign-on Bonus)..."
                value={Array.isArray(offerData.benefits) ? offerData.benefits.join(', ') : offerData.benefits}
                onChange={e => setOfferData({...offerData, benefits: e.target.value.split(', ')})}
             />
             <p className="text-xs text-gray-400 mt-1">Separate items with a comma.</p>
          </div>
        </div>

        <div className="p-5 border-t border-gray-200 bg-gray-50 rounded-b-xl flex justify-end gap-3">
            <button onClick={onClose} className="px-5 py-2 text-gray-600 hover:bg-gray-200 font-semibold rounded-lg transition">Cancel</button>
            <button 
                onClick={handleSend} 
                disabled={loading}
                className="px-6 py-2 bg-green-600 text-white font-bold rounded-lg hover:bg-green-700 shadow-md flex items-center gap-2 disabled:opacity-50"
            >
                {loading ? <Loader2 className="animate-spin" size={18} /> : <CheckCircle2 size={18} />}
                Send Offer
            </button>
        </div>

      </div>
    </div>
  );
}