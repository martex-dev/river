import type { ReactElement } from 'react';
import { MenuItem, openLink, Popover } from '../community/ui/common.tsx';
import { useCommunity } from '../community/store.ts';
import { closeLinkSheet, useLinkSheet } from './link-sheet-store.ts';

/**
 * A link's whole address (2.19), for the links a message shows shortened: right-click it on a
 * computer, long-press it on a phone. From there it opens (after River's usual question) or is
 * copied — the address in full, so you see where it goes before you go.
 */
function label(url: string): { open: string; copy: string } {
  if (url.startsWith('mailto:')) return { open: 'Write an email', copy: 'Copy email address' };
  if (url.startsWith('tel:')) return { open: 'Call', copy: 'Copy phone number' };
  return { open: 'Open link', copy: 'Copy link' };
}

/** Mounted once with the app's overlays. */
export function LinkSheet(): ReactElement | null {
  const sheet = useLinkSheet();
  if (sheet.url === null) return null;
  const { url } = sheet;
  const words = label(url);
  const shown = url.replace(/^(mailto|tel):/, '');
  return (
    <Popover x={sheet.x} y={sheet.y} onClose={closeLinkSheet} className="menu link-sheet">
      <div className="link-sheet__url" title={shown}>
        {shown}
      </div>
      <MenuItem
        icon={<span aria-hidden="true">↗</span>}
        onClick={() => {
          closeLinkSheet();
          openLink(url);
        }}
      >
        {words.open}
      </MenuItem>
      <MenuItem
        icon={<span aria-hidden="true">📋</span>}
        onClick={() => {
          closeLinkSheet();
          void navigator.clipboard
            ?.writeText(shown)
            .then(() => useCommunity.getState().notify('Copied.'))
            .catch(() => undefined);
        }}
      >
        {words.copy}
      </MenuItem>
    </Popover>
  );
}
