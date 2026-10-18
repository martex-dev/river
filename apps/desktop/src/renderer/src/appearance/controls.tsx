import type { ReactElement, ReactNode } from 'react';

/** The Appearance centre's building blocks: groups, labelled rows, segmented choices, sliders. */

export const pct = (v: number): string => `${Math.round(v * 100)}%`;

export function Group(props: { children: ReactNode }): ReactElement {
  return <div className="design-group">{props.children}</div>;
}

export function Row(props: { label: string; children: ReactNode }): ReactElement {
  return (
    <div className="design-row">
      <span className="design-row__label">{props.label}</span>
      {props.children}
    </div>
  );
}

export function Choice<T extends string>(props: {
  value: T;
  options: ReadonlyArray<readonly [T, string]>;
  onChange(v: T): void;
  label?: string;
}): ReactElement {
  return (
    <div className="seg seg--wrap" role="radiogroup" aria-label={props.label}>
      {props.options.map(([id, label]) => (
        <button
          key={id}
          role="radio"
          aria-checked={props.value === id}
          className={`seg__item ${props.value === id ? 'is-active' : ''}`}
          onClick={() => props.onChange(id)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export function Slider(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format?: (v: number) => string;
  onChange(v: number): void;
}): ReactElement {
  return (
    <label className="design-slider">
      <span className="design-row__label">
        {props.label}{' '}
        <span className="muted small">{props.format ? props.format(props.value) : props.value}</span>
      </span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        aria-label={props.label}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
    </label>
  );
}
