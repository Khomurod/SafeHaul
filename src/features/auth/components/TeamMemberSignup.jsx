import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { db, functions } from '@lib/firebase';
import { doc, getDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { UserPlus, Loader2, CheckCircle, AlertTriangle } from 'lucide-react';

export function TeamMemberSignup() {
  const { companyId } = useParams();
  const navigate = useNavigate();
  
  const [companyName, setCompanyName] = useState('');
  const [formData, setFormData] = useState({ fullName: '', email: '', password: '' });
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    const checkCompany = async () => {
        try {
            const docRef = doc(db, "companies", companyId);
            const snap = await getDoc(docRef);
            if (snap.exists()) {
                setCompanyName(snap.data().companyName);
            } else {
                setError("Invalid Invite Link. Company not found.");
            }
        } catch (e) {
            setError("Error loading invite.");
        } finally {
            setLoading(false);
        }
    };
    checkCompany();
  }, [companyId]);

  const handleSubmit = async (e) => {
      e.preventDefault();
      setSubmitting(true);
      setError('');

      try {
          const joinFn = httpsCallable(functions, 'joinCompanyTeam');
          await joinFn({
              companyId: companyId,
              fullName: formData.fullName,
              email: formData.email,
              password: formData.password
          });

          setSuccess(true);
          setTimeout(() => navigate('/login'), 3000);

      } catch (err) {
          console.error(err);
          setError(err.message || "Failed to join team.");
      } finally {
          setSubmitting(false);
      }
  };

  if (loading) return <div className="h-screen flex items-center justify-center"><Loader2 className="animate-spin"/></div>;

  if (success) {
      return (
          <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
              <div className="bg-white p-8 rounded-xl shadow-lg max-w-md w-full text-center">
                  <div className="w-16 h-16 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-4">
                      <CheckCircle size={40}/>
                  </div>
                  <h2 className="text-2xl font-bold text-gray-800">Welcome Aboard!</h2>
                  <p className="text-gray-600 mt-2">You have successfully joined the <strong>{companyName}</strong> team.</p>
                  <p className="text-sm text-gray-500 mt-4">Redirecting to login...</p>
              </div>
          </div>
      );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4">
        <div className="bg-white p-8 rounded-xl shadow-xl max-w-md w-full border border-gray-200">
            <div className="text-center mb-8">
                <div className="inline-block p-3 bg-blue-100 text-blue-600 rounded-full mb-4">
                    <UserPlus size={32} />
                </div>
                <h1 className="text-2xl font-bold text-gray-900">Join {companyName}</h1>
                <p className="text-gray-500 mt-1">Create your recruiter account below.</p>
            </div>

            {error && (
                <div className="mb-6 p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg flex items-center gap-2">
                    <AlertTriangle size={16}/> {error}
                </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Full Name</label>
                    <input 
                        required
                        className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                        placeholder="John Doe"
                        value={formData.fullName}
                        onChange={e => setFormData({...formData, fullName: e.target.value})}
                    />
                </div>
                <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Work Email</label>
                    <input 
                        required
                        type="email"
                        className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                        placeholder="john@company.com"
                        value={formData.email}
                        onChange={e => setFormData({...formData, email: e.target.value})}
                    />
                </div>
                <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Password</label>
                    <input 
                        required
                        type="password"
                        className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                        placeholder="••••••••"
                        value={formData.password}
                        onChange={e => setFormData({...formData, password: e.target.value})}
                    />
                </div>

                <button 
                    type="submit" 
                    disabled={submitting}
                    className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg transition-all shadow-md flex justify-center items-center gap-2 disabled:opacity-50"
                >
                    {submitting ? <Loader2 className="animate-spin"/> : "Create Account & Join"}
                </button>
            </form>
        </div>
    </div>
  );
}
