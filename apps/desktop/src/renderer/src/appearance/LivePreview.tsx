import { useMemo, type CSSProperties, type ReactElement } from 'react';
import type { DesignSettings } from '../../../shared/design.ts';
import { isPhone } from '../../../shared/platform.ts';
import { useRiver } from '../store.ts';
import { resolveDesign } from './engine.ts';
import { useWallpaperLayers } from './use-wallpaper.ts';
import { colorsOf } from './wallpaper.ts';
import { tr } from '../i18n.ts';

/**
 * A sample chat at the top of Appearance (2.18) that follows every choice at once: theme and
 * accent, wallpaper, bubble shape, message style and side, picture shape, text size, density and
 * Calm mode. Drawn with the look's own tokens (like the theme cards), so it shows exactly what
 * the conversation will look like. Decorative: hidden from screen readers.
 */
export function LivePreview({ design }: { design: DesignSettings }): ReactElement {
  const r = useMemo(() => resolveDesign(design), [design]);
  const phone = useRiver((s) => isPhone(s.info?.platform));
  const fontSize = useRiver((s) => s.settings?.appearance.fontSize ?? 14);
  const density = useRiver((s) => s.settings?.appearance.density ?? 'cozy');
  const calm = useRiver((s) => s.settings?.appearance.calm ?? false);
  const colors = useMemo(() => colorsOf(r.vars, r.mode), [r]);
  const layers = useWallpaperLayers(design, design.prefs.wallpaper, colors);
  const style = useMemo(
    () =>
      ({
        ...r.vars,
        '--lp-font': `${phone ? fontSize + 2 : fontSize}px`,
        '--lp-wp': layers?.background ?? 'none',
      }) as CSSProperties,
    [r, phone, fontSize, layers],
  );
  // Phones always show Telegram's bubbles; computers show the chosen message style.
  const msg = phone ? 'bubbles' : (r.attrs.msg ?? 'flat');
  return (
    <div
      className="lp"
      style={style}
      aria-hidden="true"
      data-msg={msg}
      data-bubbles={design.prefs.bubbles}
      data-own={r.attrs.own}
      data-avatar={r.attrs.avatar}
      data-density={density}
      data-calm={calm ? 'on' : 'off'}
      data-wp={layers?.kind ?? 'none'}
      data-wp-plate={layers?.plate ? 'on' : undefined}
    >
      <div className="lp__head">
        <i className="lp__av lp__av--ana" />
        <span className="lp__who">
          <b>Ana</b>
          <span className="lp__status">{tr('typing…')}</span>
        </span>
      </div>
      <div className="lp__chat">
        <span className="lp__day">{tr('Today')}</span>
        <div className="lp__msg">
          <i className="lp__av lp__av--ana" />
          <div className="lp__bubble">
            <b className="lp__name">Ana</b>
            <span className="lp__text">{tr('Did you see the new wallpapers? 😍')}</span>
            <span className="lp__meta">9:41</span>
            <span className="lp__reaction">
              ❤️ <span>2</span>
            </span>
          </div>
        </div>
        <div className="lp__msg lp__msg--mine">
          <i className="lp__av lp__av--me" />
          <div className="lp__bubble">
            <b className="lp__name">{tr('You')}</b>
            <span className="lp__text">{tr('Yes! Trying the doodles now 🎨')}</span>
            <span className="lp__meta">9:42 ✓✓</span>
          </div>
        </div>
        <div className="lp__msg lp__msg--typing">
          <i className="lp__av lp__av--ana" />
          <div className="lp__bubble">
            <span className="lp__dots">
              <i />
              <i />
              <i />
            </span>
          </div>
        </div>
      </div>
      <div className="lp__bar">
        <span className="lp__input">{tr('Message')}</span>
        <span className="lp__send">➤</span>
      </div>
    </div>
  );
}
