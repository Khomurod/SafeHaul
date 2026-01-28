import React from 'react';
import { FileSignature, PenTool, Shield, Clock } from 'lucide-react';

export function ESignatureAnimation() {
    return (
        <div className="flex flex-col items-center justify-center py-16 px-4">
            <div className="relative mb-8">
                <div className="absolute inset-0 bg-blue-200 rounded-full blur-xl opacity-50 animate-pulse" />
                <div className="relative bg-blue-100 p-6 rounded-full border-4 border-blue-300">
                    <FileSignature size={64} className="text-blue-600" />
                </div>
            </div>
            
            <h3 className="text-2xl font-bold text-gray-800 mb-3">E-Signature Coming Soon</h3>
            <p className="text-gray-500 text-center max-w-md mb-8">
                Digital document signing is on the way. You'll be able to send, sign, and manage documents securely.
            </p>
            
            <div className="grid grid-cols-3 gap-6 text-center">
                <div className="flex flex-col items-center gap-2">
                    <div className="p-3 bg-green-100 rounded-full">
                        <PenTool size={24} className="text-green-600" />
                    </div>
                    <span className="text-sm text-gray-600">Easy Signing</span>
                </div>
                <div className="flex flex-col items-center gap-2">
                    <div className="p-3 bg-purple-100 rounded-full">
                        <Shield size={24} className="text-purple-600" />
                    </div>
                    <span className="text-sm text-gray-600">Secure</span>
                </div>
                <div className="flex flex-col items-center gap-2">
                    <div className="p-3 bg-orange-100 rounded-full">
                        <Clock size={24} className="text-orange-600" />
                    </div>
                    <span className="text-sm text-gray-600">Track Status</span>
                </div>
            </div>
        </div>
    );
}
