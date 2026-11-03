'use client';

import { Dialog as BaseDialog } from '@base-ui/react/dialog';
import { X } from 'lucide-react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

export function Button({ variant = 'secondary', className = '', type = 'button', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' }) {
  return <button type={type} className={`button button-${variant} ${className}`} {...props} />;
}

export function Dialog({ open, onOpenChange, title, description, children, className = '', closable = true }: {
  open: boolean; onOpenChange: (open: boolean) => void; title: string; description: string; children: ReactNode; className?: string; closable?: boolean;
}) {
  return <BaseDialog.Root open={open} onOpenChange={onOpenChange}>
    <BaseDialog.Portal>
      <BaseDialog.Backdrop className="dialog-backdrop" />
      <BaseDialog.Popup className={`dialog ${className}`}>
        <div className="dialog-heading"><BaseDialog.Title>{title}</BaseDialog.Title>{closable ? <BaseDialog.Close className="button button-ghost icon-button" aria-label="Close dialog"><X size={20} /></BaseDialog.Close> : null}</div>
        <BaseDialog.Description className="muted">{description}</BaseDialog.Description>
        {children}
      </BaseDialog.Popup>
    </BaseDialog.Portal>
  </BaseDialog.Root>;
}
