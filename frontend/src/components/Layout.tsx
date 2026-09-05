/** Container — centered max-width layout */

import { type ReactNode, type HTMLAttributes } from 'react';
import { cn } from '@/utils/format';

interface ContainerProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  size?: 'default' | 'narrow' | 'wide';
}

export function Container({ children, className, size = 'default', ...rest }: ContainerProps) {
  return (
    <div
      className={cn('container', className)}
      style={{
        maxWidth: size === 'narrow' ? '640px' : size === 'wide' ? '1280px' : '960px',
      }}
      {...rest}
    >
      {children}
    </div>
  );
}

/** Stack — vertical flex with gap */

import type { CSSProperties } from 'react';

interface StackProps {
  children: ReactNode;
  gap?: 1 | 2 | 3 | 4 | 5 | 6 | 8 | 10 | 12;
  className?: string;
  style?: CSSProperties;
}

export function Stack({ children, gap = 4, className, style }: StackProps) {
  return (
    <div
      className={cn('flex flex-col', className)}
      style={{ gap: `var(--space-${gap})`, ...style }}
    >
      {children}
    </div>
  );
}

/** Row — horizontal flex with gap */

interface RowProps {
  children: ReactNode;
  gap?: 1 | 2 | 3 | 4 | 5 | 6 | 8 | 10 | 12;
  className?: string;
  align?: 'start' | 'center' | 'end' | 'baseline';
  justify?: 'start' | 'center' | 'end' | 'between' | 'around';
  wrap?: boolean;
  style?: CSSProperties;
}

export function Row({ children, gap = 4, className, align = 'center', justify = 'start', wrap = false, style }: RowProps) {
  const alignMap = { start: 'flex-start', center: 'center', end: 'flex-end', baseline: 'baseline' };
  const justifyMap = { start: 'flex-start', center: 'center', end: 'flex-end', between: 'space-between', around: 'space-around' };

  return (
    <div
      className={cn('flex', className)}
      style={{
        gap: `var(--space-${gap})`,
        alignItems: alignMap[align],
        justifyContent: justifyMap[justify],
        flexWrap: wrap ? 'wrap' : 'nowrap',
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** Section — padded section with optional title */

interface SectionProps {
  title?: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function Section({ title, description, action, children, className }: SectionProps) {
  return (
    <section className={cn('flex flex-col', className)} style={{ gap: 'var(--space-5)' }}>
      {(title || description || action) && (
        <Row justify="between" align="baseline">
          <Stack gap={1}>
            {title && <h2 className="text-headline">{title}</h2>}
            {description && <p className="text-body-sm" style={{ color: '#6B7B6E' }}>{description}</p>}
          </Stack>
          {action}
        </Row>
      )}
      {children}
    </section>
  );
}