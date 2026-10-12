/** @vitest-environment jsdom */
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { replaceCustomShortcodes } from '../src/renderer/src/community/emoji-data.ts';
import { emojiNameFrom } from '../src/renderer/src/community/ui/EmojiSettings.tsx';
import { CUSTOM_EMOJI, RichText, customEmojiText } from '../src/renderer/src/community/ui/common.tsx';
import { useCommunity } from '../src/renderer/src/community/store.ts';

afterEach(cleanup);
const parrot = { id: 'P'.repeat(22), name: 'party_parrot', image: 'data:image/png;base64,AAAA' };

describe('custom emoji', () => {
  it('turn :name: into the community emoji when sending, but not inside code', () => {
    expect(replaceCustomShortcodes('yes :party_parrot: and `:party_parrot:`', [parrot])).toBe(
      `yes ${customEmojiText(parrot)} and \`:party_parrot:\``,
    );
    expect(replaceCustomShortcodes(':unknown:', [parrot])).toBe(':unknown:');
    expect(CUSTOM_EMOJI.exec(customEmojiText(parrot))?.slice(1)).toEqual(['party_parrot', parrot.id]);
  });

  it('render as pictures once known, as :name: until then, and big when alone', () => {
    useCommunity.setState({ emojis: {} });
    const { container, rerender } = render(
      <RichText text={`hi ${customEmojiText(parrot)}`} names={[]} me={null} />,
    );
    expect(container.textContent).toBe('hi :party_parrot:');
    useCommunity.setState({ emojis: { c: [parrot] } });
    rerender(<RichText text={customEmojiText(parrot)} names={[]} me={null} />);
    const img = container.querySelector('img.custom-emoji')!;
    expect(img.getAttribute('alt')).toBe(':party_parrot:');
    expect(img.classList.contains('custom-emoji--big')).toBe(true);
  });

  it('get a name from the file', () => {
    expect(emojiNameFrom('party parrot.gif')).toBe('party_parrot');
    expect(emojiNameFrom('x.png')).toBe('emoji_x');
  });
});
