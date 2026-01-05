import React from 'react';

const VehicleExperienceSection = ({ formData, updateFormData, milesOptions, expOptions }) => {
    return (
        <fieldset className="border border-gray-300 rounded-lg p-4 space-y-4 mt-6">
            <legend className="text-lg font-semibold text-gray-800 px-2">Experience by Vehicle Type</legend>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div>
                    <label htmlFor="exp-straight-truck-miles" className="block text-sm font-medium text-gray-700 mb-1">Miles Driven in Straight Truck</label>
                    <select id="exp-straight-truck-miles" name="expStraightTruckMiles" value={formData.expStraightTruckMiles || '0'} onChange={(e) => updateFormData(e.target.name, e.target.value)} className="w-full p-3 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-gray-700">
                        {milesOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                </div>
                <div>
                    <label htmlFor="exp-straight-truck-exp" className="block text-sm font-medium text-gray-700 mb-1">Experience in Straight Truck</label>
                    <select id="exp-straight-truck-exp" name="expStraightTruckExp" value={formData.expStraightTruckExp || '<6 months'} onChange={(e) => updateFormData(e.target.name, e.target.value)} className="w-full p-3 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-gray-700">
                        {expOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                </div>
                <div>
                    <label htmlFor="exp-semi-trailer-miles" className="block text-sm font-medium text-gray-700 mb-1">Miles Driven in Tractor + Semi Trailer</label>
                    <select id="exp-semi-trailer-miles" name="expSemiTrailerMiles" value={formData.expSemiTrailerMiles || '0'} onChange={(e) => updateFormData(e.target.name, e.target.value)} className="w-full p-3 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-gray-700">
                        {milesOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                </div>
                <div>
                    <label htmlFor="exp-semi-trailer-exp" className="block text-sm font-medium text-gray-700 mb-1">Experience in Tractor + Semi Trailer</label>
                    <select id="exp-semi-trailer-exp" name="expSemiTrailerExp" value={formData.expSemiTrailerExp || '<6 months'} onChange={(e) => updateFormData(e.target.name, e.target.value)} className="w-full p-3 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-gray-700">
                        {expOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                </div>
                <div>
                    <label htmlFor="exp-two-trailers-miles" className="block text-sm font-medium text-gray-700 mb-1">Miles Driven in Tractor + Two Trailers</label>
                    <select id="exp-two-trailers-miles" name="expTwoTrailersMiles" value={formData.expTwoTrailersMiles || '0'} onChange={(e) => updateFormData(e.target.name, e.target.value)} className="w-full p-3 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-gray-700">
                        {milesOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                </div>
                <div>
                    <label htmlFor="exp-two-trailers-exp" className="block text-sm font-medium text-gray-700 mb-1">Experience in Tractor + Two Trailers</label>
                    <select id="exp-two-trailers-exp" name="expTwoTrailersExp" value={formData.expTwoTrailersExp || '<6 months'} onChange={(e) => updateFormData(e.target.name, e.target.value)} className="w-full p-3 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-gray-700">
                        {expOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                </div>
            </div>
        </fieldset>
    );
};

export default VehicleExperienceSection;
