import React from 'react';
import { Loader2, CheckCircle, Send } from 'lucide-react';

export function InviteBar({ onSend, sending, inviteSent }) {
    return (
        <div className="bg-gray-50 border border-gray-200 p-6 rounded-xl flex flex-col sm:flex-row items-center justify-between gap-4">
            <div>
                <h4 className="font-bold text-gray-900">Official System Invite</h4>
                <p className="text-sm text-gray-500">Send an automated email invite via SafeHaul.</p>
            </div>
            <button 
                onClick={onSend} 
                disabled={sending || inviteSent}
                className={`px-6 py-2.5 font-bold rounded-lg shadow-sm transition flex items-center gap-2
                    ${inviteSent 
                        ? 'bg-green-600 text-white cursor-default' 
                        : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-100'
                    } disabled:opacity-50`}
            >
                {sending ? <Loader2 className="animate-spin" size={18}/> : (inviteSent ? <CheckCircle size={18}/> : <Send size={18}/>)}
                {sending ? 'Sending...' : (inviteSent ? 'Invite Sent' : 'Send System Invite')}
            </button>
        </div>
    );
}
