/** Typography primitives — Display, Headline, Text, Label, Mono */

import { type ReactNode, type CSSProperties } from 'react';
import { cn } from '@/utils/format';

interface TextProps {
  children: ReactNode;
  className?: string;
  as?: 'p' | 'span' | 'div' | 'h1' | 'h2' | 'h3' | 'h4' | 'label';
  style?: CSSProperties;
}

export function Display({ children, className, as: Tag = 'h1', style }: TextProps) {
  return <Tag className={cn('text-display', className)} style={style}>{children}</Tag>;
}

export function Headline({ children, className, as: Tag = 'h2', style }: TextProps) {
  return <Tag className={cn('text-headline', className)} style={style}>{children}</Tag>;
}

export function Text({ children, className, as: Tag = 'p', style }: TextProps) {
  return <Tag className={cn('text-body', className)} style={style}>{children}</Tag>;
}

export function TextLarge({ children, className, as: Tag = 'p', style }: TextProps) {
  return <Tag className={cn('text-body-lg', className)} style={style}>{children}</Tag>;
}

export function TextSmall({ children, className, as: Tag = 'p', style }: TextProps) {
  return <Tag className={cn('text-body-sm', className)} style={style}>{children}</Tag>;
}

export function Label({ children, className, as: Tag = 'span', style }: TextProps) {
  return <Tag className={cn('text-label', className)} style={style}>{children}</Tag>;
}

export function Mono({ children, className, as: Tag = 'span', style }: TextProps) {
  return <Tag className={cn('text-mono', className)} style={style}>{children}</Tag>;
}

interface MetadataProps {
  children: ReactNode;
  className?: string;
  color?: string;
  style?: CSSProperties;
}

export function Metadata({ children, className, color = '#6B7B6E', style }: MetadataProps) {
  return (
    <span
      className={cn('text-body-sm', className)}
      style={{ color, fontWeight: 500, ...style }}
    >
      {children}
    </span>
  );
}