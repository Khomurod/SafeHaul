import React from 'react';
import { Building } from 'lucide-react';

export function BrandingSection({ 
    companyLogoUrl, 
    isEditing, 
    logoUploading, 
    onLogoUpload 
}) {
    return (
        <div className="flex flex-col items-center gap-3">
            <div className="w-32 h-32 bg-gray-50 rounded-xl flex items-center justify-center border border-gray-200 overflow-hidden shadow-inner">
                {companyLogoUrl ? (
                    <img src={companyLogoUrl} alt="Logo" className="w-full h-full object-contain" />
                ) : (
                    <Building className="text-gray-400" size={48} />
                )}
            </div>
            {isEditing && (
                <label className="cursor-pointer px-3 py-1.5 bg-blue-50 text-blue-600 rounded-md text-xs font-bold hover:bg-blue-100 transition-colors">
                    {logoUploading ? 'Uploading...' : 'Change Logo'}
                    <input 
                        type="file" 
                        className="hidden" 
                        accept="image/*" 
                        onChange={onLogoUpload} 
                        disabled={logoUploading} 
                    />
                </label>
            )}
        </div>
    );
}
