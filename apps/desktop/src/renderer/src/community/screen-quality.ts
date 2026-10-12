/** Screen sharing quality (1.0.25): what to favour, as capture constraints. */
export type ScreenQuality = 'detail' | 'balanced' | 'motion';

export const SCREEN_QUALITIES: Array<{ id: ScreenQuality; label: string; hint: string }> = [
  { id: 'detail', label: 'Sharp text', hint: 'Up to 1080p, 15 fps — documents and code' },
  { id: 'balanced', label: 'Balanced', hint: 'Up to 720p, 30 fps — most things' },
  { id: 'motion', label: 'Smooth motion', hint: 'Up to 1080p, 60 fps — games and video' },
];

export function screenConstraints(q: ScreenQuality): {
  video: MediaTrackConstraints;
  contentHint: 'detail' | 'motion';
} {
  switch (q) {
    case 'detail':
      return {
        video: { width: { max: 1920 }, height: { max: 1080 }, frameRate: { ideal: 15, max: 15 } },
        contentHint: 'detail',
      };
    case 'motion':
      return {
        video: { width: { max: 1920 }, height: { max: 1080 }, frameRate: { ideal: 60, max: 60 } },
        contentHint: 'motion',
      };
    default:
      return {
        video: { width: { max: 1280 }, height: { max: 720 }, frameRate: { ideal: 30, max: 30 } },
        contentHint: 'detail',
      };
  }
}

const KEY = 'river.screenQuality';

export function savedQuality(): ScreenQuality {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'detail' || v === 'motion' || v === 'balanced' ? v : 'balanced';
  } catch {
    return 'balanced';
  }
}

export function saveQuality(q: ScreenQuality): void {
  try {
    localStorage.setItem(KEY, q);
  } catch {
    // not remembered
  }
}
