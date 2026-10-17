import { useRiver } from './store.ts';

/**
 * Languages (1.0.27). English text is the key; a translation that is missing
 * falls back to English, so nothing is ever blank. Translations are added
 * screen by screen.
 */
export type Language = 'en' | 'bg';

export const LANGUAGES: Array<{ id: Language; name: string; beta?: boolean }> = [
  { id: 'en', name: 'English' },
  { id: 'bg', name: 'Български', beta: true },
];

const BG: Record<string, string> = {
  // Navigation
  Home: 'Начало',
  Messages: 'Съобщения',
  Communities: 'Общности',
  Social: 'Социални',
  Calls: 'Обаждания',
  Files: 'Файлове',
  Friends: 'Приятели',
  Admin: 'Администрация',
  Security: 'Сигурност',
  Settings: 'Настройки',
  // Settings tabs and headings
  Updates: 'Обновления',
  Hosting: 'Хостване',
  Account: 'Акаунт',
  Profile: 'Профил',
  Backup: 'Резервно копие',
  Appearance: 'Външен вид',
  Notifications: 'Известия',
  System: 'Система',
  About: 'Относно',
  Language: 'Език',
  'Follow my system': 'Според системата',
  'Interface size': 'Размер на интерфейса',
  'Message text size': 'Размер на текста',
  'Message density': 'Гъстота на съобщенията',
  Motion: 'Движение',
  Contrast: 'Контраст',
  Clock: 'Часовник',
  // Common buttons
  Save: 'Запази',
  Cancel: 'Отказ',
  Close: 'Затвори',
  Delete: 'Изтрий',
  'Save changes': 'Запази промените',
  Reset: 'Върни',
  'Careful — you have unsaved changes!': 'Внимание — имате незапазени промени!',
  // Community sidebar and menus
  'Invite people': 'Покани хора',
  'Community settings': 'Настройки на общността',
  'Create channel': 'Създай канал',
  'Create category': 'Създай категория',
  'Mark as read': 'Маркирай като прочетено',
  'Leave community': 'Напусни общността',
  'Edit channel': 'Редактирай канала',
  'Duplicate channel': 'Дублирай канала',
  'Pick your roles': 'Избери ролите си',
  // Chat
  Reply: 'Отговори',
  'Edit message': 'Редактирай',
  'Delete message': 'Изтрий съобщението',
  'Copy message link': 'Копирай връзка',
  'Mark unread': 'Маркирай като непрочетено',
  'Save message': 'Запази съобщението',
  'Remove from saved': 'Премахни от запазените',
  'Report message': 'Докладвай',
  'Pin message': 'Закачи',
  'Unpin message': 'Откачи',
  Search: 'Търсене',
  'Saved messages': 'Запазени съобщения',
  'Pinned messages': 'Закачени съобщения',
  'Member list': 'Членове',
  // Voice
  Mute: 'Без звук',
  Unmute: 'Със звук',
  Deafen: 'Заглуши',
  Undeafen: 'Чуй отново',
  Leave: 'Напусни',
  Soundboard: 'Звуци',
  'Share screen': 'Сподели екрана',
  'Stop sharing': 'Спри споделянето',
  'Camera on': 'Включи камерата',
  'Camera off': 'Изключи камерата',
  // Community settings (1.0.36)
  Overview: 'Общ преглед',
  'Rules & roles': 'Правила и роли',
  Roles: 'Роли',
  Members: 'Членове',
  Emoji: 'Емоджи',
  Stickers: 'Стикери',
  Bans: 'Забрани',
  Invites: 'Покани',
  Webhooks: 'Уебхукове',
  Reports: 'Доклади',
  Insights: 'Статистика',
  'Audit log': 'Дневник на действията',
  'Create role': 'Създай роля',
  'Edit role': 'Редактирай ролята',
  'View role': 'Виж ролята',
  'Delete role': 'Изтрий ролята',
  'Create webhook': 'Създай уебхук',
  // Categories (1.0.36)
  'Mark category as read': 'Маркирай категорията като прочетена',
  'Collapse category': 'Свий категорията',
  'Expand category': 'Разгъни категорията',
  'Edit category': 'Редактирай категорията',
  // Voice panel (1.0.36)
  'Voice connected': 'Гласът е свързан',
  Disconnect: 'Прекъсни',
  Rejoin: 'Влез отново',
  'Call ended unexpectedly': 'Разговорът прекъсна неочаквано',
  Dismiss: 'Скрий',
  'Priority speaker': 'Приоритетен говорител',
  // Status
  Online: 'На линия',
  Idle: 'Неактивен',
  'Do Not Disturb': 'Не безпокойте',
  Invisible: 'Невидим',
};

const DICTS: Record<Language, Record<string, string>> = { en: {}, bg: BG };

/** The language in use for a setting ("system" follows the computer's language). */
export function resolveLanguage(setting: string | undefined, system = navigator.language): Language {
  if (setting === 'en' || setting === 'bg') return setting;
  return system.toLowerCase().startsWith('bg') ? 'bg' : 'en';
}

export function translate(lang: Language, text: string): string {
  return DICTS[lang][text] ?? text;
}

/** How many of the known texts a language has (for the "beta" label and tests). */
export function coverage(lang: Language): number {
  const keys = Object.keys(BG);
  return lang === 'en' ? 1 : keys.filter((k) => DICTS[lang][k]).length / keys.length;
}

/** Translate in a component; re-renders when the language changes. */
export function useT(): (text: string) => string {
  const setting = useRiver((r) => r.settings?.appearance.language);
  const lang = resolveLanguage(setting);
  return (text) => translate(lang, text);
}

/** Translate outside hooks (menus, labels). App re-renders everything when the language changes. */
export function tr(text: string): string {
  return translate(resolveLanguage(useRiver.getState().settings?.appearance.language), text);
}
