'use client';
/* One modal shell. The old pages each re-implemented openModal /
   closeModal / closeOnBackdrop against element ids. */
import type { CSSProperties, ReactNode } from 'react';

export default function Modal({
  open,
  onClose,
  title,
  sub,
  children,
  actions,
  style,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  sub?: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  style?: CSSProperties;
}) {
  if (!open) return null;
  return (
    <div
      className="modal-overlay open"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal" style={style}>
        <div className="modal-title">{title}</div>
        {sub && <div className="modal-sub">{sub}</div>}
        {children}
        {actions && <div className="modal-actions">{actions}</div>}
      </div>
    </div>
  );
}
