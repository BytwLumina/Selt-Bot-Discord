import type { CSSProperties, ReactNode } from 'react';
import type { MsgState } from '../types';
import { Icon } from './icons';
import type { IconName } from './icons';

type Tone = 'good' | 'bad' | 'warn' | 'accent' | '';

export function Card({
  title,
  hint,
  children,
  className,
  i = 0,
}: {
  title?: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
  i?: number;
}) {
  return (
    <section className={className ? `card ${className}` : 'card'} style={{ '--i': i } as CSSProperties}>
      {title !== undefined ? (
        <h2>
          {title}
          {hint ? <span className="hint">{hint}</span> : null}
        </h2>
      ) : null}
      {children}
    </section>
  );
}

export function KV({ k, v, tone = '' }: { k: ReactNode; v: ReactNode; tone?: Tone }) {
  return (
    <div className="kv">
      <span className="k">{k}</span>
      <span className={tone ? `v ${tone}` : 'v'}>{v}</span>
    </div>
  );
}

export function Badge({
  tone = '',
  children,
  title,
}: {
  tone?: Tone;
  children: ReactNode;
  title?: string;
}) {
  return (
    <span className={tone ? `badge ${tone}` : 'badge'} title={title}>
      {children}
    </span>
  );
}

export function Msg({ state }: { state: MsgState | null }) {
  if (!state) return null;
  return <div className={`msg ${state.kind}`}>{state.text}</div>;
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="empty">
      <span className="e-ic" aria-hidden="true">
        <Icon name="inbox" size={18} />
      </span>
      <span>{children}</span>
    </div>
  );
}

export function Field({
  label,
  children,
  wide,
}: {
  label: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <label className={wide ? 'field wide' : 'field'}>
      <span>{label}</span>
      {children}
    </label>
  );
}

export function Toggle({
  checked,
  onChange,
  children,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label className={disabled ? 'check disabled' : 'check'}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>{children}</span>
    </label>
  );
}

export function Tile({
  label,
  value,
  sub,
  tone = '',
  icon,
  i = 0,
}: {
  label: ReactNode;
  value: ReactNode;
  sub: ReactNode;
  tone?: Tone;
  icon: IconName;
  i?: number;
}) {
  return (
    <div className={tone ? `tile ${tone}` : 'tile'} style={{ '--i': i } as CSSProperties}>
      <div className="label">
        <span className="t-icon">
          <Icon name={icon} size={15} />
        </span>
        {label}
      </div>
      <div className="value">{value}</div>
      <div className="sub">{sub}</div>
    </div>
  );
}

export function SectionNote({ children }: { children: ReactNode }) {
  return <p className="acct-note">{children}</p>;
}
