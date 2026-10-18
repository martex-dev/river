import { useState, type ReactElement, type ReactNode } from 'react';
import { BackIcon } from './icons.tsx';
import { phonePop } from './nav.ts';

/**
 * A tab's own page (2.12): a large title that gives way to a small one in the bar as the page
 * scrolls, like Telegram and the system apps on iPhone.
 */
export function TabPage(props: {
  title: string;
  /** Under the large title, e.g. "Connecting…". */
  subtitle?: ReactNode;
  start?: ReactNode;
  end?: ReactNode;
  children: ReactNode;
  className?: string;
}): ReactElement {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div className={`ptab ${collapsed ? 'is-collapsed' : ''} ${props.className ?? ''}`}>
      <header className="ptab__bar">
        <div className="ptab__side">{props.start}</div>
        <div className="ptab__small" aria-hidden="true">
          {props.title}
        </div>
        <div className="ptab__side ptab__side--end">{props.end}</div>
      </header>
      <div className="ptab__scroll" onScroll={(e) => setCollapsed(e.currentTarget.scrollTop > 34)}>
        <h1 className="ptab__title">{props.title}</h1>
        {props.subtitle && <div className="ptab__subtitle">{props.subtitle}</div>}
        {props.children}
      </div>
    </div>
  );
}

/** A pushed screen's bar: Back, a title (and a line under it), and buttons at the end. */
export function ScreenBar(props: {
  title: ReactNode;
  subtitle?: ReactNode;
  /** Shown left of the title (a community's icon). */
  picture?: ReactNode;
  end?: ReactNode;
  onTitle?: () => void;
  titleLabel?: string;
}): ReactElement {
  const text = (
    <span className="pchat-head__text">
      <strong>{props.title}</strong>
      {props.subtitle && <span className="pchat-head__status">{props.subtitle}</span>}
    </span>
  );
  return (
    <header className="pchat-head pscreen__bar">
      <button className="pchat-head__back" aria-label="Back" onClick={() => phonePop()}>
        <BackIcon size={26} />
      </button>
      {props.onTitle ? (
        <button className="pchat-head__who" aria-label={props.titleLabel} onClick={props.onTitle}>
          {props.picture}
          {text}
        </button>
      ) : (
        <span className="pchat-head__who">
          {props.picture}
          {text}
        </span>
      )}
      <span className="pchat-head__actions">{props.end}</span>
    </header>
  );
}

/** A screen with a bar and a page under it that scrolls (Friends, Files…). */
export function TitledScreen(props: { title: string; end?: ReactNode; children: ReactNode }): ReactElement {
  return (
    <div className="pscreen__frame">
      <ScreenBar title={props.title} end={props.end} />
      <div className="pscreen__body">{props.children}</div>
    </div>
  );
}

/** A count on a tab or row: "99+" past 99. */
export function countLabel(n: number): string {
  return n > 99 ? '99+' : String(n);
}
