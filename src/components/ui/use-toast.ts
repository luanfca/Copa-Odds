'use client';

import { useState, useCallback } from 'react';
import type { ToastProps } from './toast';

interface ToastData extends ToastProps {
  id: string;
  title?: string;
  description?: string;
  action?: React.ReactElement;
  variant?: 'default' | 'destructive';
}

let toastCount = 0;
const listeners: Array<(toasts: ToastData[]) => void> = [];
let memoryState: { toasts: ToastData[] } = { toasts: [] };

function dispatch(action: { type: 'ADD' | 'REMOVE'; toast?: ToastData; id?: string }) {
  if (action.type === 'ADD' && action.toast) {
    memoryState = { toasts: [action.toast, ...memoryState.toasts].slice(0, 5) };
  } else if (action.type === 'REMOVE') {
    memoryState = { toasts: memoryState.toasts.filter(t => t.id !== action.id) };
  }
  listeners.forEach(l => l(memoryState.toasts));
}

export function toast(props: Omit<ToastData, 'id'>) {
  const id = String(++toastCount);
  dispatch({ type: 'ADD', toast: { ...props, id, open: true } });
  setTimeout(() => dispatch({ type: 'REMOVE', id }), 4000);
  return id;
}

export function useToast() {
  const [toasts, setToasts] = useState<ToastData[]>(memoryState.toasts);

  const addListener = useCallback((fn: (t: ToastData[]) => void) => {
    listeners.push(fn);
    return () => { listeners.splice(listeners.indexOf(fn), 1); };
  }, []);

  // eslint-disable-next-line
  useState(() => { const rem = addListener(setToasts); return rem; });

  return { toasts, toast };
}
