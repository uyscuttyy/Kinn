/** Card — subtle elevation, outlined, flat */

import { type ReactNode, type HTMLAttributes } from 'react';
import { cn } from '@/utils/format';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  variant?: 'default' | 'elevated' | 'outlined' | 'flat';
  padding?: 'none' | 'sm' | 'md' | 'lg';
}

export function Card({ children, variant = 'default', padding = 'md', className, ...rest }: CardProps) {
  const variantClass = {
    default: 'card',
    elevated: 'card-elevated',
    outlined: 'card-outlined',
    flat: '',
  }[variant];

  const paddingStyle = {
    none: { padding: 0 },
    sm: { padding: 'var(--space-3)' },
    md: { padding: 'var(--space-5)' },
    lg: { padding: 'var(--space-6)' },
  }[padding];

  return (
    <div
      className={cn(variantClass, className)}
      style={{ ...paddingStyle, ...rest.style }}
      {...rest}
    >
      {children}
    </div>
  );
}

/** Empty State — illustration slot + headline + body + action */

import { Inbox } from 'lucide-react';

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn('empty-state', className)}>
      <div className="empty-state-icon">
        {icon ?? <Inbox size={64} strokeWidth={1.5} />}
      </div>
      <h3 className="empty-state-title">{title}</h3>
      {description && <p className="empty-state-description">{description}</p>}
      {action}
    </div>
  );
}

/** Loading State — skeleton or spinner */

interface LoadingStateProps {
  variant?: 'page' | 'inline' | 'block';
  message?: string;
}

export function LoadingState({ variant = 'inline', message }: LoadingStateProps) {
  if (variant === 'page') {
    return (
      <div
        className="flex items-center justify-center"
        style={{ minHeight: '60vh', gap: 'var(--space-3)' }}
      >
        <div className="skeleton" style={{ width: 32, height: 32, borderRadius: '50%' }} />
        {message && <span className="text-body-sm" style={{ color: '#6B7B6E' }}>{message}</span>}
      </div>
    );
  }

  if (variant === 'block') {
    return (
      <div
        className="skeleton"
        style={{ width: '100%', height: 120, borderRadius: 'var(--radius-lg)' }}
      />
    );
  }

  return (
    <div className="flex items-center" style={{ gap: 'var(--space-2)' }}>
      <div className="skeleton" style={{ width: 16, height: 16, borderRadius: '50%' }} />
      {message && <span className="text-body-sm" style={{ color: '#6B7B6E' }}>{message}</span>}
    </div>
  );
}

/** Skeleton line — for loading text */

interface SkeletonLineProps {
  width?: string | number;
  height?: number;
  className?: string;
}

export function SkeletonLine({ width = '100%', height = 16, className }: SkeletonLineProps) {
  return (
    <div
      className={cn('skeleton', className)}
      style={{ width, height, borderRadius: 'var(--radius-sm)' }}
    />
  );
}