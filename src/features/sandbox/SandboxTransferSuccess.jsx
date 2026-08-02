import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Building2 } from 'lucide-react';
import { Badge, Button, Card } from '@/design-system/components';
import { Inline, Stack } from '@/design-system/layouts';

/** Shown after sandbox transfer (navigate state from SandboxActionPanel). */
export function SandboxTransferSuccess() {
  const navigate = useNavigate();
  const { state } = useLocation();
  const companyName = state?.companyName || state?.companyId || 'the selected company';

  return (
    <div className="flex min-h-screen items-center justify-center bg-ds-canvas p-ds-4">
      <Card as="main" padding="lg" className="w-full max-w-md text-center">
        <Stack gap="md" className="items-center">
          <span
            className="flex h-14 w-14 items-center justify-center rounded-ds-lg bg-ds-status-success-bg text-ds-status-success-fg"
            aria-hidden="true"
          >
            <Building2 size={28} />
          </span>
          <h1 className="text-ds-heading-xl font-bold text-ds-content">Transfer complete</h1>
          <p className="text-ds-body text-ds-content-secondary">
            The application is now under{' '}
            <strong className="font-semibold text-ds-content break-words">{companyName}</strong>{' '}
            with status <Badge tone="neutral">New Application</Badge>.
          </p>
          <Inline gap="sm" className="justify-center">
            <Button variant="primary" onClick={() => navigate('/super-admin')}>
              Super Admin
            </Button>
            <Button variant="secondary" onClick={() => navigate('/')}>
              Home
            </Button>
          </Inline>
        </Stack>
      </Card>
    </div>
  );
}
