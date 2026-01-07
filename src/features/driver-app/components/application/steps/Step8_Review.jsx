import React from 'react';
import { 
  User, MapPin, Truck, Briefcase, FileCheck, 
  AlertCircle, IdCard, ShieldCheck, Beaker, Edit2,
  Calendar, CheckCircle2
} from 'lucide-react';

const ReviewSection = ({ title, icon: Icon, onEdit, children }) => (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-shadow duration-200 mb-6">
        <div className="bg-gray-50 px-5 py-3 border-b border-gray-200 flex justify-between items-center">
            <h4 className="text-base font-bold text-gray-800 flex items-center gap-2">
                {Icon && <Icon size={18} className="text-blue-600" />}
                {title}
            </h4>
            <button 
                type="button" 
                onClick={onEdit} 
                className="flex items-center gap-1 text-gray-500 hover:text-blue-600 hover:bg-white px-3 py-1.5 rounded-lg border border-transparent hover:border-gray-200 transition-all text-xs font-bold uppercase tracking-wide"
                title={`Edit ${title}`}
            >
                <Edit2 size={14} /> Edit
            </button>
        </div>
        <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-y-4 gap-x-8">
            {children}
        </div>
    </div>
);

const ReviewItem = ({ label, value, className = "", fullWidth = false }) => {
    if (value === null || value === undefined || value === "") return null;

    return (
        <div className={`flex flex-col ${fullWidth ? 'col-span-1 md:col-span-2' : ''} ${className}`}>
            <span className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-0.5">{label}</span>
            <span className="text-sm text-gray-900 font-medium break-words whitespace-pre-wrap">{value}</span>
        </div>
    );
};

const ReviewList = ({ items, renderItem, emptyText = "None recorded" }) => {
    if (!items || items.length === 0) {
        return <p className="text-sm text-gray-400 italic col-span-2">{emptyText}</p>;
    }
    return (
        <div className="col-span-2 space-y-2">
            {items.map((item, index) => (
                <div key={index} className="bg-gray-50 p-3 rounded border border-gray-100 text-sm text-gray-700">
                    {renderItem(item, index)}
                </div>
            ))}
        </div>
    );
};

