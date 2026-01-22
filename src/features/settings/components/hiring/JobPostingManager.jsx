import React, { useState, useEffect } from 'react';
import {
    Plus, Edit2, Trash2, PauseCircle, PlayCircle,
    MoreVertical, Search, Briefcase
} from 'lucide-react';
import {
    collection, query, where, getDocs,
    addDoc, updateDoc, doc, deleteDoc, serverTimestamp
} from 'firebase/firestore';
import { db } from '@lib/firebase'; // Adjust path as needed
import { JobWizard } from './JobWizard';

export function JobPostingManager({ companyId, companyName, logoUrl }) {
    const [jobs, setJobs] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isWizardOpen, setIsWizardOpen] = useState(false);
    const [editingJob, setEditingJob] = useState(null);

    // --- Data Fetching ---
    const fetchJobs = async () => {
        if (!companyId) return;
        setIsLoading(true);
        try {
            const q = query(collection(db, 'job_posts'), where('companyId', '==', companyId));
            const snapshot = await getDocs(q);
            const loadedJobs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            // Client side sort by updated desc
            setJobs(loadedJobs.sort((a, b) => (b.updatedAt?.toMillis() || 0) - (a.updatedAt?.toMillis() || 0)));
        } catch (error) {
            console.error("Error fetching jobs:", error);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchJobs();
    }, [companyId]);

    // --- Actions ---
    const handleSaveJob = async (jobData) => {
        try {
            const payload = {
                ...jobData,
                companyId,
                companyName: companyName || 'Company',
                companyLogo: logoUrl || '',
                updatedAt: serverTimestamp()
            };

            if (editingJob) {
                await updateDoc(doc(db, 'job_posts', editingJob.id), payload);
            } else {
                payload.createdAt = serverTimestamp();
                await addDoc(collection(db, 'job_posts'), payload);
            }

            setIsWizardOpen(false);
            setEditingJob(null);
            fetchJobs(); // Refresh
        } catch (error) {
            console.error("Error saving job:", error);
            alert("Failed to save job post.");
        }
    };

    const handleToggleStatus = async (job) => {
        try {
            const newStatus = job.status === 'active' ? 'paused' : 'active';
            await updateDoc(doc(db, 'job_posts', job.id), {
                status: newStatus,
                updatedAt: serverTimestamp()
            });
            // Optimistic update
            setJobs(prev => prev.map(j => j.id === job.id ? { ...j, status: newStatus } : j));
        } catch (error) {
            console.error("Error updating status:", error);
        }
    };

    const handleDeleteJob = async (jobId) => {
        if (!confirm("Are you sure you want to delete this job post?")) return;
        try {
            await deleteDoc(doc(db, 'job_posts', jobId));
            setJobs(prev => prev.filter(j => j.id !== jobId));
        } catch (error) {
            console.error("Error deleting job:", error);
        }
    };

    const openEdit = (job) => {
        setEditingJob(job);
        setIsWizardOpen(true);
    };

    const openNew = () => {
        setEditingJob(null);
        setIsWizardOpen(true);
    };

    // --- Render ---

    if (isLoading) return <div className="p-10 text-center text-gray-500">Loading job posts...</div>;

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                    <h2 className="text-2xl font-bold text-gray-900">Internal Job Board</h2>
                    <p className="text-gray-500">Manage your active job listings visible to drivers on the SafeHaul network.</p>
                </div>
                <button
                    onClick={openNew}
                    className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg shadow-sm flex items-center gap-2 transition-colors"
                >
                    <Plus size={20} />
                    Post New Job
                </button>
            </div>

            {/* Content */}
            {jobs.length === 0 ? (
                <div className="text-center py-20 bg-gray-50 rounded-2xl border border-dashed border-gray-300">
                    <div className="w-16 h-16 bg-blue-100/50 text-blue-500 rounded-full flex items-center justify-center mx-auto mb-4">
                        <Briefcase size={32} />
                    </div>
                    <h3 className="text-lg font-bold text-gray-900 mb-2">No Active Job Posts</h3>
                    <p className="text-gray-500 max-w-md mx-auto mb-6">Create your first job post to start accepting applications from qualified drivers.</p>
                    <button
                        onClick={openNew}
                        className="px-6 py-2.5 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 font-bold rounded-lg shadow-sm transition-colors"
                    >
                        Create Job Post
                    </button>
                </div>
            ) : (
                <div className="grid grid-cols-1 gap-4">
                    {jobs.map(job => (
                        <div key={job.id} className="bg-white border border-gray-200 rounded-xl p-5 flex flex-col md:flex-row gap-6 items-start md:items-center hover:border-blue-300 transition-colors group relative">

                            {/* Status Indicator */}
                            <div className={`absolute left-0 top-0 bottom-0 w-1.5 rounded-l-xl ${job.status === 'active' ? 'bg-emerald-500' : 'bg-gray-300'}`} />

                            <div className="flex-1 pl-2">
                                <div className="flex items-center gap-2 mb-1">
                                    <h3 className="text-lg font-bold text-gray-900">{job.title}</h3>
                                    <span className={`px-2 py-0.5 text-[10px] font-bold uppercase rounded-full tracking-wider ${job.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'
                                        }`}>
                                        {job.status}
                                    </span>
                                </div>
                                <div className="flex items-center gap-4 text-sm text-gray-500">
                                    <span className="capitalize">{job.positionType?.replace(/([A-Z])/g, ' $1').trim()} • {job.teamMode}</span>
                                    <span>•</span>
                                    <span className="capitalize">{job.routeType}</span>
                                    <span>•</span>
                                    <span className="font-medium text-gray-700">
                                        ${job.estimatedWeeklyPay?.toLocaleString()}/wk
                                    </span>
                                </div>
                            </div>

                            {/* Actions */}
                            <div className="flex items-center gap-2 self-end md:self-center">
                                <button
                                    onClick={() => handleToggleStatus(job)}
                                    className={`p-2 rounded-lg transition-colors flex items-center gap-2 text-sm font-semibold ${job.status === 'active'
                                        ? 'text-amber-600 hover:bg-amber-50'
                                        : 'text-emerald-600 hover:bg-emerald-50'
                                        }`}
                                >
                                    {job.status === 'active' ? (
                                        <><PauseCircle size={18} /> Pause</>
                                    ) : (
                                        <><PlayCircle size={18} /> Activate</>
                                    )}
                                </button>
                                <div className="h-6 w-px bg-gray-200 mx-1"></div>
                                <button
                                    onClick={() => openEdit(job)}
                                    className="p-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                                    title="Edit"
                                >
                                    <Edit2 size={18} />
                                </button>
                                <button
                                    onClick={() => handleDeleteJob(job.id)}
                                    className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                    title="Delete"
                                >
                                    <Trash2 size={18} />
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Wizard Modal */}
            <JobWizard
                isOpen={isWizardOpen}
                onClose={() => setIsWizardOpen(false)}
                onSave={handleSaveJob}
                initialData={editingJob}
            />
        </div>
    );
}
