import React from 'react';
import { HelpCircle, AlertTriangle, FileSignature, AlertCircle, School, Flag, Truck } from 'lucide-react';
import { Section } from '../ApplicationUI';
import { getFieldValue } from '@shared/utils/helpers';

export function SupplementalSection({ appData }) {

  // Helper to render empty states
  const renderEmpty = (text) => <p className="text-gray-400 italic text-sm">{text}</p>;

  if (!appData) return null;

  return (
    <div className="space-y-6">

      {/* --- CUSTOM QUESTIONS --- */}
      {appData.customAnswers && Object.keys(appData.customAnswers).length > 0 && (
         <Section title="Supplemental Questions">
             <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {Object.entries(appData.customAnswers).map(([question, answer], i) => (
                      <div key={i} className="p-3 bg-blue-50 rounded-lg border border-blue-100">
                          <p className="text-xs font-bold text-blue-700 uppercase mb-1 flex items-center gap-1">
                              <HelpCircle size={12}/> {question}
                          </p>
                          <p className="text-sm text-gray-900 font-medium break-words">
                              {Array.isArray(answer) ? answer.join(', ') : (String(answer) || 'N/A')}
                          </p>
                      </div>
                  ))}
              </div>
          </Section>
      )}

      {/* --- DRIVING HISTORY (Violations & Accidents) --- */}
      <Section title="Driving Record (Past 3 Years)">
          <div className="space-y-6">

              {/* Violations */}
              <div>
                  <h4 className="text-sm font-bold text-gray-700 mb-3 flex items-center gap-2">
                      <AlertCircle size={16} className="text-orange-500"/> Traffic Convictions / Violations
                  </h4>
                  {appData.violations && appData.violations.length > 0 ? (
                      <div className="grid grid-cols-1 gap-3">
                          {appData.violations.map((v, i) => (
                              <div key={i} className="bg-gray-50 p-3 rounded border border-gray-200 text-sm">
                                  <div className="flex justify-between font-semibold text-gray-900">
                                      <span>{v.charge || 'Unknown Charge'}</span>
                                      <span>{v.date}</span>
                                  </div>
                                  <div className="text-gray-600 mt-1">
                                      {v.location} &bull; Penalty: {v.penalty || 'N/A'}
                                  </div>
                              </div>
                          ))}
                      </div>
                  ) : renderEmpty("No violations listed.")}
              </div>

              {/* Accidents */}
              <div className="pt-4 border-t border-gray-100">
                  <h4 className="text-sm font-bold text-gray-700 mb-3 flex items-center gap-2">
                      <AlertTriangle size={16} className="text-red-500"/> Accident History
                  </h4>
                  {appData.accidents && appData.accidents.length > 0 ? (
                      <div className="grid grid-cols-1 gap-3">
                          {appData.accidents.map((a, i) => (
                              <div key={i} className="bg-gray-50 p-3 rounded border border-gray-200 text-sm">
                                  <div className="flex justify-between font-semibold text-gray-900">
                                      <span>{a.date}</span>
                                      <span>{a.city}, {a.state}</span>
                                  </div>
                                  <p className="text-gray-700 mt-1 italic">"{a.details}"</p>
                                  <div className="flex gap-2 mt-2">
                                      {a.commercial === 'yes' && <span className="text-[10px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded font-bold uppercase">CMV</span>}
                                      {a.preventable === 'yes' && <span className="text-[10px] bg-red-100 text-red-700 px-2 py-0.5 rounded font-bold uppercase">Preventable</span>}
                                  </div>
                              </div>
                          ))}
                      </div>
                  ) : renderEmpty("No accidents listed.")}
              </div>
          </div>
      </Section>

      {/* --- EMPLOYMENT HISTORY --- */}
      <Section title="Employment History">
          {appData.employers && appData.employers.length > 0 ? (
              <div className="space-y-4">
                  {appData.employers.map((emp, index) => (
                      <div key={index} className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-2">
                              <h4 className="font-bold text-gray-900 flex items-center gap-2">
                                  <Truck size={16} className="text-gray-400"/> {emp.name}
                              </h4>
                              <span className="text-xs font-semibold text-gray-500 bg-white px-2 py-1 border rounded mt-1 sm:mt-0">
                                  {emp.dates}
                              </span>
                          </div>
                          <div className="text-sm text-gray-600 grid grid-cols-1 sm:grid-cols-2 gap-2">
                              <p><span className="font-medium">Location:</span> {emp.city}, {emp.state}</p>
                              <p><span className="font-medium">Position:</span> {emp.position}</p>
                              <p className="sm:col-span-2"><span className="font-medium">Reason for Leaving:</span> {emp.reason}</p>
                              {emp.phone && <p className="sm:col-span-2"><span className="font-medium">Contact:</span> {emp.phone}</p>}
                          </div>
                      </div>
                  ))}
              </div>
          ) : renderEmpty("No employment history provided.")}

          {/* Unemployment Gaps */}
          {appData.unemployment && appData.unemployment.length > 0 && (
              <div className="mt-4 pt-4 border-t border-gray-100">
                  <h4 className="text-sm font-bold text-gray-700 mb-2">Employment Gaps</h4>
                  {appData.unemployment.map((gap, i) => (
                      <div key={i} className="text-sm text-gray-600 mb-1 pl-2 border-l-2 border-gray-300">
                          <span className="font-medium text-gray-900">{gap.startDate} - {gap.endDate}:</span> {gap.details}
                      </div>
                  ))}
              </div>
          )}
      </Section>

      {/* --- EDUCATION & MILITARY --- */}
      {(appData.schools?.length > 0 || appData.military?.length > 0) && (
        <Section title="Education & Military">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

                {/* Schools */}
                {appData.schools?.length > 0 && (
                    <div>
                        <h4 className="text-sm font-bold text-gray-700 mb-3 flex items-center gap-2">
                            <School size={16} className="text-blue-500"/> Driving Schools
                        </h4>
                        {appData.schools.map((s, i) => (
                            <div key={i} className="mb-2 p-2 bg-gray-50 rounded border border-gray-100 text-sm">
                                <p className="font-bold text-gray-900">{s.name}</p>
                                <p className="text-gray-600 text-xs">{s.location} &bull; {s.dates}</p>
                            </div>
                        ))}
                    </div>
                )}

                {/* Military */}
                {appData.military?.length > 0 && (
                    <div>
                        <h4 className="text-sm font-bold text-gray-700 mb-3 flex items-center gap-2">
                            <Flag size={16} className="text-blue-900"/> Military Service
                        </h4>
                        {appData.military.map((m, i) => (
                            <div key={i} className="mb-2 p-2 bg-gray-50 rounded border border-gray-100 text-sm">
                                <p className="font-bold text-gray-900">{m.branch} ({m.rank})</p>
                                <p className="text-gray-600 text-xs">{m.start} - {m.end}</p>
                                <p className="text-gray-500 text-xs mt-1">Discharge: {m.honorable === 'yes' ? 'Honorable' : 'Other'}</p>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </Section>
      )}

      {/* --- SIGNATURE --- */}
      <Section title="Digital Signature & Consent">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div>
                  <h4 className="text-sm font-bold text-gray-500 uppercase mb-3">Signature</h4>

                  {appData.signature && appData.signature.startsWith('TEXT_SIGNATURE:') ? (
                      <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg inline-block min-w-[200px]">
                          <p className="font-serif text-2xl italic text-blue-900 transform -rotate-2">
                             {appData.signature.replace('TEXT_SIGNATURE:', '')}
                          </p>
                          <p className="text-[10px] text-gray-400 mt-2 uppercase tracking-wider text-center border-t border-gray-300 pt-1">
                              Electronically Signed
                          </p>
                      </div>
                  ) : appData.signature ? (
                      <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg inline-block">
                          <img src={appData.signature} alt="Applicant Signature" className="max-h-24 object-contain mix-blend-multiply" />
                      </div>
                  ) : (
                      <div className="p-4 bg-yellow-50 border border-yellow-200 text-yellow-700 rounded-lg flex items-center gap-2">
                          <AlertTriangle size={18}/> No digital signature on file.
                      </div>
                  )}

                  <div className="mt-2 text-sm text-gray-500 flex items-center gap-2">
                      <FileSignature size={16}/> Signed on: <span className="font-medium text-gray-800">{appData['signature-date'] || 'Unknown Date'}</span>
                  </div>
              </div>
          </div>
      </Section>
    </div>
  );
}