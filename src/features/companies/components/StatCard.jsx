// Compatibility adapter retained while feature consumers migrate to MetricCard.
import React from 'react';
import { MetricCard } from '@/design-system/components';

function legacyColorToTone(colorClass = '') {
  if (colorClass.includes('orange') || colorClass.includes('amber')) return 'warning';
  if (colorClass.includes('green') || colorClass.includes('emerald')) return 'success';
  if (colorClass.includes('purple') || colorClass.includes('indigo')) return 'accent';
  if (colorClass.includes('blue')) return 'info';
  return 'neutral';
}

export function StatCard({ title, value, icon, active, onClick, colorClass, id }) {
  return (
    <MetricCard
      id={id}
      label={title}
      value={value}
      icon={React.isValidElement(icon) ? React.cloneElement(icon, { size: 20 }) : icon}
      tone={legacyColorToTone(colorClass)}
      active={active}
      onActivate={onClick}
    />
  );
}
