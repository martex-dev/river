/**
 * Which phone the core runs on. The iOS shell sets `window.__riverPlatform`
 * before any script runs: an iPad's WebView reports a Mac user agent, so the
 * user agent alone would take it for Android. Without the global (Android, or
 * a test on a computer) the user agent decides, as before.
 */
export type PhonePlatform = 'ios' | 'android';

export function phonePlatform(): PhonePlatform {
  const g = globalThis as { __riverPlatform?: unknown; navigator?: { userAgent?: string } };
  if (g.__riverPlatform === 'ios' || g.__riverPlatform === 'android') return g.__riverPlatform;
  return /iPhone|iPad|iPod/.test(g.navigator?.userAgent ?? '') ? 'ios' : 'android';
}
