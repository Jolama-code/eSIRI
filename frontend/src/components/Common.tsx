import { useEffect, type ReactNode } from 'react';
import { CheckCircle2, X } from 'lucide-react';
import { useApp } from '../store/appStore';
import { useT } from '../i18n';
import { ez } from './esiriProps';

export function Toasts() {
  const toasts = useApp((s) => s.toasts);
  const dismiss = useApp((s) => s.dismissToast);
  const t = useT();
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((toast, i) => (
        <div className="toast" key={toast.id} role="status">
          <CheckCircle2 size={20} className="toast-icon" />
          <span className="toast-text">{toast.text}</span>
          <button
            className="toast-close"
            onClick={() => dismiss(toast.id)}
            aria-label={t('toast.close')}
            {...(i === toasts.length - 1 ? ez('toast.close', t('toast.close')) : {})}
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

export function Modal({
  name,
  title,
  onClose,
  children,
  footer,
  width = 440,
}: {
  name: string;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Esc closes the modal only when eSiri is not busy (Esc then cancels eSiri instead).
      if (e.key === 'Escape' && document.body.dataset.esiriBusy !== '1') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} style={{ maxWidth: width }} data-esiri-modal={name}>
        <h2 className="modal-title">{title}</h2>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}

export function Toggle({
  id,
  label,
  checked,
  onChange,
  description,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  description?: string;
}) {
  return (
    <div className="toggle-row">
      <div className="toggle-text">
        <span className="toggle-label">{label}</span>
        {description && <span className="toggle-desc">{description}</span>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className={`switch ${checked ? 'on' : ''}`}
        onClick={() => onChange(!checked)}
        {...ez(id, label, { state: checked ? 'on' : 'off' })}
      >
        <span className="knob" />
      </button>
    </div>
  );
}

export function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
  fallbackCopy(text);
  return Promise.resolve();
}

function fallbackCopy(text: string): void {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
  } catch {
    /* ignore */
  }
  ta.remove();
}

export function joinLink(token: string): string {
  return `http://localhost:5173/?token=${encodeURIComponent(token)}`;
}
