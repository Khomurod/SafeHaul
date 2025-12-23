// src/features/auth/components/LoginScreen.jsx
import React, { useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { loginUser, resetPassword } from '../services/authService';
import { getPortalUser, getMembershipsForUser } from '../services/userService';
import { Mail, Lock, ArrowRight, Loader2, CheckCircle2, Users, Briefcase, ArrowLeft } from 'lucide-react';

const SafeHaulLogo = ({ className = "" }) => (
  <svg className={className} viewBox="0 0 150 128" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M84.5048 0H38.3646C35.6441 0 33.1101 1.38249 31.6377 3.67003L10.0621 37.1892C7.65527 40.9284 8.00677 45.8078 10.9247 49.1634L34.5051 76.2809C35.4547 77.373 36.831 78 38.2782 78H84.5043C85.3578 78 85.819 76.9996 85.2647 76.3506L60.1709 46.969C57.4395 43.7709 57.2872 39.1074 59.8042 35.7379L85.306 1.59845C85.7986 0.938977 85.328 0 84.5048 0Z" fill="url(#paint0_linear_login)"/>
    <path d="M76.26 51.5H115.994C118.229 51.5 120.362 52.4346 121.876 54.0776L143.684 77.7336C146.805 81.1193 147.211 86.1988 144.667 90.037L120.983 125.763C120.057 127.16 118.492 128 116.816 128H68.9479C68.5459 128 68.3082 127.549 68.5353 127.218L96.563 86.2541C98.8806 82.8668 98.613 78.3405 95.9123 75.2499L75.8835 52.329C75.6009 52.0056 75.8306 51.5 76.26 51.5Z" fill="#004C68"/>
    <path d="M145.426 0.0370348L97.1296 0.476095C95.4834 0.49106 93.9501 1.31535 93.0296 2.68018L67.603 40.3817C66.7071 41.7101 67.6589 43.5 69.2612 43.5H111.534C114.663 43.5 117.611 42.0361 119.501 39.5439L147.038 3.24572C148.042 1.92198 147.088 0.0219304 145.426 0.0370348Z" fill="#0BE2A4"/>
    <path d="M83.603 85.5H34.9709C33.4135 85.5 31.9451 86.2257 30.9991 87.4627L2.45845 124.785C1.45208 126.101 2.39046 128 4.04717 128H51.8679C55.0895 128 58.1139 126.448 59.9923 123.83L85.2279 88.6661C86.1775 87.3428 85.2318 85.5 83.603 85.5Z" fill="#004C68"/>
    <defs>
      <linearGradient id="paint0_linear_login" x1="42.5" y1="55" x2="83" y2="75.5" gradientUnits="userSpaceOnUse">
        <stop offset="0.283654" stopColor="#0CE1A5"/>
        <stop offset="0.913462" stopColor="#077B5A"/>
      </linearGradient>
    </defs>
  </svg>
);

export function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  // Forgot password state (separate from login state)
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetEmailSent, setResetEmailSent] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [resetError, setResetError] = useState('');

  const navigate = useNavigate();
  const location = useLocation();

  const openForgotPassword = () => {
    setResetEmail(email); // Pre-fill with login email if available
    setResetError('');
    setResetEmailSent(false);
    setShowForgotPassword(true);
  };

  const closeForgotPassword = () => {
    setShowForgotPassword(false);
    setResetEmail('');
    setResetError('');
    setResetEmailSent(false);
  };

  const handleForgotPassword = async (e) => {
    e.preventDefault();
    if (!resetEmail) {
      setResetError('Please enter your email address');
      return;
    }
    setResetError('');
    setResetLoading(true);
    try {
      await resetPassword(resetEmail);
      setResetEmailSent(true);
    } catch (err) {
      setResetError(err.message || 'Failed to send reset email');
    } finally {
      setResetLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    const from = location.state?.from;

    try {
      const user = await loginUser(email, password);

      if (from) {
        navigate(from, { replace: true });
        return;
      }

      // --- SMART REDIRECT LOGIC ---
      // Fetch user profile and memberships to decide where to go
      const [userDoc, membershipsSnap] = await Promise.all([
          getPortalUser(user.uid),
          getMembershipsForUser(user.uid)
      ]);

      // Check Super Admin via claims or role
      const token = await user.getIdTokenResult();
      const isSuperAdmin = token.claims.super_admin || userDoc?.role === 'super_admin';

      if (isSuperAdmin) {
          navigate('/super-admin', { replace: true });
          return;
      }

      // Check Roles
      const isDriver = userDoc?.role === 'driver';
      const hasCompanyAccess = !membershipsSnap.empty;

      if (isDriver && hasCompanyAccess) {
          // User is BOTH a driver and an employee -> Show Selection Screen
          navigate('/', { replace: true });
      } else if (hasCompanyAccess) {
          // User is ONLY an employee -> Go to Company Dashboard
          navigate('/company/dashboard', { replace: true });
      } else if (isDriver) {
          // User is ONLY a driver -> Go to Driver Dashboard
          navigate('/driver/dashboard', { replace: true });
      } else {
          // Fallback
          navigate('/', { replace: true });
      }

    } catch (err) {
      console.error("Auth error:", err);
      setError(err.message || 'Invalid email or password');
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex bg-slate-50">

      {/* Left Side - Login Form */}
      <div className="w-full lg:w-[45%] flex flex-col justify-center px-6 sm:px-12 lg:px-16 xl:px-24 bg-white">
        <div className="max-w-sm w-full mx-auto">

          <div className="mb-10">
            <div className="flex items-center gap-3 mb-8">
              <SafeHaulLogo className="w-10 h-10" />
              <span className="text-xl font-bold text-slate-900">SafeHaul</span>
            </div>

            <h1 className="text-2xl font-bold text-slate-900 mb-2">
              Sign in to your account
            </h1>
            <p className="text-slate-500 text-sm">
              Enter your credentials to access the portal
            </p>
          </div>

          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-100 rounded-lg">
              <p className="text-sm text-red-600 font-medium">{error}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-slate-700 mb-1.5">
                Email address
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                  <Mail size={18} className="text-slate-400" />
                </div>
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 placeholder-slate-400 focus:bg-white focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition-all"
                  placeholder="you@example.com"
                />
              </div>
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-slate-700 mb-1.5">
                Password
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                  <Lock size={18} className="text-slate-400" />
                </div>
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 placeholder-slate-400 focus:bg-white focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition-all"
                  placeholder="Enter your password"
                />
              </div>
              <div className="mt-2 text-right">
                <button 
                  type="button" 
                  className="text-sm text-blue-600 hover:text-blue-700 font-medium"
                  onClick={openForgotPassword}
                >
                  Forgot password?
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg shadow-sm transition-all flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {loading ? (
                <Loader2 size={20} className="animate-spin" />
              ) : (
                <>
                  Sign In
                  <ArrowRight size={18} />
                </>
              )}
            </button>
          </form>

          <div className="mt-8 pt-6 border-t border-slate-100">
            <p className="text-sm text-slate-500 text-center">
              Need an account?{' '}
              <Link to="/signup" className="text-blue-600 hover:text-blue-700 font-semibold">
                Contact your administrator
              </Link>
            </p>
          </div>

        </div>
      </div>

      {/* Right Side - Hero / Marketing */}
      {/* CHANGED: Background color to dark slate to avoid clashing with the Blue/Teal logo */}
      <div className="hidden lg:flex lg:w-[55%] bg-slate-900 relative overflow-hidden">

        {/* Background Effects */}
        <div className="absolute inset-0">
          <div className="absolute top-0 right-0 w-96 h-96 bg-[#0BE2A4]/10 rounded-full blur-3xl transform translate-x-1/2 -translate-y-1/2"></div>
          <div className="absolute bottom-0 left-0 w-80 h-80 bg-[#004C68]/20 rounded-full blur-3xl transform -translate-x-1/2 translate-y-1/2"></div>
          <div className="absolute top-1/2 left-1/2 w-64 h-64 bg-white/5 rounded-full blur-2xl transform -translate-x-1/2 -translate-y-1/2"></div>
        </div>

        <div className="relative z-10 flex flex-col justify-center items-center text-center px-12 lg:px-16 xl:px-20 w-full">
          <div className="max-w-lg">
            <SafeHaulLogo className="w-20 h-20 mx-auto mb-8" />

            <h2 className="text-3xl xl:text-4xl font-bold text-white mb-4 leading-tight">
              Your Gateway to the Road
            </h2>

            <p className="text-lg text-white/80 leading-relaxed mb-10">
              Whether you're a driver seeking your next opportunity or a company building your fleet, SafeHaul connects you to success.
            </p>

            <div className="space-y-4 text-left mb-10">
              <div className="flex items-start gap-4 bg-white/10 backdrop-blur-sm rounded-xl p-4 border border-white/10 hover:bg-white/15 transition-colors">
                <div className="w-10 h-10 bg-[#0BE2A4]/20 rounded-lg flex items-center justify-center shrink-0">
                  <Briefcase size={20} className="text-[#0BE2A4]" />
                </div>
                <div>
                  <h3 className="text-white font-semibold mb-1">For Drivers</h3>
                  <p className="text-white/70 text-sm">Apply to top carriers, track your applications, and find the perfect driving job that fits your lifestyle.</p>
                </div>
              </div>

              <div className="flex items-start gap-4 bg-white/10 backdrop-blur-sm rounded-xl p-4 border border-white/10 hover:bg-white/15 transition-colors">
                <div className="w-10 h-10 bg-[#0BE2A4]/20 rounded-lg flex items-center justify-center shrink-0">
                  <Users size={20} className="text-[#0BE2A4]" />
                </div>
                <div>
                  <h3 className="text-white font-semibold mb-1">For Companies</h3>
                  <p className="text-white/70 text-sm">Streamline recruitment, manage applications, and connect with qualified CDL drivers faster than ever.</p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="text-center">
                <div className="text-2xl xl:text-3xl font-bold text-[#0BE2A4] mb-1">10K+</div>
                <div className="text-sm text-white/60">Active Drivers</div>
              </div>
              <div className="text-center">
                {/* CHANGED: 500+ -> 10+ */}
                <div className="text-2xl xl:text-3xl font-bold text-[#0BE2A4] mb-1">10+</div>
                <div className="text-sm text-white/60">Partner Carriers</div>
              </div>
              <div className="text-center">
                <div className="text-2xl xl:text-3xl font-bold text-[#0BE2A4] mb-1">98%</div>
                <div className="text-sm text-white/60">Satisfaction Rate</div>
              </div>
            </div>

            <div className="mt-10 flex items-center justify-center gap-2 text-white/50 text-sm">
              <CheckCircle2 size={16} className="text-[#0BE2A4]" />
              <span>DOT Compliant</span>
              <span className="mx-2">|</span>
              <CheckCircle2 size={16} className="text-[#0BE2A4]" />
              <span>FMCSA Approved</span>
            </div>
          </div>
        </div>
      </div>

      {/* Forgot Password Modal */}
      {showForgotPassword && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-8 animate-in fade-in zoom-in-95 duration-200">
            {resetEmailSent ? (
              <div className="text-center">
                <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <CheckCircle2 size={32} className="text-green-600" />
                </div>
                <h3 className="text-xl font-bold text-slate-900 mb-2">Check your email</h3>
                <p className="text-slate-500 mb-6">
                  We've sent password reset instructions to <strong className="text-slate-700">{resetEmail}</strong>
                </p>
                <button
                  onClick={closeForgotPassword}
                  className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-all"
                >
                  Back to Sign In
                </button>
              </div>
            ) : (
              <>
                <button
                  onClick={closeForgotPassword}
                  className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 mb-4"
                >
                  <ArrowLeft size={16} /> Back to login
                </button>
                <h3 className="text-xl font-bold text-slate-900 mb-2">Reset your password</h3>
                <p className="text-slate-500 mb-6">
                  Enter your email address and we'll send you a link to reset your password.
                </p>

                {resetError && (
                  <div className="mb-4 p-3 bg-red-50 border border-red-100 rounded-lg">
                    <p className="text-sm text-red-600">{resetError}</p>
                  </div>
                )}

                <form onSubmit={handleForgotPassword}>
                  <div className="mb-4">
                    <label htmlFor="reset-email" className="block text-sm font-medium text-slate-700 mb-1.5">
                      Email address
                    </label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                        <Mail size={18} className="text-slate-400" />
                      </div>
                      <input
                        id="reset-email"
                        type="email"
                        value={resetEmail}
                        onChange={(e) => setResetEmail(e.target.value)}
                        className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 placeholder-slate-400 focus:bg-white focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition-all"
                        placeholder="you@example.com"
                        required
                      />
                    </div>
                  </div>
                  <button
                    type="submit"
                    disabled={resetLoading}
                    className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg shadow-sm transition-all flex items-center justify-center gap-2 disabled:opacity-60"
                  >
                    {resetLoading ? (
                      <Loader2 size={20} className="animate-spin" />
                    ) : (
                      'Send Reset Link'
                    )}
                  </button>
                </form>
              </>
            )}
          </div>
        </div>
      )}

    </div>
  );
}