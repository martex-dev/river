import { BrowserWindow, screen, session, type Display } from 'electron';

/**
 * Remote assistance, the part on the screen being shared (ADR 0007).
 *
 * While River shares a screen, a small always-on-top bar on that screen says
 * who can see it and has a Stop button. It cannot be hidden from River's UI and
 * closes only when sharing ends. A second, click-through layer covers the
 * shared screen and shows where the people watching point.
 *
 * Both are plain pages with no preload and no access to River: the bar talks
 * back only by navigating to `river-indicator:stop`, which is intercepted here.
 */

const PARTITION = 'river-indicator';
const STOP_URL = 'river-indicator:stop';
const BAR_WIDTH = 460;
const BAR_HEIGHT = 44;

const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function page(body: string, css: string, script = ''): string {
  const csp = "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src 'none'";
  return (
    'data:text/html;charset=utf-8,' +
    encodeURIComponent(
      `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><style>${css}</style></head><body>${body}<script>${script}</script></body></html>`,
    )
  );
}

function barPage(names: readonly string[]): string {
  const who = names.length ? names.map(escapeHtml).join(', ') : 'people in this call';
  return page(
    `<div class="bar"><span class="dot"></span><span class="text">${who} can see your screen</span><a class="stop" href="${STOP_URL}">Stop sharing</a></div>`,
    `html,body{margin:0;height:100%;background:transparent;font:13px/1.2 system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-user-select:none;user-select:none;overflow:hidden}
     .bar{box-sizing:border-box;height:100%;display:flex;align-items:center;gap:10px;padding:0 8px 0 14px;border-radius:10px;background:#b3261e;color:#fff;-webkit-app-region:drag}
     .dot{width:10px;height:10px;border-radius:50%;background:#fff;animation:p 1.4s infinite}
     @keyframes p{50%{opacity:.35}}
     .text{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:600}
     .stop{-webkit-app-region:no-drag;color:#b3261e;background:#fff;border-radius:6px;padding:6px 12px;font-weight:700;text-decoration:none}`,
  );
}

const OVERLAY = page(
  '',
  `html,body{margin:0;height:100%;background:transparent;overflow:hidden}
   .ping{position:fixed;width:56px;height:56px;margin:-28px 0 0 -28px;border-radius:50%;border:4px solid #ff3b30;box-shadow:0 0 0 3px #fff;animation:g 1.6s ease-out forwards;pointer-events:none}
   @keyframes g{0%{transform:scale(.3);opacity:1}70%{opacity:1}100%{transform:scale(1.4);opacity:0}}`,
  `window.ping=function(x,y){var d=document.createElement('div');d.className='ping';d.style.left=(x*100)+'%';d.style.top=(y*100)+'%';document.body.appendChild(d);setTimeout(function(){d.remove()},1700)};`,
);

function baseOptions(bounds: Electron.Rectangle): Electron.BrowserWindowConstructorOptions {
  return {
    ...bounds,
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    transparent: true,
    hasShadow: false,
    webPreferences: {
      partition: PARTITION,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      javascript: true,
      spellcheck: false,
    },
  };
}

export class ShareIndicator {
  private bar: BrowserWindow | null = null;
  private overlay: BrowserWindow | null = null;
  private lastPing = 0;
  private names: readonly string[] = [];

  private readonly onStop: () => void;

  constructor(onStop: () => void) {
    this.onStop = onStop;
    session.fromPartition(PARTITION).setPermissionRequestHandler((_wc, _p, cb) => cb(false));
  }

  /** Sharing started (or the viewers changed). `displayId` is the shared screen, if a whole screen. */
  show(displayId: string | null, names: readonly string[]): void {
    this.names = names;
    const display = this.display(displayId);
    const area = display.workArea;
    if (!this.bar || this.bar.isDestroyed()) {
      const bar = new BrowserWindow({
        ...baseOptions({
          x: Math.round(area.x + (area.width - BAR_WIDTH) / 2),
          y: area.y + 8,
          width: BAR_WIDTH,
          height: BAR_HEIGHT,
        }),
        focusable: false,
      });
      bar.setAlwaysOnTop(true, 'screen-saver');
      bar.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      bar.webContents.on('will-navigate', (event, url) => {
        event.preventDefault();
        if (url === STOP_URL) this.onStop();
      });
      bar.once('ready-to-show', () => bar.showInactive());
      // The bar must not vanish while sharing: if its page crashes or the window closes, bring it back.
      const revive = (): void => {
        if (this.bar !== bar) return;
        this.bar = null;
        if (!bar.isDestroyed()) bar.destroy();
        this.show(displayId, this.names);
      };
      bar.webContents.on('render-process-gone', revive);
      bar.on('closed', revive);
      this.bar = bar;
    }
    void this.bar.loadURL(barPage(names.slice(0, 8)));

    // Pointing only maps onto a whole screen (a shared window can move under it).
    if (displayId === null) {
      this.closeOverlay();
      return;
    }
    const b = display.bounds;
    if (this.overlay && !this.overlay.isDestroyed()) {
      this.overlay.setBounds(b);
      return;
    }
    const overlay = new BrowserWindow({ ...baseOptions(b), focusable: false });
    overlay.setIgnoreMouseEvents(true);
    overlay.setAlwaysOnTop(true, 'screen-saver');
    overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    overlay.webContents.on('will-navigate', (event) => event.preventDefault());
    overlay.once('ready-to-show', () => overlay.showInactive());
    void overlay.loadURL(OVERLAY);
    this.overlay = overlay;
  }

  /** Someone watching pointed at (x, y), fractions of the shared screen. */
  ping(x: number, y: number): void {
    const now = Date.now();
    if (now - this.lastPing < 150) return;
    this.lastPing = now;
    if (!this.overlay || this.overlay.isDestroyed()) return;
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) return;
    void this.overlay.webContents
      .executeJavaScript(`window.ping(${x.toFixed(4)},${y.toFixed(4)})`)
      .catch(() => undefined);
  }

  hide(): void {
    // Cleared first, so closing it here is not mistaken for a crash to recover from.
    const bar = this.bar;
    this.bar = null;
    if (bar && !bar.isDestroyed()) bar.destroy();
    this.closeOverlay();
  }

  private closeOverlay(): void {
    if (this.overlay && !this.overlay.isDestroyed()) this.overlay.destroy();
    this.overlay = null;
  }

  private display(displayId: string | null): Display {
    return screen.getAllDisplays().find((d) => String(d.id) === displayId) ?? screen.getPrimaryDisplay();
  }
}
