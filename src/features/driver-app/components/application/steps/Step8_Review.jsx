import React from 'react';
import { 
  User, MapPin, Truck, Briefcase, FileCheck, 
  AlertCircle, IdCard, ShieldCheck, Beaker
} from 'lucide-react';

const ReviewSection = ({ title, icon: Icon, onEdit, children }) => (
    <div className="border border-gray-300 rounded-lg p-4 space-y-2 mt-6">
        <div className="flex justify-between items-center pb-2 border-b border-gray-100">
            <h4 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
                {Icon && <Icon size={18} className="text-blue-600" />}
                {title}
            </h4>
            <button 
                type="button" 
                onClick={onEdit} 
                className="text-blue-600 text-sm font-medium hover:underline"
            >
                Edit
            </button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
            {children}
        </div>
    </div>
);

const ReviewItem = ({ label, value, className = "" }) => {
    // If value is empty/null, don't render the row at all to keep review clean
    if (!value) return null;

    return (
        <div className={`flex flex-col ${className}`}>
            <span className="text-sm font-medium text-gray-500">{label}</span>
            <span className="text-sm text-gray-800 break-words whitespace-pre-wrap">{value}</span>
        </div>
    );
};

const Step8_Review = ({ formData, onNavigate }) => {

    // Map step numbers to your navigation logic
    // 0=Contact, 1=Address, 2=License, 3=Violations, 4=Accidents, 5=Employment, 6=General
    const navigateToStep = (stepIndex) => {
        onNavigate(stepIndex); 
    };

    /**
     * Helper to format a list summary, showing the count and a snippet of the first few items.
     */
    const formatListSummary = (key, getSummary, maxItems = 2) => {
        const list = formData[key] || [];
        if (list.length === 0) return 'None recorded';

        const summaries = list.slice(0, maxItems).map(item => getSummary(item));
        let summaryText = summaries.join(', ');
        if (list.length > maxItems) {
            summaryText += `, and ${list.length - maxItems} more.`;
        }

        return `${list.length} recorded: ${summaryText}`;
    };

    // Specific formatting functions for dynamic lists
    const formatViolationSummary = (item) => `${item.charge} (${item.date})`;
    const formatAccidentSummary = (item) => `${item.city}, ${item.state} (${item.date})`;
    const formatEmployerSummary = (item) => item.name;
    const formatUnemploymentSummary = (item) => `${item.startDate} to ${item.endDate}`;

    // Helper for file fields
    const getFileName = (key) => {
        const fileData = formData[key];
        if (fileData && fileData.name) {
            return `File: ${fileData.name} (Uploaded)`;
        }
        if (fileData instanceof File) {
            return `File: ${fileData.name} (Pending Upload)`;
        }
        return null;
    };

    return (
        <div id="page-8" className="form-step space-y-6">
            <h3 className="text-xl font-semibold text-gray-800">Step 8 of 9: Review Information</h3>
            <p className="text-sm text-gray-600">Please take a moment to confirm that all of the information you have submitted is correct.</p>

            <div className="bg-green-50 border border-green-200 p-4 rounded-xl text-center">
                <h3 className="text-green-800 font-bold text-lg flex items-center justify-center gap-2">
                <FileCheck size={24} /> Ready to Submit?
                </h3>
                <p className="text-green-700 text-sm mt-1">
                Please verify all information is correct before signing.
                </p>
            </div>

            <ReviewSection title="Personal Information" icon={User} onEdit={() => navigateToStep(0)}>
                <ReviewItem label="Full Name" value={formData.firstName + ' ' + (formData.middleName || '') + ' ' + formData.lastName + ' ' + (formData.suffix || '')} />
                <ReviewItem label="Date of Birth" value={formData.dob} />
                <ReviewItem label="SSN" value={formData.ssn} />
                <ReviewItem label="Email" value={formData.email} />
                <ReviewItem label="Phone" value={formData.phone} />
                <ReviewItem label="Current Address" value={formData.street + ', ' + formData.city + ', ' + formData.state + ' ' + formData.zip} />
                <ReviewItem label="Previous Address" value={formData.prevStreet ? formData.prevStreet + ', ' + formData.prevCity + ', ' + formData.prevState + ' ' + formData.prevZip : null} />
                <ReviewItem label="Referral Source" value={formData.referralSource} />
            </ReviewSection>

            <ReviewSection title="Address History" icon={MapPin} onEdit={() => navigateToStep(1)}>
                <ReviewItem label="Current Address" value={`${formData.street || ''}, ${formData.city || ''}, ${formData.state || ''} ${formData.zip || ''}`} />
                <ReviewItem label="3+ Years Here" value={formData['residence-3-years'] === 'yes' ? 'Yes' : 'No'} />
                {formData['residence-3-years'] === 'no' && formData.prevStreet && (
                <ReviewItem label="Previous Address" value={`${formData.prevStreet}, ${formData.prevCity}, ${formData.prevState} ${formData.prevZip}`} />
                )}
            </ReviewSection>

            <ReviewSection title="General Qualifications" icon={ShieldCheck} onEdit={() => navigateToStep(1)}>
                <ReviewItem label="Legal to Work in U.S." value={formData['legal-work']} />
                <ReviewItem label="English Fluency" value={formData['english-fluency']} />
                <ReviewItem label="Driving Experience" value={formData['experience-years']} />
                <ReviewItem label="Drug Test History" value={formData['drug-test-positive']} />
                <ReviewItem label="DOT Return to Duty" value={formData['dot-return-to-duty']} />
            </ReviewSection>

            <ReviewSection title="License & Credentials" icon={IdCard} onEdit={() => navigateToStep(2)}>
                <ReviewItem label="License State/Class" value={formData.cdlState + ' (' + formData.cdlClass + ')'} />
                <ReviewItem label="License Number/Exp" value={formData.cdlNumber + ' / ' + formData.cdlExpiration} />
                <ReviewItem label="Endorsements" value={formData.endorsements || 'None'} />
                <ReviewItem label="TWIC Card" value={formData['has-twic']} />
                {formData['has-twic'] === 'yes' && <ReviewItem label="TWIC Expiration" value={formData.twicExpiration} />}

                {/* Uploads */}
                <ReviewItem label="TWIC Upload" value={getFileName('twic-card-upload')} />
                <ReviewItem label="CDL Front Upload" value={getFileName('cdl-front')} />
                <ReviewItem label="CDL Back Upload" value={getFileName('cdl-back')} />
                <ReviewItem label="Medical Card Upload" value={getFileName('medical-card-upload')} />
            </ReviewSection>

             <ReviewSection title="Driving History" icon={AlertCircle} onEdit={() => navigateToStep(3)}>
                <ReviewItem label="Revoked Licenses" value={formData['revoked-licenses']} />
                <ReviewItem label="Driving Convictions" value={formData['driving-convictions']} />
                <ReviewItem label="Drug/Alcohol Convictions" value={formData['drug-alcohol-convictions']} />
                <ReviewItem label="MVR Consent Form" value={getFileName('mvr-consent-upload')} />
                <ReviewItem label="Moving Violations (3 yrs)" value={formatListSummary('violations', formatViolationSummary)} />
            </ReviewSection>

            <ReviewSection title="Accident History" icon={Truck} onEdit={() => navigateToStep(4)}>
                <ReviewItem label="Accidents (3 yrs)" value={formatListSummary('accidents', formatAccidentSummary)} />
            </ReviewSection>

            <ReviewSection title="Work History" icon={Briefcase} onEdit={() => navigateToStep(5)}>
                <ReviewItem label="Employers Listed" value={formatListSummary('employers', formatEmployerSummary)} />
                <ReviewItem label="Gaps Explained" value={formatListSummary('unemployment', formatUnemploymentSummary)} />
                <ReviewItem label="Driving Schools" value={formatListSummary('schools', (item) => item.name)} />
                <ReviewItem label="Military Service" value={formatListSummary('military', (item) => item.branch)} />
            </ReviewSection>

            <ReviewSection title="Custom Questions & HOS" icon={Beaker} onEdit={() => navigateToStep(6)}>
                {/* --- Dynamic Custom Questions Display --- */}
                {formData.customAnswers && Object.keys(formData.customAnswers).length > 0 && (
                    <div className="col-span-1 md:col-span-2 border-b border-gray-100 pb-4 mb-2">
                        <h5 className="font-bold text-gray-700 mb-3 text-sm uppercase tracking-wide">Carrier Specific Questions</h5>
                        <div className="grid grid-cols-1 gap-4">
                            {Object.entries(formData.customAnswers).map(([q, a], i) => (
                                <ReviewItem key={i} label={q} value={a && typeof a === 'object' ? JSON.stringify(a) : a} />
                            ))}
                        </div>
                    </div>
                )}

                <ReviewItem label="Business Name/EIN" value={(formData.businessName || 'N/A') + ' / ' + (formData.ein || 'N/A')} />
                <ReviewItem label="Straight Truck Exp" value={formData.expStraightTruckExp + ' (' + formData.expStraightTruckMiles + ' miles)'} />
                <ReviewItem label="Semi Trailer Exp" value={formData.expSemiTrailerExp + ' (' + formData.expSemiTrailerMiles + ' miles)'} />
                <ReviewItem label="Contact 1 Name/Phone" value={formData.ec1Name + ' / ' + formData.ec1Phone} />
                <ReviewItem label="HOS Day 1-7 (Hrs)" value={'HOS: ' + [formData.hosDay1, formData.hosDay2, formData.hosDay3, formData.hosDay4, formData.hosDay5, formData.hosDay6, formData.hosDay7].map(h => h || 0).join(', ')} />
                <ReviewItem label="Last Relieved Date/Time" value={(formData.lastRelievedDate || 'N/A') + ' at ' + (formData.lastRelievedTime || 'N/A')} />
                <ReviewItem label="Felony History" value={formData['has-felony']} />
            </ReviewSection>

            <div className="flex justify-between pt-6">
                <button 
                    type="button" 
                    onClick={() => onNavigate('back')}
                    className="w-auto px-6 py-3 bg-gray-600 text-white font-semibold rounded-lg shadow-md hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 transition duration-200"
                >
                    Back
                </button>
                <button 
                    type="button" 
                    onClick={() => onNavigate('next')}
                    className="w-auto px-6 py-3 bg-blue-600 text-white font-semibold rounded-lg shadow-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition duration-200"
                >
                    Confirm & Proceed
                </button>
            </div>
        </div>
    );
};

export default Step8_Review;