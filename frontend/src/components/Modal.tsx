/** Modal / Dialog — overlay + content */

import { type ReactNode, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '@/utils/format';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  hideClose?: boolean;
}

export function Modal({ isOpen, onClose, title, description, children, size = 'md', hideClose = false }: ModalProps) {
  useEffect(() => {
    if (!isOpen) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEsc);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleEsc);
      document.body.style.overflow = '';
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const sizeStyle = {
    sm: { maxWidth: '400px' },
    md: { maxWidth: '480px' },
    lg: { maxWidth: '640px' },
  }[size];

  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content"
        style={sizeStyle}
        onClick={(e) => e.stopPropagation()}
      >
        {(title || description) && (
          <div
            className="flex items-start justify-between"
            style={{
              padding: 'var(--space-5)',
              borderBottom: '1px solid var(--color-border)',
              gap: 'var(--space-4)',
            }}
          >
            <div className="flex flex-col" style={{ gap: 'var(--space-1)' }}>
              {title && <h3 className="text-headline" style={{ fontSize: '1.25rem' }}>{title}</h3>}
              {description && <p className="text-body-sm" style={{ color: '#6B7B6E' }}>{description}</p>}
            </div>
            {!hideClose && (
              <button
                onClick={onClose}
                className="btn-ghost"
                style={{ padding: 'var(--space-1)', minWidth: 32, minHeight: 32 }}
                aria-label="Close"
              >
                <X size={18} />
              </button>
            )}
          </div>
        )}
        <div className="flex flex-col" style={{ padding: 'var(--space-5)' }}>
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
}

/** Toast — bottom-right notification */

import { useState, useCallback } from 'react';

type ToastVariant = 'success' | 'error' | 'info';

interface ToastData {
  id: string;
  message: string;
  variant: ToastVariant;
  duration?: number;
}

let toastIdCounter = 0;

const toastListeners = new Set<(toast: ToastData) => void>();

export function showToast(message: string, variant: ToastVariant = 'info', duration = 5000) {
  const id = `toast-${++toastIdCounter}`;
  const toast: ToastData = { id, message, variant, duration };
  toastListeners.forEach((listener) => listener(toast));
}

export function ToastContainer() {
  const [toasts, setToasts] = useState<ToastData[]>([]);

  const addToast = useCallback((toast: ToastData) => {
    setToasts((prev) => [...prev, toast]);
    if (toast.duration) {
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== toast.id));
      }, toast.duration);
    }
  }, []);

  useEffect(() => {
    toastListeners.add(addToast);
    return () => {
      toastListeners.delete(addToast);
    };
  }, [addToast]);

  return (
    <>
      {toasts.map((toast) => {
        const variantClass = {
          success: 'toast-success',
          error: 'toast-error',
          info: 'toast-info',
        }[toast.variant];

        return (
          <div key={toast.id} className={cn(variantClass)}>
            {toast.message}
          </div>
        );
      })}
    </>
  );
}

/** ConfirmationDialog — yes/no modal */

interface ConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'primary' | 'destructive';
  loading?: boolean;
  children?: ReactNode;
}

export function ConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  variant = 'primary',
  loading = false,
  children,
}: ConfirmDialogProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} description={description} size="sm">
      <div className="flex flex-col" style={{ gap: 'var(--space-4)' }}>
        {children}
        <div className="flex justify-end" style={{ gap: 'var(--space-3)' }}>
          <button className="btn btn-secondary" onClick={onClose} disabled={loading}>
            {cancelText}
          </button>
          <button
            className={cn(variant === 'destructive' ? 'btn-destructive' : 'btn-primary')}
            onClick={onConfirm}
            disabled={loading}
          >
            {loading ? 'Working…' : confirmText}
          </button>
        </div>
      </div>
    </Modal>
  );
}