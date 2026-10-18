import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'success';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-blue-700 text-white hover:bg-blue-800 disabled:bg-blue-300',
  secondary: 'bg-white text-slate-800 border border-slate-300 hover:bg-slate-50 disabled:text-slate-400',
  danger: 'bg-red-600 text-white hover:bg-red-700 disabled:bg-red-300',
  success: 'bg-emerald-600 text-white hover:bg-emerald-700 disabled:bg-emerald-300',
  ghost: 'text-slate-700 hover:bg-slate-100 disabled:text-slate-400',
};

export function Button({
  variant = 'secondary', small, className = '', ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; small?: boolean }) {
  return (
    <button
      type="button"
      {...props}
      className={`${VARIANTS[variant]} ${small ? 'px-2 py-1 text-xs' : 'px-3 py-1.5 text-sm'} rounded font-medium transition disabled:cursor-not-allowed ${className}`}
    />
  );
}

export function Field({ label, children, hint, className = '' }: { label: string; children: ReactNode; hint?: string; className?: string }) {
  return (
    <label className={`block text-sm ${className}`}>
      <span className="mb-1 block font-medium text-slate-700">{label}</span>
      {children}
      {hint && <span className="mt-0.5 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

export const inputCls = 'w-full rounded border border-slate-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-slate-100';

/** Bỏ w-full mặc định khi người gọi tự đặt chiều rộng. */
const withCls = (extra?: string) => `${/(^|\s)w-/.test(extra ?? '') ? inputCls.replace('w-full ', '') : inputCls} ${extra ?? ''}`;

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={withCls(props.className)} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={withCls(props.className)} />;
}

export function Card({ title, children, actions, className = '', printHeader = true }: { title?: ReactNode; children: ReactNode; actions?: ReactNode; className?: string; printHeader?: boolean }) {
  return (
    <section className={`rounded-lg border border-slate-200 bg-white shadow-sm print:border-0 print:shadow-none ${className}`}>
      {(title || actions) && (
        <header className={`${printHeader ? '' : 'no-print '}flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-2.5`}>
          <h2 className="font-semibold text-slate-800">{title}</h2>
          <div className="flex flex-wrap gap-2">{actions}</div>
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Badge({ children, color = 'slate' }: { children: ReactNode; color?: 'slate' | 'green' | 'red' | 'amber' | 'blue' | 'purple' }) {
  const map = {
    slate: 'bg-slate-100 text-slate-700',
    green: 'bg-emerald-100 text-emerald-800',
    red: 'bg-red-100 text-red-800',
    amber: 'bg-amber-100 text-amber-800',
    blue: 'bg-blue-100 text-blue-800',
    purple: 'bg-purple-100 text-purple-800',
  };
  return <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${map[color]}`}>{children}</span>;
}

export function Modal({
  title, children, onClose, footer, wide,
}: { title: string; children: ReactNode; onClose: () => void; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="no-print fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`mt-8 w-full ${wide ? 'max-w-5xl' : 'max-w-lg'} rounded-lg bg-white shadow-xl`} role="dialog" aria-modal="true">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h3 className="font-semibold text-slate-800">{title}</h3>
          <button className="text-xl leading-none text-slate-500 hover:text-slate-800" onClick={onClose} aria-label="Đóng">×</button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto p-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t px-4 py-3">{footer}</div>}
      </div>
    </div>
  );
}

// ---------- Hộp thoại xác nhận / nhập liệu dạng Promise

interface DialogReq {
  title: string;
  message: ReactNode;
  confirmText?: string;
  danger?: boolean;
  input?: { label: string; initial?: string; required?: boolean; multiline?: boolean };
  resolve: (v: string | boolean | null) => void;
}

interface DialogApi {
  confirm: (o: { title: string; message: ReactNode; confirmText?: string; danger?: boolean }) => Promise<boolean>;
  prompt: (o: { title: string; message?: ReactNode; label: string; initial?: string; required?: boolean; multiline?: boolean; confirmText?: string }) => Promise<string | null>;
}

const DialogCtx = createContext<DialogApi | null>(null);

type ToastKind = 'success' | 'error' | 'info' | 'warning';
interface Toast { id: number; text: string; kind: ToastKind }
const ToastCtx = createContext<((text: string, kind?: ToastKind) => void) | null>(null);

export function UiProvider({ children }: { children: ReactNode }) {
  const [req, setReq] = useState<DialogReq | null>(null);
  const [value, setValue] = useState('');
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(0);

  const api: DialogApi = {
    confirm: (o) => new Promise((resolve) => setReq({ ...o, resolve: (v) => resolve(!!v) })),
    prompt: (o) =>
      new Promise((resolve) => {
        setValue(o.initial ?? '');
        setReq({
          title: o.title,
          message: o.message ?? '',
          confirmText: o.confirmText,
          input: { label: o.label, initial: o.initial, required: o.required, multiline: o.multiline },
          resolve: (v) => resolve(typeof v === 'string' ? v : null),
        });
      }),
  };

  const toast = useCallback((text: string, kind: ToastKind = 'info') => {
    const id = ++idRef.current;
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 8000 : 4000);
  }, []);

  const close = (v: string | boolean | null) => {
    req?.resolve(v);
    setReq(null);
  };

  return (
    <DialogCtx.Provider value={api}>
      <ToastCtx.Provider value={toast}>
        {children}
        {req && (
          <Modal
            title={req.title}
            onClose={() => close(null)}
            footer={
              <>
                <Button onClick={() => close(null)}>Hủy</Button>
                <Button
                  variant={req.danger ? 'danger' : 'primary'}
                  disabled={!!req.input?.required && !value.trim()}
                  onClick={() => close(req.input ? value : true)}
                >
                  {req.confirmText ?? 'Đồng ý'}
                </Button>
              </>
            }
          >
            <div className="space-y-3 text-sm text-slate-700">
              {req.message && <div>{req.message}</div>}
              {req.input && (
                <Field label={req.input.label}>
                  {req.input.multiline ? (
                    <textarea className={inputCls} rows={3} value={value} autoFocus onChange={(e) => setValue(e.target.value)} />
                  ) : (
                    <Input
                      value={value}
                      autoFocus
                      onChange={(e) => setValue(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && (!req.input?.required || value.trim()) && close(value)}
                    />
                  )}
                </Field>
              )}
            </div>
          </Modal>
        )}
        <div className="no-print fixed bottom-4 right-4 z-[60] flex w-96 max-w-[90vw] flex-col gap-2">
          {toasts.map((t) => (
            <div
              key={t.id}
              className={`rounded px-3 py-2 text-sm shadow-lg ${
                t.kind === 'success' ? 'bg-emerald-600 text-white' : t.kind === 'error' ? 'bg-red-600 text-white' : t.kind === 'warning' ? 'bg-amber-500 text-white' : 'bg-slate-800 text-white'
              }`}
              role="status"
            >
              {t.text}
            </div>
          ))}
        </div>
      </ToastCtx.Provider>
    </DialogCtx.Provider>
  );
}

export function useDialog(): DialogApi {
  const c = useContext(DialogCtx);
  if (!c) throw new Error('UiProvider chưa được cung cấp');
  return c;
}

export function useToast() {
  const c = useContext(ToastCtx);
  if (!c) throw new Error('UiProvider chưa được cung cấp');
  return c;
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="rounded border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">{children}</div>;
}
