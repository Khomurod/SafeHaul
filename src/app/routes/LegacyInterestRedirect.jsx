import { Navigate, useParams, useSearchParams } from 'react-router-dom';

/**
 * Compatibility redirect for old "Are You Interested?" links.
 *
 * The interest-confirmation page was removed, but previously sent links like
 *   /interest/:slug?r=<recruiter>&l=<leadId>
 * may still be opened by drivers. Forward them straight to the public
 * application, preserving recruiter attribution (`r`) and lead prefill
 * (`l`/`leadId` → `prefill`, matching what the old page passed along).
 *
 * This intentionally restores no interest page, Yes/No flow, or backend —
 * it only keeps old links working.
 */
export function LegacyInterestRedirect() {
  const { slug } = useParams();
  const [searchParams] = useSearchParams();

  const params = new URLSearchParams();
  const recruiter = searchParams.get('r') || searchParams.get('recruiter');
  const leadId = searchParams.get('l') || searchParams.get('leadId');
  if (recruiter) params.set('r', recruiter);
  if (leadId) params.set('prefill', leadId);

  const qs = params.toString();
  return <Navigate to={qs ? `/apply/${slug}?${qs}` : `/apply/${slug}`} replace />;
}
