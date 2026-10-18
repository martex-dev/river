import { ask, handle, on, ui } from '../host.ts';
import { expectExport } from '../exports.ts';
import { native } from '../native.ts';
import { phonePlatform } from '../platform.ts';

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
  /**
   * The shell asks where to save (Android's document picker) and returns a path River may write
   * to. On iOS the path is private and marked `export`: the file is offered once written.
   */
  async showSaveDialog(a: unknown, b?: unknown): Promise<{ canceled: boolean; filePath?: string }> {
    const options = optionsOf<SaveOptions>(a, b);
    const name = (options.defaultPath ?? 'River file').split('/').pop() ?? 'River file';
    const choice = await ask<{ canceled: boolean; filePath?: string; export?: boolean }>('saveFile', {
      name,
      filters: options.filters ?? [],
    });
    if (!choice.canceled && choice.filePath && choice.export === true) expectExport(choice.filePath);
    return { canceled: choice.canceled, ...(choice.filePath ? { filePath: choice.filePath } : {}) };
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
/** A button on it (2.17: Mark as read), by its index. */
type ActionListener = (event: unknown, index: number) => void;

/**
 * Set by the desktop's notifications.ts (PhoneHints): grouping, lock-screen privacy, waking the
 * screen, and (2.17) the conversation's sound and how many messages it stands for.
 */
interface PhoneHints {
  conversation: string;
  sender: string | null;
  group: string | null;
  lockScreen: boolean;
  wake: boolean;
  sound?: string;
  count?: number;
}

export class Notification {
  /** Assigned after construction by notifications.ts; Electron's own Notification ignores it. */
  phoneHints?: PhoneHints;
  /** Names it, so close() can take it away again (an incoming call's notification). */
  phoneTag?: string;
  private shown = false;
  private readonly options: {
    title: string;
    body: string;
    reply: boolean;
    call: boolean;
    markRead: boolean;
  };
  private readonly clicks: ClickListener[] = [];
  private readonly replies: ReplyListener[] = [];
  private readonly actions: ActionListener[] = [];
  private readonly closes: ClickListener[] = [];
  constructor(options: {
    title: string;
    body: string;
    silent?: boolean;
    hasReply?: boolean;
    urgency?: 'normal' | 'critical' | 'low';
    actions?: Array<{ type: 'button'; text: string }>;
  }) {
    this.options = {
      title: options.title,
      body: options.body,
      reply: options.hasReply === true,
      // A critical notification is an incoming call: phones ring for it.
      call: options.urgency === 'critical',
      // Its one button is Mark as read (notifications.ts, 2.17), shown next to Reply.
      markRead: (options.actions?.length ?? 0) > 0,
    };
  }
  static isSupported(): boolean {
    return true;
  }
  on(event: 'click' | 'close', listener: ClickListener): this;
  on(event: 'reply', listener: ReplyListener): this;
  on(event: 'action', listener: ActionListener): this;
  on(event: string, listener: ClickListener | ReplyListener | ActionListener): this;
  on(event: string, listener: ClickListener | ReplyListener | ActionListener): this {
    if (event === 'click') this.clicks.push(listener as ClickListener);
    if (event === 'reply') this.replies.push(listener as ReplyListener);
    if (event === 'action') this.actions.push(listener as ActionListener);
    // Swiped away, or replaced by its conversation's next notification.
    if (event === 'close') this.closes.push(listener as ClickListener);
    return this;
  }
  show(): void {
    // Android rings for calls with its own call screen (the core asks for it: main.ts), not with a
    // second, ordinary notification.
    if (this.options.call && phonePlatform() === 'android') return;
    const h = this.phoneHints;
    this.shown = true;
    const args = {
      ...this.options,
      ...(this.phoneTag ? { tag: String(this.phoneTag).slice(0, 200) } : {}),
      ...(h
        ? {
            conversation: String(h.conversation).slice(0, 200),
            sender: h.sender,
            group: h.group,
            lockScreen: h.lockScreen === true,
            wake: h.wake === true,
            sound: typeof h.sound === 'string' ? h.sound.slice(0, 32) : 'default',
            count: Number.isInteger(h.count) && h.count! > 0 ? Math.min(h.count!, 999) : 1,
          }
        : { lockScreen: false, wake: false }),
    };
    void ask<string | { reply?: unknown; action?: unknown }>('notify', args).then(
      (result) => {
        if (result === 'clicked') for (const fn of this.clicks) fn();
        else if (result === 'dismissed') for (const fn of this.closes) fn();
        else if (result && typeof result === 'object' && typeof result.reply === 'string') {
          for (const fn of this.replies) fn({}, result.reply);
        } else if (result && typeof result === 'object' && result.action === 'read') {
          for (const fn of this.actions) fn({}, 0);
        }
      },
      () => undefined,
    );
  }
  /** Takes a named notification away (the iPhone shell; Android rings calls with its own screen). */
  close(): void {
    if (!this.shown || !this.phoneTag) return;
    this.shown = false;
    void ask('notifyClose', { tag: String(this.phoneTag).slice(0, 200) }).catch(() => undefined);
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
