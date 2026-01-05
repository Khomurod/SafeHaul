import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { db, functions, auth } from '@lib/firebase';
import { collection, query, where, getDocs, orderBy } from 'firebase/firestore';
import { Briefcase, Search, Loader2 } from 'lucide-react';
import { submitApplication } from '../../applications/services/applicationService';
import { JobOfferCard } from './dashboard/JobOfferCard';
import { DriverApplicationWizard } from './application/DriverApplicationWizard';

export default function JobBoard() {
    const [jobs, setJobs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedJob, setSelectedJob] = useState(null);
    const [applied, setApplied] = useState({}); // Map of jobId -> boolean
    const [filter, setFilter] = useState({
        type: 'all', // all, local, regional, otr
        freight: 'all',
        minPay: 0,
        positionType: 'all' // companyDriver, ownerOperator, leaseOperator
    });

    useEffect(() => {
        const fetchJobs = async () => {
            try {
                const q = query(
                    collection(db, 'job_posts'),
                    where('status', '==', 'active'),
                    orderBy('createdAt', 'desc')
                );

                const snapshot = await getDocs(q);
                const loadedJobs = snapshot.docs.map(doc => ({
                    id: doc.id,
                    ...doc.data()
                }));

                setJobs(loadedJobs);
            } catch (error) {
                console.error("Error fetching jobs:", error);
            } finally {
                setLoading(false);
            }
        };

        fetchJobs();
    }, []);

    useEffect(() => {
        const checkApplied = async () => {
            const currentUser = auth.currentUser;
            if (!currentUser) return;

            try {
                // If we want to check applications across all companies, we'd normally use a collectionGroup query.
                // For now, we'll just track it via the successful submission in this session
                // or assume the user will see their applied status next time they load if we add the logic.
                // NOTE: For simplicity, we'll just handle the session state for now or add a more robust check if needed.
            } catch (error) {
                console.error("Error checking applications:", error);
            }
        };

        checkApplied();
    }, []);

    const handleApplySuccess = (jobId) => {
        setApplied(prev => ({ ...prev, [jobId]: true }));
        setSelectedJob(null);
    };

    const handleApply = (job) => {
        const currentUser = auth.currentUser;
        if (!currentUser) {
            alert("Please log in to apply.");
            return;
        }
        setSelectedJob(job);
    };

    // --- Filtering Logic ---
    const filteredJobs = jobs.filter(job => {
        if (filter.type !== 'all' && job.routeType !== filter.type) return false;
        if (filter.freight !== 'all' && !job.freightTypes?.includes(filter.freight)) return false;
        if (filter.positionType !== 'all' && job.positionType !== filter.positionType) return false;
        if (filter.minPay > 0 && (job.estimatedWeeklyPay || 0) < filter.minPay) return false;
        return true;
    });

    return (
        <div className="min-h-screen bg-gray-50 pb-10">
            {/* Header */}
            <div className="bg-white border-b border-gray-200 shadow-sm sticky top-0 z-10">
                <div className="max-w-6xl mx-auto px-6 py-4 flex justify-between items-center">
                    <div className="flex items-center gap-3">
                        <div className="bg-blue-100 p-2 rounded-lg text-blue-600">
                            <Briefcase size={24} />
                        </div>
                        <h1 className="text-xl font-bold text-gray-900">Job Board</h1>
                    </div>
                    <Link to="/driver/dashboard" className="text-sm font-medium text-gray-500 hover:text-gray-900">
                        Back to Dashboard
                    </Link>
                </div>
            </div>

            <main className="max-w-6xl mx-auto px-6 py-8">
                {/* Filters */}
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200 mb-8 grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div className="space-y-1">
                        <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">Route Type</label>
                        <select
                            value={filter.type}
                            onChange={(e) => setFilter(prev => ({ ...prev, type: e.target.value }))}
                            className="w-full p-2.5 rounded-lg border border-gray-200 text-sm font-medium focus:ring-2 focus:ring-blue-500 outline-none"
                        >
                            <option value="all">All Routes</option>
                            <option value="local">Local</option>
                            <option value="regional">Regional</option>
                            <option value="otr">OTR</option>
                        </select>
                    </div>

                    <div className="space-y-1">
                        <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">Freight Type</label>
                        <select
                            value={filter.freight}
                            onChange={(e) => setFilter(prev => ({ ...prev, freight: e.target.value }))}
                            className="w-full p-2.5 rounded-lg border border-gray-200 text-sm font-medium focus:ring-2 focus:ring-blue-500 outline-none"
                        >
                            <option value="all">All Freight</option>
                            <option value="dryVan">Dry Van</option>
                            <option value="reefer">Reefer</option>
                            <option value="flatbed">Flatbed</option>
                            <option value="tanker">Tanker</option>
                        </select>
                    </div>

                    <div className="space-y-1">
                        <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">Position Type</label>
                        <select
                            value={filter.positionType}
                            onChange={(e) => setFilter(prev => ({ ...prev, positionType: e.target.value }))}
                            className="w-full p-2.5 rounded-lg border border-gray-200 text-sm font-medium focus:ring-2 focus:ring-blue-500 outline-none"
                        >
                            <option value="all">All Positions</option>
                            <option value="companyDriver">Company Driver</option>
                            <option value="ownerOperator">Owner Operator</option>
                            <option value="leaseOperator">Lease Operator</option>
                        </select>
                    </div>

                    <div className="space-y-1">
                        <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">Min Weekly Pay</label>
                        <select
                            value={filter.minPay}
                            onChange={(e) => setFilter(prev => ({ ...prev, minPay: Number(e.target.value) }))}
                            className="w-full p-2.5 rounded-lg border border-gray-200 text-sm font-medium focus:ring-2 focus:ring-blue-500 outline-none"
                        >
                            <option value="0">Any Pay</option>
                            <option value="1500">$1,500+</option>
                            <option value="2000">$2,000+</option>
                            <option value="2500">$2,500+</option>
                            <option value="3000">$3,000+</option>
                        </select>
                    </div>
                </div>

                {loading ? (
                    <div className="grid grid-cols-1 gap-6">
                        {[1, 2, 3].map(i => (
                            <div key={i} className="bg-white rounded-xl h-48 animate-pulse shadow-sm border border-gray-100"></div>
                        ))}
                    </div>
                ) : filteredJobs.length === 0 ? (
                    <div className="text-center py-20 bg-white rounded-xl shadow-sm border border-gray-200">
                        <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4 text-gray-400">
                            <Briefcase size={32} />
                        </div>
                        <h3 className="text-lg font-bold text-gray-900">No open positions found</h3>
                        <p className="text-gray-500">Check back later or try updating your search.</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 gap-6">
                        {filteredJobs.map(job => (
                            <JobOfferCard
                                key={job.id}
                                job={job}
                                isApplied={applied[job.id]}
                                onApply={() => handleApply(job)}
                            />
                        ))}
                    </div>
                )}
            </main>

            {/* Modal Wizard */}
            {selectedJob && (
                <DriverApplicationWizard
                    isOpen={!!selectedJob}
                    onClose={() => setSelectedJob(null)}
                    onSuccess={handleApplySuccess}
                    job={selectedJob}
                    companyId={selectedJob.companyId}
                />
            )}
        </div>
    );
}
