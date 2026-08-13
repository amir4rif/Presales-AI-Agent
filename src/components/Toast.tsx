'use client';
/* One toast implementation instead of one per page. */
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

type Toast = { id: number; msg: string; warn: boolean };
type ToastFn = (msg: string, warn?: boolean) => void;

const ToastContext = createContext<ToastFn>(() => {});

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);

  const toast = useCallback<ToastFn>((msg, warn = false) => {
    const id = Date.now() + Math.random();
    setItems((prev) => [...prev, { id, msg, warn }]);
    setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), 3200);
  }, []);

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="toast-stack">
        {items.map((t) => (
          <div key={t.id} className={`toast${t.warn ? ' toast-warn' : ''}`}>
            {t.msg}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
