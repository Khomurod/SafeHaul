import React from 'react';
import { MapPin, Calendar, Home } from 'lucide-react';

export function StepAddressHistory({ data, onChange }) {
  
  const handleChange = (e) => {
    const { name, value } = e.target;
    onChange({ [name]: value });
  };

  const showPreviousAddress = data['residence-3-years'] === 'no';

  return (
    <div className="space-y-6 animate-in slide-in-from-right duration-500">
      
      <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
        <h3 className="font-bold text-gray-900 flex items-center gap-2 mb-4">
          <Home size={20} className="text-blue-600" /> Current Address
        </h3>
        
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Street Address</label>
            <input
              type="text"
              name="street"
              className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              placeholder="1234 Main St"
              value={data.street || ''}
              onChange={handleChange}
            />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div className="col-span-2 md:col-span-1">
              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">City</label>
              <input
                type="text"
                name="city"
                className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                placeholder="City"
                value={data.city || ''}
                onChange={handleChange}
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">State</label>
              <input
                type="text"
                name="state"
                maxLength={2}
                className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                placeholder="IL"
                value={data.state || ''}
                onChange={handleChange}
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Zip</label>
              <input
                type="text"
                name="zip"
                maxLength={5}
                className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                placeholder="00000"
                value={data.zip || ''}
                onChange={handleChange}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="bg-blue-50 border border-blue-100 rounded-xl p-6">
        <label className="flex items-start gap-3 cursor-pointer">
          <div className="mt-1">
             <Calendar size={20} className="text-blue-600" />
          </div>
          <div>
            <span className="block font-bold text-gray-900">Have you lived at this address for 3 years or more?</span>
            <span className="text-sm text-gray-600">DOT regulations require a full 3-year residency history.</span>
            
            <div className="flex gap-4 mt-3">
              <label className="flex items-center gap-2">
                <input 
                  type="radio" 
                  name="residence-3-years" 
                  value="yes"
                  checked={data['residence-3-years'] === 'yes'}
                  onChange={handleChange}
                  className="w-4 h-4 text-blue-600"
                />
                <span className="text-sm font-medium">Yes</span>
              </label>
              <label className="flex items-center gap-2">
                <input 
                  type="radio" 
                  name="residence-3-years" 
                  value="no"
                  checked={data['residence-3-years'] === 'no'}
                  onChange={handleChange}
                  className="w-4 h-4 text-blue-600"
                />
                <span className="text-sm font-medium">No</span>
              </label>
            </div>
          </div>
        </label>
      </div>

      {showPreviousAddress && (
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-6 animate-in fade-in slide-in-from-top-4">
          <h3 className="font-bold text-gray-900 flex items-center gap-2 mb-4">
            <MapPin size={20} className="text-gray-500" /> Previous Address
          </h3>
          
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Previous Street</label>
              <input
                type="text"
                name="prevStreet"
                className="w-full p-3 border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 outline-none"
                placeholder="Previous Street Address"
                value={data.prevStreet || ''}
                onChange={handleChange}
              />
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div className="col-span-2 md:col-span-1">
                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">City</label>
                <input
                  type="text"
                  name="prevCity"
                  className="w-full p-3 border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 outline-none"
                  value={data.prevCity || ''}
                  onChange={handleChange}
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">State</label>
                <input
                  type="text"
                  name="prevState"
                  maxLength={2}
                  className="w-full p-3 border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 outline-none"
                  value={data.prevState || ''}
                  onChange={handleChange}
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Zip</label>
                <input
                  type="text"
                  name="prevZip"
                  maxLength={5}
                  className="w-full p-3 border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 outline-none"
                  value={data.prevZip || ''}
                  onChange={handleChange}
                />
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}