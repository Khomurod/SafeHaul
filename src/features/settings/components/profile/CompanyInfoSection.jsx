import React from 'react';
import { Phone, MapPin, Hash } from 'lucide-react';
import { BrandingSection } from './BrandingSection';

export function CompanyInfoSection({
    compData,
    isEditing,
    logoUploading,
    onLogoUpload,
    onFieldChange
}) {
    return (
        <div className="space-y-6 animate-in slide-in-from-bottom-2">
            <div className="bg-white border border-gray-200 rounded-xl p-6 flex flex-col md:flex-row gap-8 shadow-sm">
                <BrandingSection
                    companyLogoUrl={compData.companyLogoUrl}
                    isEditing={isEditing}
                    logoUploading={logoUploading}
                    onLogoUpload={onLogoUpload}
                />

                <div className="flex-1 space-y-4 w-full">
                    <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Company Name</label>
                        {isEditing ? (
                            <input 
                                type="text" 
                                value={compData.companyName || ''} 
                                onChange={(e) => onFieldChange('companyName', e.target.value)} 
                                className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none font-bold text-gray-900" 
                            />
                        ) : (
                            <p className="text-xl font-bold text-gray-900">{compData.companyName || 'Not Set'}</p>
                        )}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs font-bold text-gray-500 uppercase mb-1">MC Number</label>
                            {isEditing ? (
                                <div className="relative">
                                    <Hash size={14} className="absolute left-3 top-3 text-gray-400" />
                                    <input 
                                        type="text" 
                                        value={compData.mcNumber || ''} 
                                        onChange={(e) => onFieldChange('mcNumber', e.target.value)} 
                                        className="w-full pl-9 p-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" 
                                    />
                                </div>
                            ) : (
                                <p className="text-sm font-medium text-gray-800 bg-gray-50 px-3 py-2 rounded-lg border border-gray-200">
                                    {compData.mcNumber || 'N/A'}
                                </p>
                            )}
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-gray-500 uppercase mb-1">DOT Number</label>
                            {isEditing ? (
                                <div className="relative">
                                    <Hash size={14} className="absolute left-3 top-3 text-gray-400" />
                                    <input 
                                        type="text" 
                                        value={compData.dotNumber || ''} 
                                        onChange={(e) => onFieldChange('dotNumber', e.target.value)} 
                                        className="w-full pl-9 p-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" 
                                    />
                                </div>
                            ) : (
                                <p className="text-sm font-medium text-gray-800 bg-gray-50 px-3 py-2 rounded-lg border border-gray-200">
                                    {compData.dotNumber || 'N/A'}
                                </p>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <ContactInfoCard 
                    compData={compData} 
                    isEditing={isEditing} 
                    onFieldChange={onFieldChange} 
                />
                <AddressCard 
                    compData={compData} 
                    isEditing={isEditing} 
                    onFieldChange={onFieldChange} 
                />
            </div>
        </div>
    );
}

function ContactInfoCard({ compData, isEditing, onFieldChange }) {
    return (
        <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
            <h3 className="font-bold text-gray-900 border-b border-gray-100 pb-2 mb-4 flex items-center gap-2">
                <Phone size={18} className="text-blue-600" /> Contact Info
            </h3>
            <div className="space-y-4">
                <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Phone</label>
                    {isEditing ? (
                        <input 
                            type="text" 
                            value={compData.phone || ''} 
                            onChange={(e) => onFieldChange('phone', e.target.value)} 
                            className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" 
                        />
                    ) : (
                        <p className="text-sm font-medium text-gray-800">{compData.phone || 'N/A'}</p>
                    )}
                </div>
                <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Email</label>
                    {isEditing ? (
                        <input 
                            type="email" 
                            value={compData.email || ''} 
                            onChange={(e) => onFieldChange('email', e.target.value)} 
                            className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" 
                        />
                    ) : (
                        <p className="text-sm font-medium text-gray-800">{compData.email || 'N/A'}</p>
                    )}
                </div>
            </div>
        </div>
    );
}

function AddressCard({ compData, isEditing, onFieldChange }) {
    return (
        <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
            <h3 className="font-bold text-gray-900 border-b border-gray-100 pb-2 mb-4 flex items-center gap-2">
                <MapPin size={18} className="text-blue-600" /> HQ Address
            </h3>
            <div className="space-y-4">
                <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Street</label>
                    {isEditing ? (
                        <input 
                            type="text" 
                            value={compData.street || ''} 
                            onChange={(e) => onFieldChange('street', e.target.value)} 
                            className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" 
                        />
                    ) : (
                        <p className="text-sm font-medium text-gray-800">{compData.street || 'N/A'}</p>
                    )}
                </div>
                <div className="grid grid-cols-3 gap-2">
                    <div className="col-span-1">
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">City</label>
                        {isEditing ? (
                            <input 
                                type="text" 
                                value={compData.city || ''} 
                                onChange={(e) => onFieldChange('city', e.target.value)} 
                                className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" 
                            />
                        ) : (
                            <p className="text-sm font-medium text-gray-800">{compData.city || 'N/A'}</p>
                        )}
                    </div>
                    <div className="col-span-1">
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">State</label>
                        {isEditing ? (
                            <input 
                                type="text" 
                                value={compData.state || ''} 
                                onChange={(e) => onFieldChange('state', e.target.value)} 
                                maxLength={2}
                                className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" 
                            />
                        ) : (
                            <p className="text-sm font-medium text-gray-800">{compData.state || 'XX'}</p>
                        )}
                    </div>
                    <div className="col-span-1">
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Zip</label>
                        {isEditing ? (
                            <input 
                                type="text" 
                                value={compData.zip || ''} 
                                onChange={(e) => onFieldChange('zip', e.target.value)} 
                                className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" 
                            />
                        ) : (
                            <p className="text-sm font-medium text-gray-800">{compData.zip || '00000'}</p>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
