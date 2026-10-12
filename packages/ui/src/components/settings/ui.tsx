/**
 * Settings building blocks, in shtl's style: sections separated by hairlines,
 * rows with a title column whose help explains the current choice, and
 * segmented controls instead of switches and dropdowns.
 */
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';
import './ui.css';

export function SettingsTab({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={`settings-tab-content st-tab${className ? ` ${className}` : ''}`}>{children}</div>;
}

export function Section({ title, description, actions, children }: {
  title: string;
  description?: ReactNode;
  /** Buttons on the right of the title (e.g. Add source) */
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className="st-section">
      <header className="st-section__header">
        <div>
          <h3 className="st-section__title">{title}</h3>
          {description && <p className="st-section__desc">{description}</p>}
        </div>
        {actions && <div className="st-section__actions">{actions}</div>}
      </header>
      {children && <div className="st-section__body">{children}</div>}
    </section>
  );
}

/** A setting: title and what the current choice means on the left, the control on the right. */
export function OptionRow({ title, help, children }: { title: string; help?: ReactNode; children: ReactNode }) {
  return (
    <div className="st-row">
      <div className="st-row__label">
        <div className="st-row__title">{title}</div>
        {help && <div className="st-row__help">{help}</div>}
      </div>
      <div className="st-row__control">{children}</div>
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange, disabled }: {
  value: T;
  options: { id: T; label: string }[];
  onChange: (id: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className={`st-seg${disabled ? ' st-seg--disabled' : ''}`} role="radiogroup">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          role="radio"
          aria-checked={value === option.id}
          disabled={disabled}
          className={`st-seg__item${value === option.id ? ' st-seg__item--on' : ''}`}
          onClick={() => { if (value !== option.id) onChange(option.id); }}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** An on/off setting, as a two-way segmented control. */
export function OnOff({ value, onChange, offLabel = 'Off', onLabel = 'On', disabled }: {
  value: boolean;
  onChange: (value: boolean) => void;
  offLabel?: string;
  onLabel?: string;
  disabled?: boolean;
}) {
  return (
    <Segmented
      value={value ? 'on' : 'off'}
      options={[{ id: 'off', label: offLabel }, { id: 'on', label: onLabel }]}
      onChange={(id) => onChange(id === 'on')}
      disabled={disabled}
    />
  );
}

export function Button({ variant = 'default', className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'primary' | 'danger';
}) {
  return <button type="button" {...props} className={`st-btn st-btn--${variant}${className ? ` ${className}` : ''}`} />;
}

export function TextField({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`st-input${className ? ` ${className}` : ''}`} />;
}

export function Hint({ children, tone }: { children: ReactNode; tone?: 'ok' | 'warn' | 'danger' }) {
  return <p className={`st-hint${tone ? ` st-hint--${tone}` : ''}`}>{children}</p>;
}
