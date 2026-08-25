// src/features/auth/components/LoginScreen.jsx
import React, { useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { loginUser, resetPassword } from '../services/authService';
import { getPortalUser, getMembershipsForUser } from '../services/userService';
import {
  ArrowRight,
  CheckCircle2,
  Users,
  Briefcase,
  ArrowLeft,
  Eye,
  EyeOff,
  AlertCircle,
} from 'lucide-react';

import { Logo } from '@shared/components/Logo';
import { Modal } from '@design-system/patterns';
import {
  Button,
  Card,
  FormField,
  IconButton,
  Input,
  Label,
} from '@/design-system/components';

// Stable id for the reset dialog's current heading. Only one heading is
// rendered at a time, so the id names whichever state (form or success) is
// visible and gives the shared Modal an accessible name via aria-labelledby.
const RESET_DIALOG_TITLE_ID = 'reset-password-dialog-title';

export function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Forgot password state (separate from login state)
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetEmailSent, setResetEmailSent] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [resetError, setResetError] = useState('');
  const resetEmailRef = useRef(null);

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

      // P2-3 FIX: Check Super Admin via claims (primary) with Firestore fallback
      const token = await user.getIdTokenResult();
      const isSuperAdmin = token.claims.super_admin === true || userDoc?.role === 'super_admin';

      if (isSuperAdmin) {
        navigate('/super-admin', { replace: true });
        return;
      }

      const hasCompanyAccess = !membershipsSnap.empty;

      if (hasCompanyAccess) {
        // Employee / recruiter / company admin -> Company workspace
        navigate('/company/dashboard', { replace: true });
      } else {
        // Fallback: let the root redirect resolve where to send them.
        navigate('/', { replace: true });
      }

    } catch (err) {
      console.error("Auth error:", err);
      setError(err.message || 'Invalid email or password');
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex bg-ds-canvas">

      {/* Left Side - Login Form */}
      <div className="w-full lg:w-[45%] flex flex-col justify-center px-6 sm:px-12 lg:px-16 xl:px-24 bg-ds-surface">
        <div className="max-w-sm w-full mx-auto">

          <div className="mb-10">
            <div className="flex items-center gap-3 mb-8">
              <Logo className="w-10 h-10" />
              <span className="text-ds-heading-lg font-bold text-ds-content">SafeHaul</span>
            </div>

            {/* `heading-xl`, the same size `PageHeader` gives every other page
                title in the product. This was `text-3xl` — 30px — which made the
                one page a signed-out user sees the only page with a bigger
                title than the app behind it. */}
            <h1 className="mb-ds-2 text-ds-heading-xl font-extrabold tracking-tight text-ds-content">
              Welcome Back
            </h1>
            <p className="text-ds-content-muted text-ds-body font-medium">
              Sign in to access your portal
            </p>
          </div>

          {error && (
            <div
              role="alert"
              className="mb-6 flex items-center gap-3 rounded-ds-lg border border-ds-status-danger-border bg-ds-status-danger-bg p-ds-4 animate-in fade-in slide-in-from-top-2"
            >
              <AlertCircle size={18} className="shrink-0 text-ds-status-danger-fg" aria-hidden="true" />
              <p className="text-ds-sm font-semibold text-ds-status-danger-fg">{error}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-ds-5">
            <FormField id="email" label="Email address" required>
              <Input
                name="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </FormField>

            <div className="grid gap-ds-2">
              <Label htmlFor="password" required>Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  style={{ paddingInlineEnd: 'var(--ds-space-12)' }}
                />
                <IconButton
                  variant="ghost"
                  label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword}
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-1 top-1/2 -translate-y-1/2"
                >
                  {showPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
                </IconButton>
              </div>
              <div className="text-right">
                <Button variant="link" size="sm" onClick={openForgotPassword}>
                  Forgot password?
                </Button>
              </div>
            </div>

            <Button
              type="submit"
              variant="primary"
              size="lg"
              fullWidth
              loading={loading}
            >
              Sign In
              {!loading && <ArrowRight size={18} aria-hidden="true" />}
            </Button>
          </form>

          <div className="mt-12 pt-8 border-t border-ds-border-subtle">
            <Card padding="md">
              <p className="text-ds-sm text-ds-content font-medium mb-1">
                New to SafeHaul?
              </p>
              <p className="text-ds-xs text-ds-content-muted mb-4 leading-relaxed">
                Contact our administration team to set up a new company account.
              </p>
              <a
                href="mailto:info@safehaul.io"
                className="inline-flex items-center gap-2 text-ds-sm text-ds-content-link hover:gap-3 font-bold transition-all"
              >
                Contact SafeHaul <ArrowRight size={16} aria-hidden="true" />
              </a>
            </Card>
          </div>

        </div>
      </div>

      {/* Right Side - Hero / Marketing.
          The panel is the inverse surface role, and everything on it that carries
          information — headline, copy, icons, numerals, labels — now reads from
          `--ds-*`. Five different text opacities (white at 100/80/70/60/50) became
          the two on-inverse content roles; `text-white/50` in particular was
          roughly 3.6:1 on this background, below AA for body text. */}
      <div className="relative hidden overflow-hidden bg-ds-surface-inverse lg:flex lg:w-[55%]">

        {/* Background wash. Recorded artwork exception (roadmap §5): three
            decorative blobs blurred over 256–384px, no information in them, and
            their colour is the brand's own rather than an interface role. A
            Tailwind opacity modifier cannot be applied to a `var()` colour, so
            tokenising these would mean three more single-use tint tokens. */}
        <div aria-hidden="true" className="absolute inset-0">
          <div className="absolute top-0 right-0 w-96 h-96 bg-[#0BE2A4]/10 rounded-ds-full blur-3xl transform translate-x-1/2 -translate-y-1/2"></div>
          <div className="absolute bottom-0 left-0 w-80 h-80 bg-[#004C68]/20 rounded-ds-full blur-3xl transform -translate-x-1/2 translate-y-1/2"></div>
          <div className="absolute top-1/2 left-1/2 w-64 h-64 bg-white/5 rounded-ds-full blur-2xl transform -translate-x-1/2 -translate-y-1/2"></div>
        </div>

        <div className="relative z-10 flex w-full flex-col items-center justify-center px-ds-12 text-center lg:px-16 xl:px-20">
          <div className="max-w-lg">
            <Logo className="mx-auto mb-ds-8 h-20 w-20" />

            <h2 className="mb-ds-4 text-ds-heading-xl font-bold leading-tight text-ds-content-on-inverse">
              Your Gateway to the Road
            </h2>

            <p className="mb-ds-10 text-ds-heading-md leading-relaxed text-ds-content-on-inverse">
              Whether you're a driver seeking your next opportunity or a company building your fleet, SafeHaul connects you to success.
            </p>

            <div className="mb-ds-10 flex flex-col gap-ds-4 text-left">
              <div className="flex items-start gap-ds-4 rounded-ds-xl border border-ds-border-inverse bg-ds-surface-inverse-subtle p-ds-4 backdrop-blur-sm transition-colors hover:bg-ds-surface-inverse-hover">
                <div aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-ds-lg bg-ds-brand-accent-soft">
                  <Briefcase size={20} className="text-ds-brand-accent" />
                </div>
                <div>
                  <h3 className="mb-ds-1 font-semibold text-ds-content-on-inverse">For Drivers</h3>
                  <p className="text-ds-body text-ds-content-on-inverse-muted">Apply to top carriers, track your applications, and find the perfect driving job that fits your lifestyle.</p>
                </div>
              </div>

              <div className="flex items-start gap-ds-4 rounded-ds-xl border border-ds-border-inverse bg-ds-surface-inverse-subtle p-ds-4 backdrop-blur-sm transition-colors hover:bg-ds-surface-inverse-hover">
                <div aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-ds-lg bg-ds-brand-accent-soft">
                  <Users size={20} className="text-ds-brand-accent" />
                </div>
                <div>
                  <h3 className="mb-ds-1 font-semibold text-ds-content-on-inverse">For Companies</h3>
                  <p className="text-ds-body text-ds-content-on-inverse-muted">Streamline recruitment, manage applications, and connect with qualified CDL drivers faster than ever.</p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-ds-4">
              <div className="text-center">
                <div className="mb-ds-1 text-ds-heading-xl font-bold text-ds-brand-accent">10K+</div>
                <div className="text-ds-body text-ds-content-on-inverse-muted">Active Drivers</div>
              </div>
              <div className="text-center">
                <div className="mb-ds-1 text-ds-heading-xl font-bold text-ds-brand-accent">10+</div>
                <div className="text-ds-body text-ds-content-on-inverse-muted">Partner Carriers</div>
              </div>
              <div className="text-center">
                <div className="mb-ds-1 text-ds-heading-xl font-bold text-ds-brand-accent">98%</div>
                <div className="text-ds-body text-ds-content-on-inverse-muted">Satisfaction Rate</div>
              </div>
            </div>

            <div className="mt-ds-10 flex items-center justify-center gap-ds-2 text-ds-body text-ds-content-on-inverse-muted">
              <CheckCircle2 size={16} aria-hidden="true" className="text-ds-brand-accent" />
              <span>DOT Compliant</span>
              {/* A pipe is read out as "vertical line" by some screen readers; it
                  is a visual separator between two claims, nothing more. */}
              <span aria-hidden="true" className="mx-ds-2">|</span>
              <CheckCircle2 size={16} aria-hidden="true" className="text-ds-brand-accent" />
              <span>FMCSA Approved</span>
            </div>
          </div>
        </div>
      </div>

      {/* Forgot Password Modal — shared accessible dialog (focus trap, Escape,
          backdrop dismiss, focus restore). Reset workflow behavior is preserved. */}
      {showForgotPassword && (
        <Modal
          onClose={closeForgotPassword}
          labelledBy={RESET_DIALOG_TITLE_ID}
          initialFocusRef={resetEmailSent ? undefined : resetEmailRef}
          className="w-full max-w-md overflow-hidden rounded-ds-xl bg-ds-surface shadow-ds-lg"
        >
          <div className="p-8">
            {resetEmailSent ? (
              <div className="text-center">
                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-ds-status-success-bg">
                  <CheckCircle2 size={32} className="text-ds-status-success-fg" aria-hidden="true" />
                </div>
                <h3 id={RESET_DIALOG_TITLE_ID} className="mb-2 text-ds-heading-md font-bold text-ds-content">
                  Check your email
                </h3>
                <p className="mb-6 text-ds-body text-ds-content-muted">
                  We've sent password reset instructions to{' '}
                  <strong className="text-ds-content">{resetEmail}</strong>
                </p>
                <Button
                  variant="primary"
                  size="lg"
                  fullWidth
                  onClick={closeForgotPassword}
                >
                  Back to Sign In
                </Button>
              </div>
            ) : (
              <>
                {/* `ghost`, not `link`: this stands alone above the dialog body
                    rather than sitting inside a sentence, so it keeps the full
                    control height and target size. */}
                <div className="mb-ds-4">
                  <Button variant="ghost" size="sm" onClick={closeForgotPassword}>
                    <ArrowLeft aria-hidden="true" />
                    Back to login
                  </Button>
                </div>
                <h3 id={RESET_DIALOG_TITLE_ID} className="mb-2 text-ds-heading-md font-bold text-ds-content">
                  Reset your password
                </h3>
                <p className="mb-6 text-ds-body text-ds-content-muted">
                  Enter your email address and we'll send you a link to reset your password.
                </p>

                <form onSubmit={handleForgotPassword} className="space-y-ds-4">
                  <FormField
                    id="reset-email"
                    label="Email address"
                    required
                    error={resetError || undefined}
                  >
                    <Input
                      ref={resetEmailRef}
                      type="email"
                      autoComplete="email"
                      value={resetEmail}
                      onChange={(e) => setResetEmail(e.target.value)}
                      placeholder="you@example.com"
                    />
                  </FormField>
                  <Button
                    type="submit"
                    variant="primary"
                    size="lg"
                    fullWidth
                    loading={resetLoading}
                  >
                    Send Reset Link
                  </Button>
                </form>
              </>
            )}
          </div>
        </Modal>
      )}

    </div>
  );
}
