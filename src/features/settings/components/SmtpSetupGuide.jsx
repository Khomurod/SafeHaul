import React, { forwardRef } from 'react';
import { Icon, Mail, Server } from '@design-system/icons';
import { Card, Link } from '@/design-system/components';

/** One provider's guide: a heading, the numbered steps, then the settings to type in. */
function ProviderGuide({ icon, iconClassName, title, steps, configuration }) {
    return (
        <section className="space-y-ds-3 py-ds-5 first:pt-0 last:pb-0">
            <h3 className="flex items-center gap-ds-2 text-ds-heading-sm font-semibold text-ds-content">
                <Icon icon={icon} size="lg" className={iconClassName} />
                {title}
            </h3>
            <ol className="list-inside list-decimal space-y-ds-2 text-ds-body text-ds-content-secondary">
                {steps}
            </ol>
            <div className="text-ds-body text-ds-content-secondary">
                <p className="font-semibold text-ds-content">Configuration:</p>
                <ul className="mt-ds-1 space-y-ds-1 text-ds-xs">{configuration}</ul>
            </div>
        </section>
    );
}

/**
 * Settings → Email: the step-by-step guides for three mail providers, opened
 * from "How to Set Up SMTP" beside the server fields. Full width under the
 * server section, since three guides have no room in its side column: one
 * card, the providers divided by rules, no box inside it. Feature-owned
 * content. The ref is the card, so the page can bring it into view.
 */
export const SmtpSetupGuide = forwardRef(function SmtpSetupGuide({ id, labelledBy }, ref) {
    return (
        <Card ref={ref} as="section" id={id} aria-labelledby={labelledBy} padding="md" className="scroll-mt-ds-6">
            <div className="divide-y divide-ds-border-subtle animate-in fade-in slide-in-from-top-2">
                <ProviderGuide
                    icon={Mail}
                    iconClassName="text-ds-status-danger-fg"
                    title="Gmail / Google Workspace"
                    steps={(
                        <>
                            <li>Go to your <Link href="https://myaccount.google.com/" external>Google Account</Link></li>
                            <li>Navigate to <strong>Security</strong> → <strong>2-Step Verification</strong> (you must enable this first)</li>
                            <li>Scroll down and click <strong>App passwords</strong></li>
                            <li>Select app: <strong>Mail</strong>, Select device: <strong>Other (Custom name)</strong></li>
                            <li>Enter "SafeHaul" and click <strong>Generate</strong></li>
                            <li>Copy the 16-character password (e.g., <code className="rounded-ds-sm bg-ds-surface-subtle px-ds-1">xxxx xxxx xxxx xxxx</code>)</li>
                        </>
                    )}
                    configuration={(
                        <>
                            <li>• <strong>Host:</strong> smtp.gmail.com</li>
                            <li>• <strong>Port:</strong> 587</li>
                            <li>• <strong>Username:</strong> your-email@gmail.com</li>
                            <li>• <strong>Password:</strong> [App Password from step 6]</li>
                        </>
                    )}
                />
                <ProviderGuide
                    icon={Mail}
                    iconClassName="text-ds-status-info-fg"
                    title="Outlook / Microsoft 365"
                    steps={(
                        <>
                            <li>Ensure your Microsoft account has <strong>SMTP authentication enabled</strong></li>
                            <li>For Microsoft 365 admins: Go to <strong>Exchange Admin Center</strong> → <strong>Settings</strong> → Enable SMTP AUTH</li>
                            <li>Use your regular Outlook email and password (or create an app-specific password if using MFA)</li>
                        </>
                    )}
                    configuration={(
                        <>
                            <li>• <strong>Host:</strong> smtp.office365.com</li>
                            <li>• <strong>Port:</strong> 587</li>
                            <li>• <strong>Username:</strong> your-email@outlook.com (or company domain)</li>
                            <li>• <strong>Password:</strong> [Your Outlook password or app password]</li>
                        </>
                    )}
                />
                <ProviderGuide
                    icon={Server}
                    iconClassName="text-ds-status-accent-fg"
                    title="SendGrid (Recommended for High Volume)"
                    steps={(
                        <>
                            <li>Sign up for a free SendGrid account at <Link href="https://sendgrid.com/" external>sendgrid.com</Link></li>
                            <li>Go to <strong>Settings</strong> → <strong>API Keys</strong></li>
                            <li>Click <strong>Create API Key</strong></li>
                            <li>Name: "SafeHaul SMTP", Permissions: <strong>Full Access</strong> (or Mail Send only)</li>
                            <li>Copy the generated API key (starts with <code className="rounded-ds-sm bg-ds-surface-subtle px-ds-1">SG.</code>)</li>
                        </>
                    )}
                    configuration={(
                        <>
                            <li>• <strong>Host:</strong> smtp.sendgrid.net</li>
                            <li>• <strong>Port:</strong> 587</li>
                            <li>• <strong>Username:</strong> apikey (exactly as written)</li>
                            <li>• <strong>Password:</strong> [Your SendGrid API key from step 5]</li>
                        </>
                    )}
                />
            </div>
        </Card>
    );
});