const Step8_Review = ({ formData, onNavigate }) => {

    // Corrected Mapping for Navigation (0-based index)
    // 0: Contact (Personal + Address)
    // 1: Qualifications
    // 2: License
    // 3: Violations
    // 4: Accidents
    // 5: Employment
    // 6: General / HOS
    const navigateToStep = (stepIndex) => {
        onNavigate(stepIndex); 
    };

    // Helper to nicely format file names
    const getFileName = (key) => {
        const fileData = formData[key];
        if (fileData && fileData.name) return `📄 ${fileData.name} (Uploaded)`;
        return null;
    };

    return (
        <div id="page-8" className="form-step space-y-8 animate-in fade-in duration-500">
            <div>
                <h3 className="text-2xl font-bold text-gray-900">Review & Confirm</h3>
                <p className="text-gray-500 mt-1">Please ensure all details are accurate before signing.</p>
            </div>

            <div className="bg-green-50 border border-green-200 p-4 rounded-xl flex items-start gap-3">
                <CheckCircle2 className="text-green-600 mt-0.5" size={24} />
                <div>
                    <h3 className="text-green-800 font-bold">Almost Done!</h3>
                    <p className="text-green-700 text-sm mt-1">
                        Review your application below. If you need to make changes, tap the <strong>Edit</strong> button on any section.
                    </p>
                </div>
            </div>

            <ReviewSection title="Personal Information" icon={User} onEdit={() => navigateToStep(0)}>
                <ReviewItem label="Full Name" value={`${formData.firstName} ${formData.middleName || ''} ${formData.lastName} ${formData.suffix || ''}`} />
                <ReviewItem label="Date of Birth" value={formData.dob} />
                <ReviewItem label="SSN" value={formData.ssn} />
                <ReviewItem label="Phone" value={formData.phone} />
                <ReviewItem label="Email" value={formData.email} />
                <ReviewItem label="Referral Source" value={formData.referralSource} />
                {formData['known-by-other-name'] === 'yes' && (
                    <ReviewItem label="Other Names" value={formData.otherName} fullWidth />
                )}
            </ReviewSection>

            <ReviewSection title="Address History" icon={MapPin} onEdit={() => navigateToStep(0)}>
                <ReviewItem label="Current Address" value={`${formData.street || ''}, ${formData.city || ''}, ${formData.state || ''} ${formData.zip || ''}`} fullWidth />
                <ReviewItem label="3+ Years at Current?" value={formData['residence-3-years'] === 'yes' ? 'Yes' : 'No'} />

                {formData['residence-3-years'] === 'no' && (
                    <ReviewItem 
                        label="Previous Address" 
                        value={`${formData.prevStreet}, ${formData.prevCity}, ${formData.prevState} ${formData.prevZip}`} 
                        fullWidth 
                        className="mt-2 pt-2 border-t border-gray-100"
                    />
                )}
            </ReviewSection>

            <ReviewSection title="Qualifications" icon={ShieldCheck} onEdit={() => navigateToStep(1)}>
                <ReviewItem label="Legal to Work in U.S." value={formData['legal-work'] === 'yes' ? 'Yes' : 'No'} />
                <ReviewItem label="English Fluency" value={formData['english-fluency'] === 'yes' ? 'Fluent' : 'Not Fluent'} />
                <ReviewItem label="Commercial Experience" value={formData['experience-years']} />
                <ReviewItem label="Drug Test History" value={formData['drug-test-positive'] === 'yes' ? 'Positive/Refusal Record' : 'No Issues'} />
                <ReviewItem label="Return to Duty" value={formData['dot-return-to-duty']} />
            </ReviewSection>

            <ReviewSection title="License & Credentials" icon={IdCard} onEdit={() => navigateToStep(2)}>
                <ReviewItem label="License Number" value={formData.cdlNumber} />
                <ReviewItem label="State & Class" value={`${formData.cdlState} (Class ${formData.cdlClass})`} />
                <ReviewItem label="Expiration Date" value={formData.cdlExpiration} />
                <ReviewItem label="Endorsements" value={formData.endorsements || 'None'} fullWidth />

                <div className="col-span-2 border-t border-gray-100 mt-2 pt-2 grid grid-cols-1 md:grid-cols-2 gap-4">
                    <ReviewItem label="TWIC Card" value={formData['has-twic'] === 'yes' ? `Yes (Exp: ${formData.twicExpiration})` : 'No'} />
                </div>

                <div className="col-span-2 border-t border-gray-100 mt-2 pt-2">
                    <span className="text-xs font-bold text-gray-400 uppercase tracking-wider block mb-2">Uploaded Documents</span>
                    <div className="flex flex-wrap gap-2">
                        {[
                            getFileName('cdl-front'),
                            getFileName('cdl-back'),
                            getFileName('medical-card-upload'),
                            getFileName('twic-card-upload')
                        ].map((file, i) => file && (
                            <span key={i} className="bg-blue-50 text-blue-700 px-2 py-1 rounded text-xs font-medium border border-blue-100">
                                {file}
                            </span>
                        ))}
                    </div>
                </div>
            </ReviewSection>

             <ReviewSection title="Driving History" icon={AlertCircle} onEdit={() => navigateToStep(3)}>
                <div className="col-span-2 grid grid-cols-2 gap-4 mb-4">
                    <ReviewItem label="License Revoked?" value={formData['revoked-licenses'] === 'yes' ? 'YES' : 'No'} />
                    <ReviewItem label="Suspended Convictions?" value={formData['driving-convictions'] === 'yes' ? 'YES' : 'No'} />
                    <ReviewItem label="Drug/Alcohol Issues?" value={formData['drug-alcohol-convictions'] === 'yes' ? 'YES' : 'No'} />
                </div>

                <div className="col-span-2">
                    <span className="text-xs font-bold text-gray-400 uppercase tracking-wider block mb-2">Moving Violations (3 Years)</span>
                    <ReviewList 
                        items={formData.violations} 
                        renderItem={(v) => (
                            <div className="flex justify-between">
                                <span className="font-bold">{v.charge}</span>
                                <span className="text-gray-500">{v.date} ({v.location})</span>
                            </div>
                        )}
                    />
                </div>
            </ReviewSection>

            <ReviewSection title="Accident History" icon={Truck} onEdit={() => navigateToStep(4)}>
                <div className="col-span-2">
                    <ReviewList 
                        items={formData.accidents} 
                        renderItem={(a) => (
                            <div>
                                <div className="flex justify-between font-bold">
                                    <span>{a.city}, {a.state}</span>
                                    <span>{a.date}</span>
                                </div>
                                <p className="text-gray-600 mt-1">{a.details}</p>
                                <div className="mt-1 text-xs text-gray-500">
                                    Preventable: {a.preventable} | Commercial: {a.commercial}
                                </div>
                            </div>
                        )}
                        emptyText="No accidents listed in the past 3 years."
                    />
                </div>
            </ReviewSection>

            <ReviewSection title="Work History" icon={Briefcase} onEdit={() => navigateToStep(5)}>
                <div className="col-span-2 space-y-4">
                    <div>
                        <span className="text-xs font-bold text-gray-400 uppercase tracking-wider block mb-2">Employers</span>
                        <ReviewList 
                            items={formData.employers} 
                            renderItem={(e) => (
                                <div>
                                    <div className="flex justify-between font-bold text-gray-900">
                                        <span>{e.name}</span>
                                        <span className="text-xs bg-gray-200 px-2 py-0.5 rounded">{e.dates}</span>
                                    </div>
                                    <p className="text-gray-600">{e.position}</p>
                                </div>
                            )} 
                        />
                    </div>

                    {formData.unemployment && formData.unemployment.length > 0 && (
                        <div className="pt-2 border-t border-gray-100">
                            <span className="text-xs font-bold text-gray-400 uppercase tracking-wider block mb-2">Unemployment Gaps</span>
                            <ReviewList 
                                items={formData.unemployment} 
                                renderItem={(u) => (
                                    <span>{u.startDate} - {u.endDate}: {u.details}</span>
                                )} 
                            />
                        </div>
                    )}
                </div>
            </ReviewSection>

            <ReviewSection title="Operations & Compliance" icon={Beaker} onEdit={() => navigateToStep(6)}>
                {formData.businessName && (
                    <div className="col-span-2 bg-gray-50 p-3 rounded mb-2 border border-gray-200">
                        <ReviewItem label="Owner Operator Info" value={`${formData.businessName} (EIN: ${formData.ein})`} fullWidth />
                    </div>
                )}

                <ReviewItem label="Straight Truck Exp" value={`${formData.expStraightTruckExp} yrs`} />
                <ReviewItem label="Semi-Trailer Exp" value={`${formData.expSemiTrailerExp} yrs`} />

                <ReviewItem label="Emergency Contact" value={`${formData.ec1Name} (${formData.ec1Relationship}) - ${formData.ec1Phone}`} fullWidth />

                <div className="col-span-2 pt-2 mt-2 border-t border-gray-100">
                    <ReviewItem label="HOS (Last 7 Days)" value={[1,2,3,4,5,6,7].map(d => formData['hosDay'+d] || 0).join(' + ')} fullWidth />
                    <div className="grid grid-cols-2 gap-4 mt-2">
                        <ReviewItem label="Last Relieved Date" value={formData.lastRelievedDate} />
                        <ReviewItem label="Last Relieved Time" value={formData.lastRelievedTime} />
                    </div>
                </div>

                <div className="col-span-2 pt-2 mt-2 border-t border-gray-100">
                    <ReviewItem 
                        label="Felony History" 
                        value={formData['has-felony'] === 'yes' ? `YES - ${formData.felonyExplanation}` : 'No Felony Convictions'} 
                        className={formData['has-felony'] === 'yes' ? 'text-red-600 font-bold' : ''}
                        fullWidth
                    />
                </div>
            </ReviewSection>

            <div className="flex justify-between pt-6 pb-12">
                <button 
                    type="button" 
                    onClick={() => onNavigate('back')}
                    className="w-auto px-6 py-3 bg-white text-gray-700 font-bold rounded-lg shadow-sm border border-gray-300 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 transition duration-200"
                >
                    Back
                </button>
                <button 
                    type="button" 
                    onClick={() => onNavigate('next')}
                    className="w-auto px-8 py-3 bg-green-600 text-white font-bold rounded-lg shadow-md hover:bg-green-700 hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 transition duration-200 flex items-center gap-2"
                >
                    Confirm & Proceed <FileCheck size={18} />
                </button>
            </div>
        </div>
    );
};

export default Step8_Review;