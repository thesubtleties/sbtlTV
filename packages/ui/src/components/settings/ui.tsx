/**
 * Settings building blocks, in shtl's style: sections separated by hairlines,
 * rows with a title column whose help explains the current choice, and
 * segmented controls instead of switches and dropdowns.
 */
import type { ButtonHTMLAttributes, CSSProperties, InputHTMLAttributes, ReactNode } from 'react';
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

export function Segmented<T extends string>({ value, options, onChange, disabled, compact }: {
  value: T;
  options: { id: T; label: string }[];
  onChange: (id: T) => void;
  disabled?: boolean;
  /** Narrow segments sized to their labels, for longer option lists */
  compact?: boolean;
}) {
  return (
    <div className={`st-seg${compact ? ' st-seg--compact' : ''}${disabled ? ' st-seg--disabled' : ''}`} role="radiogroup">
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

/** A slider with its current value shown beside it. */
export function Slider({ value, min, max, step, onChange, format, label }: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  format: (value: number) => string;
  label: string;
}) {
  const fill = ((value - min) / (max - min)) * 100;
  return (
    <div className="st-slider">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        style={{ '--fill': `${fill}%` } as CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="st-slider__value">{format(value)}</span>
    </div>
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

/** A secret key field with a Save button that validates it. */
export function KeyField({ value, placeholder, validating, valid, onChange, onSave, label }: {
  value: string;
  placeholder: string;
  validating: boolean;
  /** null: not checked since the last edit */
  valid: boolean | null;
  onChange: (value: string) => void;
  onSave: () => void;
  label: string;
}) {
  return (
    <>
      <div className="st-keyfield">
        <TextField
          type="password"
          value={value}
          placeholder={placeholder}
          aria-label={label}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !validating) onSave(); }}
        />
        <Button variant="primary" onClick={onSave} disabled={validating}>
          {validating ? 'Checking…' : 'Save'}
        </Button>
      </div>
      {valid === true && <Hint tone="ok">{value ? 'Key saved.' : 'No key saved.'}</Hint>}
      {valid === false && <Hint tone="danger">That key was not accepted. Check it and try again.</Hint>}
    </>
  );
}

export function Hint({ children, tone }: { children: ReactNode; tone?: 'ok' | 'warn' | 'danger' }) {
  return <p className={`st-hint${tone ? ` st-hint--${tone}` : ''}`}>{children}</p>;
}
