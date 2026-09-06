/** Input — text, number, address, textarea */

import { type InputHTMLAttributes, type TextareaHTMLAttributes, type ReactNode, useId } from 'react';
import { cn } from '@/utils/format';

type InputBaseProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'prefix'>;

interface InputProps extends InputBaseProps {
  label?: string;
  helperText?: string;
  errorText?: string;
  prefix?: ReactNode;
  suffix?: ReactNode;
}

export function Input({
  label,
  helperText,
  errorText,
  prefix,
  suffix,
  className,
  id,
  ...rest
}: InputProps) {
  const reactId = useId();
  const inputId = id ?? `input-${reactId}`;

  return (
    <div className="flex flex-col" style={{ gap: 'var(--space-1)' }}>
      {label && (
        <label htmlFor={inputId} className="label">
          {label}
        </label>
      )}
      <div
        className={cn('flex items-center', errorText && 'input-error')}
        style={{
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-md)',
          backgroundColor: 'var(--color-deep)',
          padding: 0,
        }}
      >
        {prefix && (
          <span
            style={{
              paddingLeft: 'var(--space-3)',
              color: 'var(--color-soft)',
              fontSize: 'var(--text-body-sm)',
            }}
          >
            {prefix}
          </span>
        )}
        <input
          id={inputId}
          className={cn('input', className)}
          style={{
            border: 'none',
            background: 'transparent',
            padding: prefix ? 'var(--space-3) var(--space-3) var(--space-3) var(--space-2)' : undefined,
          }}
          {...rest}
        />
        {suffix && (
          <span
            style={{
              paddingRight: 'var(--space-3)',
              color: 'var(--color-soft)',
              fontSize: 'var(--text-body-sm)',
            }}
          >
            {suffix}
          </span>
        )}
      </div>
      {errorText && <span className="error-text">{errorText}</span>}
      {!errorText && helperText && <span className="helper-text">{helperText}</span>}
    </div>
  );
}

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  helperText?: string;
  errorText?: string;
}

export function Textarea({ label, helperText, errorText, className, id, ...rest }: TextareaProps) {
  const reactId = useId();
  const inputId = id ?? `textarea-${reactId}`;

  return (
    <div className="flex flex-col" style={{ gap: 'var(--space-1)' }}>
      {label && (
        <label htmlFor={inputId} className="label">
          {label}
        </label>
      )}
      <textarea
        id={inputId}
        className={cn('input', errorText && 'input-error', className)}
        rows={4}
        style={{ resize: 'vertical', fontFamily: 'var(--font-mono)' }}
        {...rest}
      />
      {errorText && <span className="error-text">{errorText}</span>}
      {!errorText && helperText && <span className="helper-text">{helperText}</span>}
    </div>
  );
}

/** Select wrapper */

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  helperText?: string;
  errorText?: string;
  children: ReactNode;
}

import type React from 'react';

export function Select({ label, helperText, errorText, className, id, children, ...rest }: SelectProps) {
  const reactId = useId();
  const selectId = id ?? `select-${reactId}`;

  return (
    <div className="flex flex-col" style={{ gap: 'var(--space-1)' }}>
      {label && (
        <label htmlFor={selectId} className="label">
          {label}
        </label>
      )}
      <select
        id={selectId}
        className={cn('input', errorText && 'input-error', className)}
        {...rest}
      >
        {children}
      </select>
      {errorText && <span className="error-text">{errorText}</span>}
      {!errorText && helperText && <span className="helper-text">{helperText}</span>}
    </div>
  );
}