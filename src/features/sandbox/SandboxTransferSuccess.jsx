import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Icon, Building2 } from '@design-system/icons';
import { Badge, Button, Card, StatusMedallion } from '@/design-system/components';
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
          {/*
            A hand-built medallion until 2026-09-06: a 56px tinted square holding
            a 28px glyph, `aria-hidden`, in a file that already imported from the
            design system. The 28 is what flagged it — it is not a step on the
            icon scale, and an off-scale size is the signal that a container is
            missing rather than that the scale is short.
          */}
          <StatusMedallion tone="success">
            <Icon icon={Building2} />
          </StatusMedallion>
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
