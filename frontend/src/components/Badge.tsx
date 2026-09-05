/** Badge / Pill — for state, info, warning, success, error */

import { type ReactNode } from 'react';
import { cn } from '@/utils/format';
import type { InheritanceState } from '@/types';
import { getStateBadgeClass, getStateLabel } from '@/utils/format';

type BadgeVariant = 'state' | 'info' | 'warning' | 'success' | 'error' | 'neutral';

interface BadgeProps {
  children: ReactNode;
  variant?: BadgeVariant;
  className?: string;
  icon?: ReactNode;
}

export function Badge({ children, variant = 'neutral', className, icon }: BadgeProps) {
  const variantClass = {
    state: 'badge-active',
    info: 'badge-info',
    warning: 'badge-warning',
    success: 'badge-success',
    error: 'badge-warning',
    neutral: 'badge-closed',
  }[variant];

  return (
    <span className={cn(variantClass, className)}>
      {icon}
      {children}
    </span>
  );
}

/** VaultStateBadge — auto-maps state to correct badge class */

interface VaultStateBadgeProps {
  state: InheritanceState;
  className?: string;
}

export function VaultStateBadge({ state, className }: VaultStateBadgeProps) {
  return (
    <span className={cn(getStateBadgeClass(state), className)}>
      {getStateLabel(state)}
    </span>
  );
}