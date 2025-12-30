import React, { useState } from 'react';
import { 
    Users, User, Briefcase, Truck, Key, Heart, 
    Hotel, Plane 
} from 'lucide-react';
import { SubPositionEditor } from './SubPositionEditor';
import { BENEFITS_LIST } from './HiringConfig';

export function HiringPositionsBuilder({ data, onChange, isCompanyAdmin }) {

    // Local state for active tabs within categories (Solo vs Team)
    const [activeTabs, setActiveTabs] = useState({
        companyDriver: 'solo',
        ownerOperator: 'solo',
        leaseOperator: 'solo'
    });

    // --- Data Helpers ---
    const safeData = data || {};
    const safeCat = (cat) => safeData[cat] || { solo: {}, team: {} };

    // --- Handlers ---

    const handleSubPositionChange = (category, type, newData) => {
        onChange({
            ...safeData,
            [category]: {
                ...safeCat(category),
                [type]: newData
            }
        });
    };

    const toggleBenefit = (benefitId) => {
        const currentBenefits = safeData.benefits || {};
        const newValue = !currentBenefits[benefitId];

        onChange({
            ...safeData,
            benefits: {
                ...currentBenefits,
                [benefitId]: newValue
            }
        });
    };

    const handleTabSwitch = (category, tab) => {
        setActiveTabs(prev => ({ ...prev, [category]: tab }));
    };

    // --- Renderers ---

    const renderCategorySection = (categoryKey, title, icon) => {
        const activeTab = activeTabs[categoryKey];
        const categoryData = safeCat(categoryKey);

        return (
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
                <div className="p-4 bg-gray-50 border-b border-gray-200 flex justify-between items-center">
                    <h3 className="font-bold text-gray-800 flex items-center gap-2">
                        {icon} {title}
                    </h3>

                    {/* Tab Switcher */}
                    <div className="flex bg-gray-200 p-1 rounded-lg">
                        <button
                            onClick={() => handleTabSwitch(categoryKey, 'solo')}
                            className={`px-3 py-1 text-xs font-bold rounded-md transition-all ${
                                activeTab === 'solo' 
                                ? 'bg-white text-blue-600 shadow-sm' 
                                : 'text-gray-500 hover:text-gray-700'
                            }`}
                        >
                            Solo
                        </button>
                        <button
                            onClick={() => handleTabSwitch(categoryKey, 'team')}
                            className={`px-3 py-1 text-xs font-bold rounded-md transition-all ${
                                activeTab === 'team' 
                                ? 'bg-white text-blue-600 shadow-sm' 
                                : 'text-gray-500 hover:text-gray-700'
                            }`}
                        >
                            Team
                        </button>
                    </div>
                </div>

                <div className="p-4">
                    {/* Render the specific editor based on active tab */}
                    {activeTab === 'solo' ? (
                        <SubPositionEditor 
                            title={`${title} (Solo)`}
                            data={categoryData.solo || {}}
                            onChange={(newData) => handleSubPositionChange(categoryKey, 'solo', newData)}
                            category={categoryKey}
                        />
                    ) : (
                        <SubPositionEditor 
                            title={`${title} (Team)`}
                            data={categoryData.team || {}}
                            onChange={(newData) => handleSubPositionChange(categoryKey, 'team', newData)}
                            category={categoryKey}
                        />
                    )}
                </div>
            </div>
        );
    };

    return (
        <div className="space-y-8">

            {/* 1. Job Positions Grid */}
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                {renderCategorySection('companyDriver', 'Company Driver', <Briefcase size={20} className="text-blue-600"/>)}
                {renderCategorySection('ownerOperator', 'Owner Operator', <Truck size={20} className="text-purple-600"/>)}
                {renderCategorySection('leaseOperator', 'Lease Operator', <Key size={20} className="text-orange-600"/>)}
            </div>

            {/* 2. Global Benefits Section */}
            <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
                <h3 className="font-bold text-gray-900 flex items-center gap-2 mb-4 border-b border-gray-100 pb-2">
                    <Heart size={20} className="text-red-500" fill="currentColor" /> 
                    Benefits & Perks (Global)
                </h3>

                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                    {BENEFITS_LIST.map(ben => {
                        const isChecked = safeData.benefits?.[ben.id] === true;
                        return (
                            <button
                                key={ben.id}
                                onClick={() => toggleBenefit(ben.id)}
                                className={`flex items-center gap-3 p-3 rounded-lg border text-left transition-all ${
                                    isChecked 
                                    ? 'bg-blue-50 border-blue-200 shadow-sm' 
                                    : 'bg-white border-gray-200 hover:bg-gray-50'
                                }`}
                            >
                                <div className={`w-5 h-5 rounded flex items-center justify-center border ${isChecked ? 'bg-blue-600 border-blue-600 text-white' : 'border-gray-300 bg-white'}`}>
                                    {isChecked && <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7"></path></svg>}
                                </div>
                                <span className={`text-sm font-medium ${isChecked ? 'text-blue-900' : 'text-gray-600'}`}>
                                    {ben.label}
                                </span>
                            </button>
                        );
                    })}
                </div>

                {/* Admin Only Extras */}
                {isCompanyAdmin && (
                    <div className="mt-6 pt-4 border-t border-gray-100">
                        {/* Renamed Section Title */}
                        <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Driver Transportation and Stay</h4>
                        <div className="flex flex-col sm:flex-row gap-4">
                            <label className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg border border-gray-200 cursor-pointer hover:bg-gray-100">
                                <input 
                                    type="checkbox"
                                    className="w-5 h-5 text-green-600 rounded focus:ring-green-500 border-gray-300"
                                    checked={safeData.benefits?.coversTransportation === true}
                                    onChange={() => toggleBenefit('coversTransportation')}
                                />
                                <Plane size={18} className="text-gray-500"/>
                                <span className="text-sm font-bold text-gray-700">Covers Travel to HQ</span>
                            </label>

                            <label className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg border border-gray-200 cursor-pointer hover:bg-gray-100">
                                <input 
                                    type="checkbox"
                                    className="w-5 h-5 text-green-600 rounded focus:ring-green-500 border-gray-300"
                                    checked={safeData.benefits?.coversHotel === true}
                                    onChange={() => toggleBenefit('coversHotel')}
                                />
                                <Hotel size={18} className="text-gray-500"/>
                                <span className="text-sm font-bold text-gray-700">Covers Hotel Stay</span>
                            </label>
                        </div>
                    </div>
                )}
            </div>

        </div>
    );
}