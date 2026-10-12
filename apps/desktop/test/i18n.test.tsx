import { describe, expect, it } from 'vitest';
import { LANGUAGES, coverage, resolveLanguage, translate } from '../src/renderer/src/i18n.ts';

describe('languages', () => {
  it('follows the system only when asked, and falls back to English', () => {
    expect(resolveLanguage('system', 'bg-BG')).toBe('bg');
    expect(resolveLanguage('system', 'de-DE')).toBe('en');
    expect(resolveLanguage('en', 'bg-BG')).toBe('en');
    expect(resolveLanguage('bg', 'en-US')).toBe('bg');
  });

  it('translates known texts and leaves others in English', () => {
    expect(translate('bg', 'Settings')).toBe('Настройки');
    expect(translate('bg', 'Something not translated yet')).toBe('Something not translated yet');
    expect(translate('en', 'Settings')).toBe('Settings');
  });

  it('marks partial translations as beta', () => {
    expect(coverage('en')).toBe(1);
    expect(LANGUAGES.find((l) => l.id === 'bg')?.beta).toBe(true);
  });
});
