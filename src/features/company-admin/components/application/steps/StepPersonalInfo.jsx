import React from 'react';
import { User, Phone, Mail, Calendar, Shield } from 'lucide-react';

export function StepPersonalInfo({ data, onChange }) {
  
  const handleChange = (e) => {
    const { name, value } = e.target;
    onChange({ [name]: value });
  };

  return (
    <div className="space-y-6 animate-in slide-in-from-right duration-500">
      
      <div className="bg-blue-50 border border-blue-100 rounded-lg p-4 mb-6">
        <h3 className="text-blue-900 font-bold text-sm mb-1">Let's start with the basics</h3>
        <p className="text-blue-700 text-xs">
          Please enter your legal name as it appears on your Commercial Driver's License (CDL).
        </p>
      </div>

      {/* Name Section */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">First Name</label>
          <div className="relative">
            <User className="absolute left-3 top-3 text-gray-400" size={18} />
            <input
              type="text"
              name="firstName"
              required
              className="w-full pl-10 p-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              placeholder="John"
              value={data.firstName || ''}
              onChange={handleChange}
            />
          </div>
        </div>
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">Middle Name</label>
          <input
            type="text"
            name="middleName"
            className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
            placeholder="(Optional)"
            value={data.middleName || ''}
            onChange={handleChange}
          />
        </div>
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">Last Name</label>
          <input
            type="text"
            name="lastName"
            required
            className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
            placeholder="Doe"
            value={data.lastName || ''}
            onChange={handleChange}
          />
        </div>
      </div>

      {/* Contact Section */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">Phone Number</label>
          <div className="relative">
            <Phone className="absolute left-3 top-3 text-gray-400" size={18} />
            <input
              type="tel"
              name="phone"
              required
              className="w-full pl-10 p-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              placeholder="(555) 123-4567"
              value={data.phone || ''}
              onChange={handleChange}
            />
          </div>
        </div>
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">Email Address</label>
          <div className="relative">
            <Mail className="absolute left-3 top-3 text-gray-400" size={18} />
            <input
              type="email"
              name="email"
              required
              className="w-full pl-10 p-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              placeholder="your@email.com"
              value={data.email || ''}
              onChange={handleChange}
            />
          </div>
        </div>
      </div>

      {/* Referral Source */}
      <div className="pt-4 border-t border-gray-100">
        <label className="block text-sm font-semibold text-gray-700 mb-1">How did you hear about us?</label>
        <select
          name="referralSource"
          className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white"
          value={data.referralSource || ''}
          onChange={handleChange}
        >
          <option value="">(Optional) Select...</option>
          <option value="Indeed">Indeed</option>
          <option value="Facebook">Facebook</option>
          <option value="Craigslist">Craigslist</option>
          <option value="Referral">Friend/Referral</option>
          <option value="Company Website">Company Website</option>
          <option value="Other">Other</option>
        </select>
      </div>

      {/* Identity Section */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t border-gray-100">
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">Date of Birth</label>
          <div className="relative">
            <Calendar className="absolute left-3 top-3 text-gray-400" size={18} />
            <input
              type="date"
              name="dob"
              required
              className="w-full pl-10 p-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              value={data.dob || ''}
              onChange={handleChange}
            />
          </div>
        </div>
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">Social Security Number</label>
          <div className="relative">
            <Shield className="absolute left-3 top-3 text-gray-400" size={18} />
            <input
              type="text"
              name="ssn"
              required
              className="w-full pl-10 p-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              placeholder="XXX-XX-XXXX"
              value={data.ssn || ''}
              onChange={handleChange}
            />
          </div>
          <p className="text-[10px] text-gray-500 mt-1">Required for DOT background checks. Encrypted securely.</p>
        </div>
      </div>

    </div>
  );
}