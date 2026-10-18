import { create } from 'zustand';

/**
 * Which link's whole address is shown (2.19), for links a message shows shortened: right-click
 * one on a computer, long-press it on a phone. The sheet itself is LinkSheet (link-sheet.tsx).
 */
export const useLinkSheet = create<{ url: string; x: number; y: number } | { url: null }>(() => ({
  url: null,
}));

export function openLinkSheet(url: string, x: number, y: number): void {
  useLinkSheet.setState({ url, x, y });
}

export function closeLinkSheet(): void {
  useLinkSheet.setState({ url: null });
}
