import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import React, { createContext, useCallback, useContext, useState } from 'react';

const ToastContext = createContext(null);

const TONES = {
  success: { icon: CheckCircle2, cls: 'border-risk-low/30 text-risk-low' },
  error: { icon: AlertTriangle, cls: 'border-risk-critical/30 text-risk-critical' },
  info: { icon: Info, cls: 'border-gold/30 text-gold' },
};

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const push = useCallback((message, tone = 'info', ttl = 3500) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), ttl);
  }, []);

  const dismiss = (id) => setToasts((t) => t.filter((x) => x.id !== id));

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="fixed bottom-5 right-5 z-[100] space-y-2 w-80">
        {toasts.map((t) => {
          const { icon: Icon, cls } = TONES[t.tone] || TONES.info;
          return (
            <div key={t.id} className={`card fade-in px-3.5 py-3 flex items-start gap-2.5 border ${cls} shadow-glow`}>
              <Icon size={16} className="mt-0.5 shrink-0" />
              <div className="text-sm text-gray-200 flex-1">{t.message}</div>
              <button onClick={() => dismiss(t.id)} className="text-gray-500 hover:text-white"><X size={14} /></button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext) || (() => {});
}
