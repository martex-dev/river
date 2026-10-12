/**
 * Back / forward through the places you opened (1.0.20), like a browser:
 * Alt+← / Alt+→ (⌘[ / ⌘] on a Mac) and the mouse's back and forward buttons.
 */
import { useCommunity } from './community/store.ts';
import { useDm } from './dm/store.ts';
import { useRiver, type Section } from './store.ts';

export interface Place {
  section: Section;
  communityId?: string | null;
  channelId?: string | null;
  peer?: string | null;
}

const LIMIT = 50;

export const samePlace = (a: Place, b: Place): boolean =>
  a.section === b.section &&
  (a.communityId ?? null) === (b.communityId ?? null) &&
  (a.channelId ?? null) === (b.channelId ?? null) &&
  (a.peer ?? null) === (b.peer ?? null);

/** Pure history list: visit, back, forward. */
export class NavHistory {
  private entries: Place[] = [];
  private index = -1;

  visit(p: Place): void {
    const here = this.entries[this.index];
    if (here && samePlace(here, p)) return;
    this.entries = [...this.entries.slice(0, this.index + 1), p].slice(-LIMIT);
    this.index = this.entries.length - 1;
  }

  /** Moves and returns the place to show, skipping ones `valid` rejects. */
  go(step: -1 | 1, valid: (p: Place) => boolean = () => true): Place | null {
    let i = this.index + step;
    while (i >= 0 && i < this.entries.length) {
      const p = this.entries[i]!;
      if (valid(p)) {
        this.index = i;
        return p;
      }
      this.entries.splice(i, 1);
      if (step === -1) {
        this.index--;
        i--;
      }
    }
    return null;
  }

  canGo(step: -1 | 1): boolean {
    const i = this.index + step;
    return i >= 0 && i < this.entries.length;
  }
}

function currentPlace(): Place {
  const section = useRiver.getState().section;
  if (section === 'communities') {
    const c = useCommunity.getState();
    return { section, communityId: c.selectedCommunity, channelId: c.selectedChannel };
  }
  if (section === 'messages') return { section, peer: useDm.getState().selected };
  return { section };
}

function stillThere(p: Place): boolean {
  if (p.section === 'communities' && p.communityId) {
    const c = useCommunity.getState().communities.find((x) => x.id === p.communityId);
    return !!c && (!p.channelId || c.channels.some((ch) => ch.id === p.channelId));
  }
  if (p.section === 'messages' && p.peer)
    return useDm.getState().conversations.some((c) => c.riverId === p.peer);
  return true;
}

const history = new NavHistory();
let applying = false;
let queued = false;

function record(): void {
  if (applying || queued) return;
  // One place per user action: select() sets the community and then the channel.
  queued = true;
  queueMicrotask(() => {
    queued = false;
    if (!applying) history.visit(currentPlace());
  });
}

function show(p: Place): void {
  applying = true;
  try {
    useRiver.getState().navigate(p.section);
    if (p.section === 'communities' && p.communityId) {
      const c = useCommunity.getState();
      if (c.selectedCommunity !== p.communityId) c.select(p.communityId, p.channelId ?? undefined);
      else if (p.channelId && c.selectedChannel !== p.channelId) c.selectChannel(p.channelId);
    } else if (p.section === 'messages' && p.peer && useDm.getState().selected !== p.peer) {
      useDm.getState().select(p.peer);
    }
  } finally {
    queueMicrotask(() => {
      applying = false;
    });
  }
}

export function goBack(): boolean {
  const p = history.go(-1, stillThere);
  if (p) show(p);
  return !!p;
}

export function goForward(): boolean {
  const p = history.go(1, stillThere);
  if (p) show(p);
  return !!p;
}

/** Is this key press "back" or "forward"? */
export function navKey(
  e: Pick<KeyboardEvent, 'key' | 'altKey' | 'metaKey' | 'ctrlKey' | 'shiftKey'>,
  mac: boolean,
): -1 | 1 | 0 {
  if (mac) {
    if (e.metaKey && !e.altKey && !e.ctrlKey && !e.shiftKey && (e.key === '[' || e.key === ']'))
      return e.key === '[' ? -1 : 1;
    return 0;
  }
  if (
    e.altKey &&
    !e.ctrlKey &&
    !e.metaKey &&
    !e.shiftKey &&
    (e.key === 'ArrowLeft' || e.key === 'ArrowRight')
  )
    return e.key === 'ArrowLeft' ? -1 : 1;
  return 0;
}

/** Starts recording and listening; returns a cleanup function. */
export function startNavHistory(): () => void {
  history.visit(currentPlace());
  const unsubs = [
    useRiver.subscribe((s, p) => s.section !== p.section && record()),
    useCommunity.subscribe(
      (s, p) =>
        (s.selectedCommunity !== p.selectedCommunity || s.selectedChannel !== p.selectedChannel) && record(),
    ),
    useDm.subscribe((s, p) => s.selected !== p.selected && record()),
  ];
  const mac = navigator.platform.toLowerCase().includes('mac');
  const onKey = (e: KeyboardEvent): void => {
    const step = navKey(e, mac);
    if (!step) return;
    const t = e.target as HTMLElement | null;
    // In a text box Alt+← and ⌘[ belong to the text.
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if ((step === -1 ? goBack : goForward)()) e.preventDefault();
  };
  const onMouse = (e: MouseEvent): void => {
    if (e.button !== 3 && e.button !== 4) return;
    e.preventDefault();
    if (e.button === 3) goBack();
    else goForward();
  };
  window.addEventListener('keydown', onKey);
  window.addEventListener('mouseup', onMouse);
  return () => {
    unsubs.forEach((u) => u());
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('mouseup', onMouse);
  };
}
