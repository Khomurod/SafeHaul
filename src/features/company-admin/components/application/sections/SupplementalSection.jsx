import React from 'react';
import { HelpCircle, AlertTriangle, FileSignature, AlertCircle, School, Flag, Truck, Phone, Gavel, HeartPulse, CheckCircle2, ShieldAlert, BadgeCheck } from 'lucide-react';
import { Section } from '../ApplicationUI';
import { getFieldValue } from '@shared/utils/helpers';

export function SupplementalSection({ appData }) {

    const renderEmpty = (text) => <p className="text-gray-400 italic text-sm">{text}</p>;
    const formatPhone = (phone) => phone ? phone.replace(/(\d{3})(\d{3})(\d{4})/, '($1) $2-$3') : 'N/A';

    if (!appData) return null;

    const hasFelony = appData['has-felony'] === 'yes';
    const hasRevoked = appData['revoked-licenses'] === 'yes';
    const hasSuspended = appData['driving-convictions'] === 'yes';
    const hasDrugConviction = appData['drug-alcohol-convictions'] === 'yes';

    return (
        <div className="space-y-6">

            {/* --- 1. CRITICAL SAFETY DECLARATIONS --- */}
            <Section title="Safety & Background Declarations">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

                    {/* Declarations Card */}
                    <div className="bg-white p-4 rounded-lg border border-gray-200 shadow-sm space-y-3">
                        <h4 className="text-xs font-bold text-gray-500 uppercase flex items-center gap-2">
                            <ShieldAlert size={14} /> Legal Questions
                        </h4>

                        <div className="flex justify-between items-center text-sm border-b border-gray-100 pb-2">
                            <span className="text-gray-700">License ever revoked/suspended?</span>
                            <span className={`font-bold px-2 py-0.5 rounded ${hasRevoked ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'}`}>
                                {hasRevoked ? 'YES' : 'NO'}
                            </span>
                        </div>

                        <div className="flex justify-between items-center text-sm border-b border-gray-100 pb-2">
                            <span className="text-gray-700">Convicted driving while suspended?</span>
                            <span className={`font-bold px-2 py-0.5 rounded ${hasSuspended ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'}`}>
                                {hasSuspended ? 'YES' : 'NO'}
                            </span>
                        </div>

                        <div className="flex justify-between items-center text-sm">
                            <span className="text-gray-700">Drug/Alcohol Convictions?</span>
                            <span className={`font-bold px-2 py-0.5 rounded ${hasDrugConviction ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'}`}>
                                {hasDrugConviction ? 'YES' : 'NO'}
                            </span>
                        </div>
                    </div>

                    {/* Felony & Criminal */}
                    <div className={`p-4 rounded-lg border ${hasFelony ? 'bg-red-50 border-red-200' : 'bg-white border-gray-200'}`}>
                        <h4 className="text-xs font-bold text-gray-500 uppercase flex items-center gap-2 mb-3">
                            <Gavel size={14} /> Criminal History
                        </h4>
                        <div className="flex items-center gap-2 mb-2">
                            {hasFelony ? <AlertTriangle size={18} className="text-red-600" /> : <CheckCircle2 size={18} className="text-green-600" />}
                            <span className={`font-bold ${hasFelony ? 'text-red-800' : 'text-green-800'}`}>
                                {hasFelony ? 'Felony Conviction Reported' : 'No Felony Convictions'}
                            </span>
                        </div>
                        {hasFelony && (
                            <p className="text-sm text-red-700 mt-2 bg-white p-2 rounded border border-red-100 italic">
                                "{appData.felonyExplanation}"
                            </p>
                        )}
                    </div>
                </div>
            </Section>

            {/* --- 2. CREDENTIALS & EXPERIENCE --- */}
            <Section title="Credentials & Vehicle Experience">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

                    {/* TWIC & Business */}
                    <div className="space-y-4">
                        <div className="bg-blue-50 p-3 rounded border border-blue-100 flex justify-between items-center">
                            <div className="flex items-center gap-2">
                                <BadgeCheck size={18} className="text-blue-600" />
                                <span className="text-sm font-bold text-blue-900">TWIC Card</span>
                            </div>
                            <span className="text-sm font-medium text-blue-800">
                                {appData['has-twic'] === 'yes' ? `Exp: ${appData.twicExpiration || 'N/A'}` : 'Not Held'}
                            </span>
                        </div>

                        {appData.businessName && (
                            <div className="bg-gray-50 p-3 rounded border border-gray-200">
                                <p className="text-xs font-bold text-gray-500 uppercase">Owner Operator Info</p>
                                <p className="font-bold text-gray-900">{appData.businessName}</p>
                                <p className="text-sm text-gray-600">EIN: {appData.ein || 'N/A'}</p>
                            </div>
                        )}
                    </div>

                    {/* Equipment Experience */}
                    <div className="bg-gray-50 p-3 rounded border border-gray-200">
                        <h4 className="text-xs font-bold text-gray-500 uppercase mb-3 flex items-center gap-2">
                            <Truck size={14} /> Driving Experience
                        </h4>
                        <div className="space-y-2 text-sm">
                            <div className="flex justify-between">
                                <span className="text-gray-600">Straight Truck:</span>
                                <span className="font-medium text-gray-900">{appData.expStraightTruckExp || '0'} yrs ({appData.expStraightTruckMiles || '0'} miles)</span>
                            </div>
                            <div className="flex justify-between border-t border-gray-200 pt-2">
                                <span className="text-gray-600">Semi-Trailer:</span>
                                <span className="font-medium text-gray-900">{appData.expSemiTrailerExp || '0'} yrs ({appData.expSemiTrailerMiles || '0'} miles)</span>
                            </div>
                        </div>
                    </div>
                </div>
            </Section>

            {/* --- 3. DRIVING RECORD (Violations & Accidents) --- */}
            <Section title="Driving Record (Past 3 Years)">
                <div className="space-y-6">
                    {/* Violations */}
                    <div>
                        <h4 className="text-sm font-bold text-gray-700 mb-3 flex items-center gap-2">
                            <AlertCircle size={16} className="text-orange-500" /> Traffic Convictions / Violations
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
                        ) : (
                            <div className="flex items-center gap-2 text-green-700 bg-green-50 p-3 rounded border border-green-100">
                                <CheckCircle2 size={18} />
                                <span className="text-sm font-medium">Clean Driving Record (No violations listed)</span>
                            </div>
                        )}
                    </div>

                    {/* Accidents */}
                    <div className="pt-4 border-t border-gray-100">
                        <h4 className="text-sm font-bold text-gray-700 mb-3 flex items-center gap-2">
                            <AlertTriangle size={16} className="text-red-500" /> Accident History
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
                        ) : (
                            <div className="flex items-center gap-2 text-green-700 bg-green-50 p-3 rounded border border-green-100">
                                <CheckCircle2 size={18} />
                                <span className="text-sm font-medium">No Accidents Reported</span>
                            </div>
                        )}
                    </div>
                </div>
            </Section>

            {/* --- 4. EMPLOYMENT HISTORY --- */}
            <Section title="Employment History">
                {appData.employers && appData.employers.length > 0 ? (
                    <div className="space-y-4">
                        {appData.employers.map((emp, index) => (
                            <div key={index} className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-2">
                                    <h4 className="font-bold text-gray-900 flex items-center gap-2">
                                        <Truck size={16} className="text-gray-400" /> {emp.name}
                                    </h4>
                                    <span className="text-xs font-semibold text-gray-500 bg-white px-2 py-1 border rounded mt-1 sm:mt-0">
                                        {emp.dates}
                                    </span>
                                </div>
                                <div className="text-sm text-gray-600 grid grid-cols-1 sm:grid-cols-2 gap-2">
                                    <p><span className="font-medium">Location:</span> {emp.city}, {emp.state}</p>
                                    <p><span className="font-medium">Position:</span> {emp.position}</p>
                                    <p className="sm:col-span-2"><span className="font-medium">Reason for Leaving:</span> {emp.reason}</p>
                                    {emp.phone && <p className="sm:col-span-2"><span className="font-medium">Contact:</span> {formatPhone(emp.phone)}</p>}
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

            {/* --- 5. CUSTOM QUESTIONS & EMERGENCY --- */}
            <Section title="Supplemental Info">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

                    {/* Emergency Contacts */}
                    <div>
                        <h4 className="text-sm font-bold text-gray-700 mb-3 flex items-center gap-2">
                            <HeartPulse size={16} className="text-red-500" /> Emergency Contacts
                        </h4>
                        <div className="space-y-3">
                            {appData.ec1Name ? (
                                <div className="bg-gray-50 p-3 rounded border border-gray-200 text-sm">
                                    <p className="font-bold text-gray-900">{appData.ec1Name}</p>
                                    <p className="text-gray-600">{appData.ec1Relationship}</p>
                                    <div className="flex items-center gap-1 mt-1 text-blue-600 font-medium">
                                        <Phone size={12} /> {formatPhone(appData.ec1Phone)}
                                    </div>
                                </div>
                            ) : <p className="text-sm text-gray-400 italic">Primary contact missing</p>}

                            {appData.ec2Name && (
                                <div className="bg-gray-50 p-3 rounded border border-gray-200 text-sm">
                                    <p className="font-bold text-gray-900">{appData.ec2Name}</p>
                                    <p className="text-gray-600">{appData.ec2Relationship}</p>
                                    <div className="flex items-center gap-1 mt-1 text-blue-600 font-medium">
                                        <Phone size={12} /> {formatPhone(appData.ec2Phone)}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Custom Questions */}
                    <div className="md:col-span-2">
                        <h4 className="text-sm font-bold text-gray-700 mb-3 flex items-center gap-2">
                            <HelpCircle size={16} className="text-blue-500" /> Custom Questions
                        </h4>
                        {appData.customAnswers && Object.keys(appData.customAnswers).length > 0 ? (
                            <div className="border border-gray-200 rounded-lg overflow-hidden">
                                {Object.entries(appData.customAnswers).map(([question, answer], i) => (
                                    <div key={i} className={`flex flex-col md:flex-row border-b border-gray-100 last:border-0 ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}>
                                        {/* Question Column */}
                                        <div className="p-3 md:w-[40%] text-xs font-bold text-gray-700 bg-gray-50/50 md:border-r border-gray-100 flex items-center">
                                            {question}
                                        </div>
                                        {/* Answer Column */}
                                        <div className="p-3 md:w-[60%] text-sm text-gray-900 font-medium">
                                            {Array.isArray(answer) ? answer.join(', ') : (String(answer) || 'N/A')}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : renderEmpty("No custom questions answered.")}
                    </div>
                </div>
            </Section>

            {/* HOS Section Removed - No longer collected in driver application (see Step7_General.jsx) */}

            {/* --- 7. EDUCATION & MILITARY --- */}
            {(appData.schools?.length > 0 || appData.military?.length > 0) && (
                <Section title="Education & Military">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {/* Schools */}
                        {appData.schools?.length > 0 && (
                            <div>
                                <h4 className="text-sm font-bold text-gray-700 mb-3 flex items-center gap-2">
                                    <School size={16} className="text-blue-500" /> Driving Schools
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
                                    <Flag size={16} className="text-blue-900" /> Military Service
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

            {/* --- 8. SIGNATURE --- */}
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
                                <AlertTriangle size={18} /> No digital signature on file.
                            </div>
                        )}

                        <div className="mt-2 text-sm text-gray-500 flex items-center gap-2">
                            <FileSignature size={16} /> Signed on: <span className="font-medium text-gray-800">{appData['signature-date'] || 'Unknown Date'}</span>
                        </div>
                    </div>
                </div>
            </Section>
        </div>
    );
}