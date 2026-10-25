import React from 'react';
import { ShieldCheck, AlertCircle, glyphComponent } from '@design-system/icons';
import { getFieldValue } from '@shared/utils/helpers';
import { RELEASE_NOTES, RELEASE_PARAGRAPHS, RELEASE_RIGHTS, releaseOf, signedDayOf } from '@shared/legal/previousEmployerRelease';

/*
 * THE ONE FILE IN THE APPLICATION THAT OPENS GLYPH TOKENS BY HAND, and it is
 * `VOEPreviewModal.export.test.jsx` that requires it.
 *
 * That guard asserts the exported document carries **no `ds-*` class anywhere**,
 * because its class list is the capture surface for a rasteriser and a themeable
 * role must never reach a signed regulatory artefact. The contract's `Icon`
 * stamps `ds-icon` on everything it renders, so it cannot be used inside this
 * document — and a token throws if rendered directly, by construction.
 *
 * `glyphComponent` is the contract's own documented opener, so this file stays ON
 * the contract: it imports from `@design-system/icons` like every other file,
 * the lint rule is satisfied, and the exception is three named calls in
 * one place rather than a `lucide-react` import nobody would question. The pixel
 * sizes below are print dimensions frozen with the rest of the document, not
 * steps on any scale — 400 for the watermark is two orders of magnitude past
 * where the scale stops.
 */
const PrintShieldCheck = glyphComponent(ShieldCheck);
const PrintAlertCircle = glyphComponent(AlertCircle);

const utcDay = (date) => date.toLocaleDateString('en-US', { timeZone: 'UTC', month: '2-digit', day: '2-digit', year: 'numeric' });

/**
 * The day the applicant signed. The wizard stamps `signatureDate`, an ISO time,
 * and `signatureDay`, the signer's own calendar day (`Step9_Consent.jsx`), which
 * `signedDayOf` prints; an application from before `signatureDay` is dated by
 * its instant in UTC, as the server's request PDF does, so every printout of one
 * application carries the same date. Older applications carry the form
 * builder's `signature-date`, printed as written when it reads as a date;
 * failing both, the instant the release check dated the signature by
 * (`signedAt`, its submission). With none, the document says so: printing
 * today's date would certify an authorization that has no date.
 */
function authorizationDate(applicant, signedAt) {
    const stamped = applicant.signatureDate ? new Date(applicant.signatureDate) : null;
    if (stamped && !Number.isNaN(stamped.getTime())) {
        const [year, month, day] = signedDayOf(applicant).iso.split('-');
        return `${month}/${day}/${year}`;
    }
    const legacy = applicant['signature-date'];
    if (legacy && !Number.isNaN(Date.parse(String(legacy)))) return legacy;
    return Number.isFinite(signedAt) ? utcDay(new Date(signedAt)) : 'Not signed';
}

/**
 * The generated 49 CFR §391.23 verification document, extracted verbatim from
 * `VOEPreviewModal.jsx` — see that file's header for the full scope-of-
 * migration note and the frozen contracts.
 *
 * This subtree is **deliberately NOT tokenised**. It is immutable document
 * content, not themeable app chrome, and two export paths depend on its
 * literal styling: `handleDownloadPDF` rasterises it with html2canvas, and
 * `handlePrint` clones it into a bare `window.open` document.
 * `VOEPreviewModal.export.test.jsx` enforces this: the subtree must contain
 * no `ds-*` class and no `var(--ds-…)` value. Do not "finish the migration"
 * by tokenising it without first proving export parity. Its colours, type
 * sizes, radii, shadow and watermark layer are the frozen `voe-*` values in
 * `tailwind.config.js` (`VOE_PRINT`), which the strict theme keeps.
 *
 * `documentRef` arrives as a prop because the modal's print and PDF handlers
 * own the node: they clone and rasterise exactly what this component renders.
 */
