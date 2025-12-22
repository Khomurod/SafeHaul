import React from 'react';
import { 
  User, MapPin, Truck, Briefcase, FileCheck, 
  CheckSquare, AlertCircle, PenTool, ShieldCheck, 
  Beaker, GraduationCap, Shield, Clock, IdCard
} from 'lucide-react';
import { formatPhoneNumber } from '@shared/utils/helpers';

const SummarySection = ({ title, icon: Icon, children }) => (
  <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
    <h4 className="font-bold text-gray-800 flex items-center gap-2 mb-3 border-b border-gray-100 pb-2">
      <Icon size={18} className="text-blue-600" /> {title}
    </h4>
    <div className="space-y-2 text-sm text-gray-600">
      {children}
    </div>
  </div>
);

const Row = ({ label, value }) => {
  if (!value && value !== 0) return null;
  return (
    <div className="flex justify-between">
      <span className="text-gray-500">{label}:</span>
      <span className="font-medium text-gray-900 text-right">{value}</span>
    </div>
  );
};

const formatListSummary = (list, getSummary, maxItems = 2) => {
  if (!list || list.length === 0) return 'None recorded';
  const summaries = list.slice(0, maxItems).map(item => getSummary(item));
  let text = summaries.join(', ');
  if (list.length > maxItems) text += `, and ${list.length - maxItems} more`;
  return `${list.length} recorded: ${text}`;
};

