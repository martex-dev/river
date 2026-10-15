import { ask, handle, on, ui } from '../host.ts';
import { native } from '../native.ts';

/**
 * The few Electron main-process APIs River's IPC layer touches, mapped to the
 * phone. Windows, tray and title bars do not exist here; dialogs and links go
 * to the app shell, which shows native Android UI.
 */

declare const __RIVER_VERSION__: string;

export const ipcMain = {
  handle,
  on,
  removeHandler: (): void => undefined,
};

let paths: { data: string; cache: string; documents: string; downloads: string } | null = null;
const pathsOf = (): NonNullable<typeof paths> => (paths ??= native('fs.paths', {}));

export const app = {
  isPackaged: true,
  getName: (): string => 'River',
  getVersion: (): string => __RIVER_VERSION__,
  getPath(name: string): string {
    const p = pathsOf();
    switch (name) {
      case 'userData':
      case 'appData':
        return p.data;
      case 'temp':
      case 'cache':
      case 'logs':
        return p.cache;
      case 'documents':
        return p.documents;
      case 'downloads':
        return p.downloads;
      default:
        return p.data;
    }
  },
};

export const BrowserWindow = {
  fromWebContents: (): null => null,
};

interface SaveOptions {
  defaultPath?: string;
  filters?: Array<{ name: string; extensions: string[] }>;
}

interface MessageOptions {
  type?: string;
  title?: string;
  message: string;
  detail?: string;
  buttons?: string[];
  defaultId?: number;
  cancelId?: number;
}

const optionsOf = <T>(a: unknown, b: unknown): T => (b === undefined ? a : b) as T;

export const dialog = {
  /** The shell asks where to save (Android's document picker) and returns a path River may write to. */
  async showSaveDialog(a: unknown, b?: unknown): Promise<{ canceled: boolean; filePath?: string }> {
    const options = optionsOf<SaveOptions>(a, b);
    const name = (options.defaultPath ?? 'River file').split('/').pop() ?? 'River file';
    return ask('saveFile', { name, filters: options.filters ?? [] });
  },
  async showMessageBox(a: unknown, b?: unknown): Promise<{ response: number }> {
    const options = optionsOf<MessageOptions>(a, b);
    return ask('messageBox', {
      title: options.title ?? 'River',
      message: options.message,
      detail: options.detail ?? '',
      buttons: options.buttons ?? ['OK'],
      cancelId: options.cancelId ?? -1,
    });
  },
};

export const shell = {
  async openExternal(url: string): Promise<void> {
    await ask('openUrl', { url });
  },
  async openPath(): Promise<string> {
    return 'Opening folders is not available on phones';
  },
  showItemInFolder(): void {},
};

export const clipboard = {
  writeText(text: string): void {
    void ask('clipboard', { text });
  },
};

/** Screen sharing on phones uses the browser's own picker (getDisplayMedia); there is no source list. */
export const desktopCapturer = {
  async getSources(): Promise<never[]> {
    return [];
  },
};

export const webContents = { getAllWebContents: () => [ui] };

type ClickListener = () => void;

/** A system notification, shown by the app shell; tapping it opens River and runs the click handler. */
type ReplyListener = (event: unknown, reply: string) => void;

export class Notification {
  private readonly options: { title: string; body: string; reply: boolean };
  private readonly clicks: ClickListener[] = [];
  private readonly replies: ReplyListener[] = [];
  constructor(options: { title: string; body: string; silent?: boolean; hasReply?: boolean }) {
    this.options = { title: options.title, body: options.body, reply: options.hasReply === true };
  }
  static isSupported(): boolean {
    return true;
  }
  on(event: 'click', listener: ClickListener): this;
  on(event: 'reply', listener: ReplyListener): this;
  on(event: 'click' | 'reply', listener: ClickListener | ReplyListener): this {
    if (event === 'click') this.clicks.push(listener as ClickListener);
    if (event === 'reply') this.replies.push(listener as ReplyListener);
    return this;
  }
  show(): void {
    void ask<string | { reply?: unknown }>('notify', this.options).then(
      (result) => {
        if (result === 'clicked') for (const fn of this.clicks) fn();
        else if (result && typeof result === 'object' && typeof result.reply === 'string') {
          for (const fn of this.replies) fn({}, result.reply);
        }
      },
      () => undefined,
    );
  }
}

/** Imported by the desktop's protocol/session hardening, which the phone does not run. */
export const protocol = {};
export const session = {};

export default {
  ipcMain,
  app,
  BrowserWindow,
  dialog,
  shell,
  clipboard,
  desktopCapturer,
  webContents,
  Notification,
  protocol,
  session,
};