export function VOEDocument({ employer, applicant, companyName, auditId, signatureUrl, signatureText, employerRelease = null, documentRef }) {
    // The signature appears only under the release its signer was shown: the
    // wording the consent step presented, word for word (`previousEmployerRelease.js`).
    const release = releaseOf(applicant);
    const signed = release.status === 'signed';
    const releaseNote = signed ? null : RELEASE_NOTES[release.status];
    // The release naming this employer, accepted with this signature
    // (`useEmployerRelease`), in place of the certification's: its document and
    // its one statement for this employer, as frozen.
    const named = signed && employerRelease ? employerRelease : null;
    // A signature the release check does not accept (a link, a blank typed name)
    // is not reproduced; with none at all, the recruiter is told to get one.
    const signatureMissing = !signatureUrl && !signatureText;
    return (
        <div ref={documentRef} data-testid="voe-document" className="bg-voe-white border border-voe-gray-300 shadow-voe-xl p-12 max-w-3xl mx-auto min-h-[1000px] font-serif text-voe-slate-900 leading-relaxed">

            {/* Official Document Header */}
            <div className="flex justify-between items-start mb-12 border-b-2 border-voe-slate-900 pb-8">
                <div className="text-left">
                    <h1 className="text-voe-2xl font-black uppercase tracking-tighter mb-1">SAFEHAUL</h1>
                    <p className="text-voe-xs font-bold uppercase tracking-widest text-voe-slate-500">Compliance & Verification Services</p>
                    <p className="text-[10px] text-voe-slate-500 mt-2 font-sans italic">Generated on {new Date().toLocaleDateString()} at {new Date().toLocaleTimeString()}</p>
                </div>
                <div className="text-right">
                    <h2 className="text-voe-xl font-bold uppercase tracking-widest border-2 border-voe-slate-900 px-4 py-2">VOE-391.23</h2>
                </div>
            </div>

            {/* Title Section */}
            <div className="text-center mb-10">
                <h3 className="text-voe-xl font-bold uppercase underline decoration-2 underline-offset-8">Request for Verification of Employment</h3>
                <p className="text-voe-xs font-bold mt-4 text-voe-slate-600 font-sans px-8 py-2 bg-voe-slate-50 border border-voe-slate-100 rounded-voe">
                    This request is made pursuant to the Federal Motor Carrier Safety Regulations (FMCSR) 49 CFR Part 391.23.
                    This regulation requires prospective employers to investigate a driver's background through the driver's previous employers.
                </p>
            </div>

            {/* Section 1: Parties */}
            <div className="grid grid-cols-2 gap-12 mb-10 font-sans">
                <div>
                    <h4 className="text-[10px] font-black uppercase text-voe-blue-600 border-b-2 border-voe-blue-500 mb-3 tracking-widest">To (Previous Employer)</h4>
                    <div className="text-voe-sm font-bold uppercase space-y-1">
                        <p className="text-voe-lg">{getFieldValue(employer.companyName || employer.name)}</p>
                        <p className="text-voe-slate-600 font-medium">{getFieldValue(employer.city)}, {getFieldValue(employer.state)}</p>
                        {employer.email && <p className="text-voe-blue-600 normal-case">{employer.email}</p>}
                        {employer.phone && <p className="text-voe-slate-500">{employer.phone}</p>}
                    </div>
                </div>
                <div>
                    <h4 className="text-[10px] font-black uppercase text-voe-slate-500 border-b-2 border-voe-slate-400 mb-3 tracking-widest">From (Prospective Employer)</h4>
                    <div className="text-voe-sm font-bold uppercase space-y-1">
                        <p className="text-voe-lg">{companyName}</p>
                        <p className="text-voe-slate-600 font-medium">SafeHaul Network Member</p>
                        <p className="text-voe-slate-500 normal-case italic">Verified Business Entity</p>
                    </div>
                </div>
            </div>

            {/* Section 2: Subject */}
            <div className="mb-10 font-sans bg-voe-slate-50 p-6 border border-voe-slate-200">
                <h4 className="text-[10px] font-black uppercase text-voe-slate-700 mb-4 tracking-widest">Subject Applicant Information</h4>
                <div className="grid grid-cols-2 gap-x-8 gap-y-4 text-voe-sm font-bold">
                    <div className="border-b border-voe-slate-200 pb-1">
                        <span className="text-[10px] uppercase text-voe-slate-500 block mb-0.5">Full Name</span>
                        {getFieldValue(applicant.firstName)} {getFieldValue(applicant.lastName)}
                    </div>
                    <div className="border-b border-voe-slate-200 pb-1">
                        <span className="text-[10px] uppercase text-voe-slate-500 block mb-0.5">Social Security Number</span>
                        {applicant.ssn ? `***-**-${applicant.ssn.slice(-4)}` : 'REDACTED (ON FILE)'}
                    </div>
                    <div className="border-b border-voe-slate-200 pb-1">
                        <span className="text-[10px] uppercase text-voe-slate-500 block mb-0.5">Date of Birth</span>
                        {applicant.dob || 'NOT DISCLOSED'}
                    </div>
                    <div className="border-b border-voe-slate-200 pb-1">
                        <span className="text-[10px] uppercase text-voe-slate-500 block mb-0.5">Reported Service Dates</span>
                        {getFieldValue(employer.startDate)} to {getFieldValue(employer.endDate)}
                    </div>
                </div>
            </div>

            {/* Section 3: Authorization (Signature Box) */}
            <div className="mb-12 border-2 border-voe-slate-900 p-8 relative overflow-hidden bg-voe-slate-50/30">
                {/* Watermark */}
                {/* 400px is a print dimension, not a step — see `PrintShieldCheck` above. */}
                <div className="absolute inset-0 flex items-center justify-center opacity-[0.03] pointer-events-none rotate-12 z-voe-watermark">
                    <PrintShieldCheck size={400} />
                </div>

                <div className="flex items-center gap-3 mb-6">
                    <div className="p-2 bg-voe-blue-600 text-voe-white rounded-voe-lg">
                        <PrintShieldCheck size={20} />
                    </div>
                    <h4 className="text-voe-xl font-bold uppercase underline decoration-voe-blue-600 decoration-4 underline-offset-4">{named ? "Applicant's Authorization (Signed With the Application)" : "Applicant's Release (Signed With the Application)"}</h4>
                </div>

                {named ? (
                    <div data-testid="voe-employer-release" className="text-[13px] mb-10 leading-relaxed text-voe-slate-800 font-medium border-l-4 border-voe-blue-500 pl-6 py-2">
                        {[...named.body.split('\n\n'), named.statement].map((paragraph) => (
                            <p key={paragraph} className="mb-3 whitespace-pre-line">{paragraph}</p>
                        ))}
                    </div>
                ) : releaseNote ? (
                    <p data-testid="voe-release-note" className="text-[13px] mb-10 leading-relaxed text-voe-slate-800 font-medium border-l-4 border-voe-blue-500 pl-6 py-2">
                        {releaseNote}
                    </p>
                ) : (
                    <div className="text-[13px] text-justify mb-10 leading-relaxed text-voe-slate-800 font-medium border-l-4 border-voe-blue-500 pl-6 py-2">
                        {RELEASE_PARAGRAPHS.map((paragraph) => <p key={paragraph} className="mb-3">{paragraph}</p>)}
                        <ul className="list-disc pl-6">
                            {RELEASE_RIGHTS.map((right) => <li key={right}>{right}</li>)}
                        </ul>
                    </div>
                )}

                <div className="flex justify-between items-end gap-12 font-sans">
                    <div className="flex-1">
                        <p className="text-[10px] font-black text-voe-slate-500 uppercase mb-3 tracking-widest">Digital Signature of Applicant</p>
                        <div className={`h-24 border-b-2 flex items-center justify-center pb-2 px-6 ${signatureMissing ? 'border-voe-red-400 bg-voe-red-50' : 'border-voe-slate-900'}`}>
                            {!signed && !signatureMissing ? (
                                <span className="text-voe-slate-500 text-voe-xs font-bold uppercase tracking-tighter">No signature reproduced</span>
                            ) : signed && signatureUrl ? (
                                <img src={signatureUrl} alt="Signature" className="h-20 object-contain" />
                            ) : signed && signatureText ? (
                                <span className="font-serif italic text-voe-4xl text-voe-slate-900">/s/ {signatureText}</span>
                            ) : (
                                <div className="text-center">
                                    <PrintAlertCircle size={24} className="mx-auto text-voe-red-500 mb-2" />
                                    <span className="text-voe-red-600 text-voe-xs font-bold block uppercase tracking-tighter">DRIVER SIGNATURE MISSING</span>
                                    <span className="text-[10px] text-voe-red-600">Application must be signed before transmission</span>
                                </div>
                            )}
                        </div>
                        {signed && <p className="text-[9px] text-voe-slate-500 mt-3 uppercase tracking-tighter">Signed electronically with the application{applicant.ipAddress && <> &bull; IP: {applicant.ipAddress}</>}</p>}
                    </div>
                    <div className="w-56">
                        <p className="text-[10px] font-black text-voe-slate-500 uppercase mb-3 tracking-widest text-right">Date of Authorization</p>
                        <div className="h-24 border-b-2 border-voe-slate-900 flex items-center justify-end pb-2">
                            <div className="text-right">
                                <span className="text-voe-2xl font-bold text-voe-slate-900">{release.status === 'unsigned' ? 'Not signed' : authorizationDate(applicant, release.signedAt)}</span>
                                <p className="text-[10px] text-voe-slate-500 mt-1 uppercase">Valid for 30 Days</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Questionnaire Section */}
            {/* Labels inside this faded block are text-voe-slate-700, two steps darker than the
                text-voe-slate-500 the rest of the form uses, because the block renders at 80%
                opacity: slate-500 blends to 3.25:1 here and slate-700 to 5.74:1. WCAG 2.2 SC
                1.4.3 (AA, 4.5:1) has no exemption for legal small print. */}
            <div className="opacity-80 pointer-events-none grayscale border-t-2 border-dashed border-voe-slate-300 pt-8 mt-12 bg-voe-slate-50/20 p-8 rounded-voe-xl">
                <h4 className="text-[11px] font-black uppercase text-voe-slate-800 mb-8 tracking-widest text-center border-b border-voe-slate-200 pb-2">Employment History Questionnaire (To be completed by Recipient)</h4>

                <div className="space-y-8 font-sans">
                    {/* Row 1: Basic Verification */}
                    <div className="grid grid-cols-2 gap-x-12 gap-y-6">
                        <div className="flex justify-between items-center border-b border-voe-slate-200 pb-2">
                            <span className="text-voe-xs font-bold text-voe-slate-700">Did this person work for you?</span>
                            <div className="flex gap-4">
                                <div className="flex items-center gap-1.5">
                                    <div className="w-4 h-4 border border-voe-slate-400 rounded-voe-sm"></div>
                                    <span className="text-[10px] font-bold text-voe-slate-700">YES</span>
                                </div>
                                <div className="flex items-center gap-1.5">
                                    <div className="w-4 h-4 border border-voe-slate-400 rounded-voe-sm"></div>
                                    <span className="text-[10px] font-bold text-voe-slate-700">NO</span>
                                </div>
                            </div>
                        </div>

                        <div className="flex flex-col border-b border-voe-slate-200 pb-2">
                            <div className="flex justify-between items-center w-full">
                                <span className="text-voe-xs font-bold text-voe-slate-700">Dates of employment correct?</span>
                                <div className="flex gap-4">
                                    <div className="flex items-center gap-1.5">
                                        <div className="w-4 h-4 border border-voe-slate-400 rounded-voe-sm"></div>
                                        <span className="text-[10px] font-bold text-voe-slate-700">YES</span>
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                        <div className="w-4 h-4 border border-voe-slate-400 rounded-voe-sm"></div>
                                        <span className="text-[10px] font-bold text-voe-slate-700">NO</span>
                                    </div>
                                </div>
                            </div>
                            <div className="mt-2 flex items-end gap-2">
                                <span className="text-[9px] uppercase text-voe-slate-700 font-bold whitespace-nowrap">If no, explain:</span>
                                <div className="flex-1 border-b border-voe-slate-300 h-4"></div>
                            </div>
                        </div>

                        <div className="col-span-1 flex flex-col border-b border-voe-slate-200 pb-2">
                            <span className="text-voe-xs font-bold text-voe-slate-700">Type of equipment operated:</span>
                            <div className="mt-2 flex-1 border-b border-voe-slate-300 h-5"></div>
                        </div>

                        <div className="flex flex-col border-b border-voe-slate-200 pb-2">
                            <div className="flex justify-between items-center w-full">
                                <span className="text-voe-xs font-bold text-voe-slate-700">Eligible for re-hire?</span>
                                <div className="flex gap-4">
                                    <div className="flex items-center gap-1.5">
                                        <div className="w-4 h-4 border border-voe-slate-400 rounded-voe-sm"></div>
                                        <span className="text-[10px] font-bold text-voe-slate-700">YES</span>
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                        <div className="w-4 h-4 border border-voe-slate-400 rounded-voe-sm"></div>
                                        <span className="text-[10px] font-bold text-voe-slate-700">NO</span>
                                    </div>
                                </div>
                            </div>
                            <div className="mt-2 flex items-end gap-2">
                                <span className="text-[9px] uppercase text-voe-slate-700 font-bold whitespace-nowrap">If no, explain:</span>
                                <div className="flex-1 border-b border-voe-slate-300 h-4"></div>
                            </div>
                        </div>
                    </div>

                    {/* Row 2: Accident History */}
                    <div className="pt-4 border-t border-voe-slate-200">
                        <h5 className="text-[10px] font-black uppercase text-voe-slate-700 mb-4 tracking-widest">Safety Performance (Accidents)</h5>
                        <div className="flex flex-col border-b border-voe-slate-200 pb-3">
                            <div className="flex justify-between items-center w-full">
                                <span className="text-voe-xs font-bold text-voe-slate-700">Did the driver have any DOT-recordable accidents?</span>
                                <div className="flex gap-4">
                                    <div className="flex items-center gap-1.5">
                                        <div className="w-4 h-4 border border-voe-slate-400 rounded-voe-sm"></div>
                                        <span className="text-[10px] font-bold text-voe-slate-700">YES</span>
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                        <div className="w-4 h-4 border border-voe-slate-400 rounded-voe-sm"></div>
                                        <span className="text-[10px] font-bold text-voe-slate-700">NO</span>
                                    </div>
                                </div>
                            </div>
                            <div className="mt-3 flex items-end gap-2">
                                <span className="text-[9px] uppercase text-voe-slate-700 font-bold whitespace-nowrap">If yes, please provide dates and details:</span>
                                <div className="flex-1 border-b border-voe-slate-300 h-4"></div>
                            </div>
                            <div className="mt-4 border-b border-voe-slate-300 h-4"></div>
                        </div>
                    </div>

                    {/* Row 3: Drug & Alcohol */}
                    <div className="pt-4 border-t border-voe-slate-200">
                        <h5 className="text-[10px] font-black uppercase text-voe-slate-700 mb-4 tracking-widest">Drug & Alcohol Compliance (Part 40)</h5>
                        <div className="grid grid-cols-1 gap-6">
                            {[
                                "Did the driver refuse to take a required drug or alcohol test?",
                                "Did the driver have any other drug/alcohol regulation violations?",
                                "Did the driver test positive for a controlled substance?"
                            ].map((q, idx) => (
                                <div key={idx} className="flex flex-col border-b border-voe-slate-100 pb-3">
                                    <div className="flex justify-between items-center w-full">
                                        <span className="text-voe-xs font-bold text-voe-slate-700">{q}</span>
                                        <div className="flex gap-4">
                                            <div className="flex items-center gap-1.5">
                                                <div className="w-4 h-4 border border-voe-slate-400 rounded-voe-sm"></div>
                                                <span className="text-[10px] font-bold text-voe-slate-700">YES</span>
                                            </div>
                                            <div className="flex items-center gap-1.5">
                                                <div className="w-4 h-4 border border-voe-slate-400 rounded-voe-sm"></div>
                                                <span className="text-[10px] font-bold text-voe-slate-700">NO</span>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="mt-3 flex items-end gap-2">
                                        <span className="text-[9px] uppercase text-voe-slate-700 font-bold whitespace-nowrap">If yes, explain:</span>
                                        <div className="flex-1 border-b border-voe-slate-300 h-4"></div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            {/* Compliance Footer */}
            <div className="mt-20 border-t border-voe-slate-200 pt-4 text-center">
                <p className="text-[8px] text-voe-slate-500 font-sans uppercase tracking-[0.2em]">
                    Protected by SafeHaul Encryption Services &bull; Secure Audit ID: {auditId}
                </p>
            </div>

        </div>
    );
}