export function StepReview({ data, onChange }) {

  const handleSignatureChange = (e) => {
    onChange({ 
      signature: `TEXT_SIGNATURE:${e.target.value}`,
      signatureName: e.target.value,
      'signature-date': new Date().toLocaleDateString()
    });
  };

  const handleConsentChange = (e) => {
    const { name, checked } = e.target;
    onChange({ [name]: checked ? 'yes' : 'no' });
  };

  const endorsements = Array.isArray(data.endorsements) ? data.endorsements : 
                       (typeof data.endorsements === 'string' ? data.endorsements.split(',').filter(e => e) : []);

  const employers = Array.isArray(data.employers) ? data.employers : [];
  const violations = Array.isArray(data.violations) ? data.violations : [];
  const accidents = Array.isArray(data.accidents) ? data.accidents : [];
  const unemployment = Array.isArray(data.unemployment) ? data.unemployment : [];
  const schools = Array.isArray(data.schools) ? data.schools : [];
  const military = Array.isArray(data.military) ? data.military : [];

  return (
    <div className="space-y-6 animate-in slide-in-from-right duration-500">
      
      <div className="bg-green-50 border border-green-200 p-4 rounded-xl text-center">
        <h3 className="text-green-800 font-bold text-lg flex items-center justify-center gap-2">
          <FileCheck size={24} /> Review Your Application
        </h3>
        <p className="text-green-700 text-sm mt-1">
          Please verify all information is correct before signing.
        </p>
      </div>

      {/* 1. Personal Info */}
      <SummarySection title="Personal Information" icon={User}>
        <Row label="Full Name" value={`${data.firstName || ''} ${data.middleName || ''} ${data.lastName || ''}`} />
        <Row label="Phone" value={formatPhoneNumber(data.phone)} />
        <Row label="Email" value={data.email} />
        <Row label="Date of Birth" value={data.dob} />
        <Row label="SSN" value={data.ssn ? '***-**-****' : null} />
        <Row label="Referral Source" value={data.referralSource} />
      </SummarySection>

      {/* 2. Address */}
      <SummarySection title="Address History" icon={MapPin}>
        <Row label="Current Address" value={`${data.street || ''}, ${data.city || ''}, ${data.state || ''} ${data.zip || ''}`} />
        <Row label="3+ Years Here" value={data['residence-3-years'] === 'yes' ? 'Yes' : 'No'} />
        {data['residence-3-years'] === 'no' && data.prevStreet && (
          <Row label="Previous Address" value={`${data.prevStreet}, ${data.prevCity}, ${data.prevState} ${data.prevZip}`} />
        )}
      </SummarySection>

      {/* 3. License */}
      <SummarySection title="License & Credentials" icon={IdCard}>
        <Row label="License State/Class" value={`${data.cdlState || ''} (${data.cdlClass || ''})`} />
        <Row label="License Number" value={data.cdlNumber} />
        <Row label="CDL Expiration" value={data.cdlExpiration} />
        <Row label="Medical Card Exp" value={data.medCardExpiration} />
        <Row label="TWIC Card" value={data['has-twic'] === 'yes' ? `Yes (Exp: ${data.twicExpiration || 'N/A'})` : 'No'} />
        <div className="pt-2 border-t border-gray-100 mt-2">
          <span className="text-gray-500 block mb-1">Endorsements:</span>
          <div className="flex flex-wrap gap-1 justify-end">
            {endorsements.length > 0 ? endorsements.map(e => (
              <span key={e} className="px-2 py-0.5 bg-gray-100 rounded text-xs font-bold">{e}</span>
            )) : <span className="text-gray-400">None</span>}
          </div>
        </div>
      </SummarySection>

      {/* 4. Qualifications */}
      <SummarySection title="Qualifications" icon={ShieldCheck}>
        <Row label="Legal to Work in U.S." value={data['legal-work']} />
        <Row label="English Fluency" value={data['english-fluency']} />
        <Row label="CDL Experience" value={data.experience} />
        <Row label="Equipment" value={(data.driverType || []).join(', ') || 'None selected'} />
      </SummarySection>

      {/* 5. Drug & Alcohol */}
      <SummarySection title="Drug & Alcohol History" icon={Beaker}>
        <Row label="Positive Tests/Refusals" value={data['drug-test-positive']} />
        {data['drug-test-positive'] === 'yes' && <Row label="Explanation" value={data['drug-test-explanation']} />}
        <Row label="DOT Return to Duty" value={data['dot-return-to-duty']} />
      </SummarySection>

      {/* 6. Driving Record */}
      <SummarySection title="Driving Record" icon={AlertCircle}>
        <Row label="License Revoked/Suspended" value={data['revoked-licenses']} />
        <Row label="Accidents (3yr)" value={data.hasAccidents === 'yes' ? `Yes (${accidents.length} recorded)` : 'None'} />
        <Row label="Violations (3yr)" value={data.hasViolations === 'yes' ? `Yes (${violations.length} recorded)` : 'None'} />
      </SummarySection>

      {/* 7. Employment */}
      <SummarySection title="Work History" icon={Briefcase}>
        <Row label="Employers Listed" value={formatListSummary(employers, emp => emp.name)} />
        <Row label="Unemployment Gaps" value={formatListSummary(unemployment, gap => `${gap.startDate} to ${gap.endDate}`)} />
        <Row label="Driving Schools" value={formatListSummary(schools, s => s.name)} />
        <Row label="Military Service" value={formatListSummary(military, m => m.branch)} />
      </SummarySection>

      {/* Legal Statements */}
      <div className="space-y-4 pt-4 border-t-2 border-gray-100">
        <h3 className="font-bold text-gray-900">Legal Statements & Consent</h3>
        
        <label className="flex gap-3 p-4 border border-gray-200 rounded-xl cursor-pointer hover:bg-gray-50 transition-colors">
          <input 
            type="checkbox" 
            name="consent-truth"
            className="mt-1 w-5 h-5 text-blue-600 rounded"
            checked={data['consent-truth'] === 'yes'}
            onChange={handleConsentChange}
          />
          <div className="text-sm text-gray-600">
            <strong>Certification of Truth:</strong> I certify that this application was completed by me, and that all entries on it and information in it are true and complete to the best of my knowledge.
          </div>
        </label>

        <label className="flex gap-3 p-4 border border-gray-200 rounded-xl cursor-pointer hover:bg-gray-50 transition-colors">
          <input 
            type="checkbox" 
            name="consent-background"
            className="mt-1 w-5 h-5 text-blue-600 rounded"
            checked={data['consent-background'] === 'yes'}
            onChange={handleConsentChange}
          />
          <div className="text-sm text-gray-600">
            <strong>Background Check Consent:</strong> I authorize the carrier to make such investigations and inquiries of my personal, employment, financial or medical history as may be necessary in arriving at an employment decision.
          </div>
        </label>

        <label className="flex gap-3 p-4 border border-gray-200 rounded-xl cursor-pointer hover:bg-gray-50 transition-colors">
          <input 
            type="checkbox" 
            name="consent-mvr"
            className="mt-1 w-5 h-5 text-blue-600 rounded"
            checked={data['consent-mvr'] === 'yes'}
            onChange={handleConsentChange}
          />
          <div className="text-sm text-gray-600">
            <strong>MVR Authorization:</strong> I authorize the release of my Motor Vehicle Record (MVR) to the prospective employer for employment purposes.
          </div>
        </label>

        <label className="flex gap-3 p-4 border border-gray-200 rounded-xl cursor-pointer hover:bg-gray-50 transition-colors">
          <input 
            type="checkbox" 
            name="consent-psp"
            className="mt-1 w-5 h-5 text-blue-600 rounded"
            checked={data['consent-psp'] === 'yes'}
            onChange={handleConsentChange}
          />
          <div className="text-sm text-gray-600">
            <strong>PSP Authorization:</strong> I authorize access to the FMCSA Pre-Employment Screening Program (PSP) for review of my safety performance history.
          </div>
        </label>

        <label className="flex gap-3 p-4 border border-gray-200 rounded-xl cursor-pointer hover:bg-gray-50 transition-colors">
          <input 
            type="checkbox" 
            name="consent-clearinghouse"
            className="mt-1 w-5 h-5 text-blue-600 rounded"
            checked={data['consent-clearinghouse'] === 'yes'}
            onChange={handleConsentChange}
          />
          <div className="text-sm text-gray-600">
            <strong>Clearinghouse Consent:</strong> I consent to the prospective employer conducting a query of the FMCSA Drug and Alcohol Clearinghouse to determine whether drug or alcohol violation information about me exists.
          </div>
        </label>
      </div>

      {/* Signature */}
      <div className="bg-gray-50 border border-gray-300 rounded-xl p-6">
        <label className="block text-sm font-bold text-gray-700 mb-2 flex items-center gap-2">
          <PenTool size={16} /> Digital Signature <span className="text-red-500">*</span>
        </label>
        <input 
          type="text" 
          className="w-full p-4 border-2 border-gray-300 rounded-lg text-lg font-serif italic text-blue-900 focus:border-blue-500 outline-none placeholder:font-sans placeholder:not-italic placeholder:text-sm"
          placeholder="Type your full legal name to sign"
          value={data.signatureName || ''}
          onChange={handleSignatureChange}
        />
        <p className="text-xs text-gray-500 mt-2 flex items-center gap-1">
          <AlertCircle size={12} /> By typing your name, you agree this is legally equivalent to a handwritten signature.
        </p>
        {data['signature-date'] && (
          <p className="text-xs text-gray-400 mt-1">Signed on: {data['signature-date']}</p>
        )}
      </div>

    </div>
  );
}
