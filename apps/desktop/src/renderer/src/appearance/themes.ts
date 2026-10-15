/**
 * The palette catalog (1.0.46). Every skin has its own palettes: the eleven
 * skins and their palettes come from Specter (martex-dev/specter, MIT, same
 * author), plus Luxury, Corporate and Nature. A palette gives the four layered
 * surfaces (rail -> sidebar -> conversation -> raised), text and accents, and
 * optionally its own secondary text, status colours and button ink; anything
 * missing is derived by the engine, which also keeps all text readable.
 */

export interface Theme {
  id: string;
  skin: string;
  name: string;
  mode: 'dark' | 'light';
  description: string;
  /** Rail and window frame. */
  bg: string;
  /** Sidebars. */
  surface: string;
  /** The conversation. */
  base: string;
  /** Cards, inputs, popovers. */
  raised: string;
  text: string;
  accent: string;
  accent2: string;
  /** Optional palette-specific values (Specter palettes carry them). */
  dim?: string;
  faint?: string;
  accent3?: string;
  ink?: string;
  ok?: string;
  warn?: string;
  danger?: string;
}

type Extra = Partial<Pick<Theme, 'dim' | 'faint' | 'accent3' | 'ink' | 'ok' | 'warn' | 'danger'>>;
type Row = [id: string, name: string, mode: 'dark' | 'light', colors: string, extra?: Extra | string];

function family(skin: string, rows: Row[]): Theme[] {
  return rows.map(([id, name, mode, colors, extra]) => {
    const [bg, surface, base, raised, text, accent, accent2] = colors.split(' ') as [
      string,
      string,
      string,
      string,
      string,
      string,
      string,
    ];
    const more: Extra = typeof extra === 'object' ? extra : {};
    const description = typeof extra === 'string' ? extra : '';
    return {
      id: `${skin}-${id}`,
      skin,
      name,
      mode,
      description,
      bg,
      surface,
      base,
      raised,
      text,
      accent,
      accent2,
      ...more,
    };
  });
}

export const THEMES: Theme[] = [
  ...family('specter', [
    [
      'specter',
      'Specter',
      'dark',
      '#0c0d10 #14161b #191c22 #20242c #e9ebf0 #a3b1ff #7dd3fc',
      { dim: '#b3b8c3', faint: '#7d8391', ink: '#0b0b0f' },
    ],
    [
      'obsidian',
      'Obsidian',
      'dark',
      '#0e0e10 #161618 #1b1b1e #232327 #ececee #d9c69a #e8a86d',
      { dim: '#b6b6bc', faint: '#808088', ink: '#0b0b0f' },
    ],
    [
      'midnight',
      'Midnight',
      'dark',
      '#0a0f1c #0f1627 #131b2f #1a2440 #e6ecfa #6fb3ff #a78bfa',
      { dim: '#aab6d3', faint: '#7483a6', ink: '#0b0b0f' },
    ],
    [
      'ember',
      'Ember',
      'dark',
      '#110c0a #191310 #1f1814 #29201a #f4e9e2 #ff8a4c #ffc46b',
      { dim: '#c7b4a8', faint: '#8e7a6e', ink: '#0b0b0f' },
    ],
    [
      'jade',
      'Jade',
      'dark',
      '#08100e #0d1714 #111d19 #172621 #e3f4ee #34d399 #5eead4',
      { dim: '#a9c8bd', faint: '#6f8f84', ink: '#0b0b0f' },
    ],
    [
      'void',
      'Void',
      'dark',
      '#000000 #08080a #0e0e11 #17171b #f2f2f4 #ffffff #9ca3af',
      { dim: '#a9a9b2', faint: '#72727c', ink: '#000000' },
    ],
  ]),
  ...family('neon', [
    [
      'havoc',
      'Havoc',
      'dark',
      '#070709 #0e0e12 #131318 #1b1b22 #f4f4f8 #ff2d55 #ff7a2d',
      { dim: '#bdbdc9', faint: '#80808f', ink: '#0b0b0f' },
    ],
    [
      'cyber',
      'Cyber',
      'dark',
      '#07060b #0e0c15 #13101c #1c1728 #f7f2ff #ff2bd6 #00e5ff',
      { dim: '#c4b8d6', faint: '#85799a', ink: '#0b0b0f' },
    ],
    [
      'toxic',
      'Toxic',
      'dark',
      '#060806 #0c100c #111611 #182018 #f1fbe9 #a3ff12 #12ffb0',
      { dim: '#bcccb0', faint: '#7d8c73', ink: '#0b0b0f' },
    ],
    [
      'ultraviolet',
      'Ultraviolet',
      'dark',
      '#08060e #0f0c19 #141022 #1d1730 #f4efff #9d4dff #ff4dd8',
      { dim: '#c1b5dc', faint: '#82779e', ink: '#ffffff' },
    ],
    [
      'frost',
      'Frost',
      'dark',
      '#05080c #0a1017 #0e151e #141e2a #edf8ff #34d8ff #7c9cff',
      { dim: '#b1c6d6', faint: '#728698', ink: '#0b0b0f' },
    ],
    [
      'goldrush',
      'Gold Rush',
      'dark',
      '#090805 #110f0a #16140d #201c12 #fbf6e8 #ffc400 #ff7a00',
      { dim: '#cdc3a6', faint: '#8d8469', ink: '#0b0b0f' },
    ],
  ]),
  ...family('aurora', [
    [
      'borealis',
      'Borealis',
      'dark',
      '#070b17 #0d1223 #161a25 #20232e #f1f5ff #5ef2c2 #7a5cff',
      { dim: '#c3cce6', faint: '#8792b3', accent3: '#1fb6ff', ink: '#0b0b0f' },
    ],
    [
      'sunset',
      'Sunset',
      'dark',
      '#120812 #1e0c1b #201720 #2a212a #fff3f1 #ff9a5c #ff4f8b',
      { dim: '#e4c3c8', faint: '#a98690', accent3: '#8f5bff', ink: '#0b0b0f' },
    ],
    [
      'lagoon',
      'Lagoon',
      'dark',
      '#04101a #071926 #131e28 #1d2831 #effbff #4fd1ff #2f6bff',
      { dim: '#bcd8e4', faint: '#7e9cab', accent3: '#19e3c4', ink: '#0b0b0f' },
    ],
    [
      'rose',
      'Rosé',
      'dark',
      '#140a12 #20101b #221920 #2c222a #fff2f7 #ff8fb8 #ffb38a',
      { dim: '#e6c4d2', faint: '#a98797', accent3: '#c77dff', ink: '#0b0b0f' },
    ],
    [
      'nebula',
      'Nebula',
      'dark',
      '#0a0714 #140d24 #191622 #22202c #f6f1ff #d946ef #6366f1',
      { dim: '#cdc2e8', faint: '#8f84ae', accent3: '#22d3ee', ink: '#0b0b0f' },
    ],
    [
      'canopy',
      'Canopy',
      'dark',
      '#06110c #0a1d14 #151f1b #1f2924 #effff4 #7ee081 #2dd4bf',
      { dim: '#bddcc8', faint: '#7f9f8a', accent3: '#d9f99d', ink: '#0b0b0f' },
    ],
  ]),
  ...family('terminal', [
    [
      'phosphor',
      'Phosphor',
      'dark',
      '#020402 #040904 #071007 #0c1a0c #b9ffbf #39ff6a #b9ffbf',
      { dim: '#7fd88a', faint: '#4f9a5a', ink: '#0b0b0f', ok: '#39ff6a' },
    ],
    [
      'amber',
      'Amber',
      'dark',
      '#050302 #0a0604 #110a05 #1b1208 #ffdda0 #ffb000 #ffdda0',
      { dim: '#e0ab5c', faint: '#9a7338', ink: '#0b0b0f' },
    ],
    [
      'ibm',
      'IBM 3270',
      'dark',
      '#02040a #040812 #070d1b #0c1629 #d4e6ff #5aa9ff #d4e6ff',
      { dim: '#94b8e6', faint: '#5b7ba3', ink: '#0b0b0f' },
    ],
    [
      'matrix',
      'Matrix',
      'dark',
      '#000300 #010601 #020b03 #041606 #8dffa5 #00ff41 #d0ffd8',
      { dim: '#35d65b', faint: '#1f8a39', ink: '#0b0b0f' },
    ],
    [
      'synth',
      'Hot Pink',
      'dark',
      '#060207 #0c040d #140715 #200b22 #ffd0f4 #ff5fd2 #ffd0f4',
      { dim: '#e08ccb', faint: '#9a5a8a', ink: '#0b0b0f' },
    ],
    [
      'paperwhite',
      'Paper White',
      'dark',
      '#030303 #070707 #0d0d0d #161616 #eeeeee #ffffff #bbbbbb',
      { dim: '#b0b0b0', faint: '#727272', ink: '#000000' },
    ],
  ]),
  ...family('paper', [
    [
      'ivory',
      'Ivory',
      'light',
      '#efe9dd #f8f4ec #fffdf8 #efe8da #1d1a14 #b3261e #1d1a14',
      { dim: '#4a4336', faint: '#7b7263', ink: '#ffffff', ok: '#1f8a4c', warn: '#a86b12', danger: '#c62f3b' },
    ],
    [
      'newsprint',
      'Newsprint',
      'light',
      '#e6e6e2 #f2f2ef #fbfbf9 #e9e9e5 #111111 #111111 #555555',
      { dim: '#3f3f3f', faint: '#6f6f6f', ink: '#ffffff', ok: '#1f8a4c', warn: '#a86b12', danger: '#c62f3b' },
    ],
    [
      'blueprint',
      'Blueprint',
      'light',
      '#dfe8f3 #edf3fa #f8fbfe #e2ebf6 #0f2340 #1f5fbf #0f2340',
      { dim: '#35507a', faint: '#6680a6', ink: '#ffffff', ok: '#1f8a4c', warn: '#a86b12', danger: '#c62f3b' },
    ],
    [
      'sage',
      'Sage',
      'light',
      '#e3eae1 #f0f4ee #fafcf9 #e5ece2 #172418 #3f7d4e #172418',
      { dim: '#3d523f', faint: '#6c806d', ink: '#ffffff', ok: '#1f8a4c', warn: '#a86b12', danger: '#c62f3b' },
    ],
    [
      'blush',
      'Blush',
      'light',
      '#f1e4e0 #f9f0ed #fffaf8 #f3e6e2 #2a1519 #c2416b #2a1519',
      { dim: '#5a3a40', faint: '#8c6a70', ink: '#ffffff', ok: '#1f8a4c', warn: '#a86b12', danger: '#c62f3b' },
    ],
    [
      'sepia',
      'Sepia',
      'light',
      '#e6d7bd #f1e5cf #faf2e2 #eadcc2 #2e2012 #8a4b1f #2e2012',
      { dim: '#5c4630', faint: '#8a7258', ink: '#ffffff', ok: '#1f8a4c', warn: '#a86b12', danger: '#c62f3b' },
    ],
  ]),
  ...family('synthwave', [
    [
      'outrun',
      'Outrun',
      'dark',
      '#12041f #1b0830 #230c3e #2e1150 #fff0fb #ff2e97 #00f0ff',
      { dim: '#e3c2f0', faint: '#a585c7', accent3: '#ffb347', ink: '#0b0b0f' },
    ],
    [
      'miami',
      'Miami',
      'dark',
      '#08121f #0d1a2e #12223b #182d4d #effcff #ff5fa2 #33e0ff',
      { dim: '#bfd9ea', faint: '#7f9cb5', accent3: '#ffd166', ink: '#0b0b0f' },
    ],
    [
      'vaporwave',
      'Vaporwave',
      'dark',
      '#1a1030 #221541 #2a1a4f #352162 #fff5fd #ff9ce6 #9cf6ff',
      { dim: '#e6cdf2', faint: '#ad92c8', accent3: '#fff59c', ink: '#0b0b0f' },
    ],
    [
      'cyberpunk',
      'Cyberpunk',
      'dark',
      '#08080d #0e0e16 #13131e #1b1b2a #fbfaeb #fcee0a #00f0ff',
      { dim: '#c9c6b0', faint: '#8a8773', accent3: '#ff003c', ink: '#0b0b0f' },
    ],
    [
      'nightdrive',
      'Night Drive',
      'dark',
      '#0a0918 #110f24 #17142f #201b3f #fff4ef #ff6b3d #7b5cff',
      { dim: '#dac5d0', faint: '#9c89a3', accent3: '#ffd23d', ink: '#0b0b0f' },
    ],
    [
      'laser',
      'Laser Grid',
      'dark',
      '#050510 #0a0a1a #0f0f24 #161633 #f4fff0 #39ff14 #ff00ff',
      { dim: '#bfe0c2', faint: '#7ea384', accent3: '#00e5ff', ink: '#0b0b0f' },
    ],
  ]),
  ...family('blueprint', [
    [
      'cyanotype',
      'Cyanotype',
      'dark',
      '#0b2a4a #0e3259 #113a66 #164678 #eef7ff #ffffff #7fd4ff',
      { dim: '#b9d6f2', faint: '#7fa6cc', accent3: '#ffd166', ink: '#0b2a4a' },
    ],
    [
      'cad',
      'CAD Night',
      'dark',
      '#14161a #1a1d22 #20242a #282d34 #eef1f5 #ffb000 #4fc3f7',
      { dim: '#b7bec8', faint: '#7d8591', accent3: '#ff5d5d', ink: '#0b0b0f' },
    ],
    [
      'whiteprint',
      'Whiteprint',
      'light',
      '#e6edf4 #f2f6fa #ffffff #e3ebf4 #0d2a52 #1f5fbf #e0452b',
      {
        dim: '#2f4f7a',
        faint: '#617ea3',
        accent3: '#0d2a52',
        ink: '#ffffff',
        ok: '#1f8a4c',
        warn: '#a86b12',
        danger: '#c62f3b',
      },
    ],
    [
      'redline',
      'Redline',
      'dark',
      '#0a2744 #0d2e51 #10365e #15426f #eef7ff #ff5a5a #ffffff',
      { dim: '#b9d6f2', faint: '#7fa6cc', accent3: '#ffd166', ink: '#ffffff' },
    ],
    [
      'vellum',
      'Mint Vellum',
      'dark',
      '#0c2926 #0f322e #123b36 #174842 #effffa #b8ffe9 #ffd27a',
      { dim: '#b6e0d4', faint: '#78a99b', accent3: '#ff8f70', ink: '#0b0b0f' },
    ],
    [
      'plotter',
      'Plotter',
      'dark',
      '#000a16 #00111f #001829 #002238 #e6fdff #00e5ff #ff3dfb',
      { dim: '#a6dce4', faint: '#6b9ea8', accent3: '#fff275', ink: '#0b0b0f' },
    ],
  ]),
  ...family('brutal', [
    [
      'concrete',
      'Concrete',
      'light',
      '#e8e4da #f4f1ea #ffffff #ece8de #000000 #ffde03 #ff4911',
      {
        dim: '#161616',
        faint: '#474747',
        accent3: '#2b59ff',
        ink: '#000000',
        ok: '#1f8a4c',
        warn: '#a86b12',
        danger: '#c62f3b',
      },
    ],
    [
      'bubblegum',
      'Bubblegum',
      'light',
      '#ffc6e5 #ffe3f2 #ffffff #ffd6ec #000000 #2b59ff #ffde03',
      {
        dim: '#1c1020',
        faint: '#4d3a52',
        accent3: '#00c46a',
        ink: '#ffffff',
        ok: '#1f8a4c',
        warn: '#a86b12',
        danger: '#c62f3b',
      },
    ],
    [
      'mintcondition',
      'Mint',
      'light',
      '#b8f2d8 #dcf9ec #ffffff #c9f5e2 #000000 #ff4911 #7b3cff',
      {
        dim: '#0f1f18',
        faint: '#3b5248',
        accent3: '#ffde03',
        ink: '#000000',
        ok: '#1f8a4c',
        warn: '#a86b12',
        danger: '#c62f3b',
      },
    ],
    [
      'sky',
      'Sky',
      'light',
      '#a8d8ff #d6ecff #ffffff #bfe2ff #000000 #ff3cac #ffde03',
      {
        dim: '#0c1a26',
        faint: '#384b5c',
        accent3: '#00c46a',
        ink: '#000000',
        ok: '#1f8a4c',
        warn: '#a86b12',
        danger: '#c62f3b',
      },
    ],
    [
      'tabloid',
      'Tabloid',
      'light',
      '#f2eee3 #faf8f2 #ffffff #eeeade #000000 #e10600 #000000',
      {
        dim: '#161616',
        faint: '#474747',
        accent3: '#ffde03',
        ink: '#ffffff',
        ok: '#1f8a4c',
        warn: '#a86b12',
        danger: '#c62f3b',
      },
    ],
    [
      'tar',
      'Tar',
      'dark',
      '#0a0a0a #141414 #1c1c1c #262626 #ffffff #c6ff00 #ff3cac',
      { dim: '#e0e0e0', faint: '#a8a8a8', accent3: '#00e1ff', ink: '#000000' },
    ],
  ]),
  ...family('retro', [
    [
      'classic',
      'Classic',
      'light',
      '#c0c0c0 #c0c0c0 #ffffff #d4d0c8 #000000 #000080 #1084d0',
      {
        dim: '#000000',
        faint: '#404040',
        accent3: '#008080',
        ink: '#ffffff',
        ok: '#1f8a4c',
        warn: '#a86b12',
        danger: '#c62f3b',
      },
    ],
    [
      'teal',
      'Teal',
      'light',
      '#c0c0c0 #c0c0c0 #ffffff #d4d0c8 #000000 #008080 #20b2aa',
      {
        dim: '#000000',
        faint: '#404040',
        accent3: '#004040',
        ink: '#ffffff',
        ok: '#1f8a4c',
        warn: '#a86b12',
        danger: '#c62f3b',
      },
    ],
    [
      'plum',
      'Plum',
      'light',
      '#d8c8d0 #d8c8d0 #ffffff #e6dae0 #000000 #582a58 #b07aa8',
      {
        dim: '#000000',
        faint: '#483040',
        accent3: '#402040',
        ink: '#ffffff',
        ok: '#1f8a4c',
        warn: '#a86b12',
        danger: '#c62f3b',
      },
    ],
    [
      'storm',
      'Storm',
      'light',
      '#a8b0c0 #a8b0c0 #ffffff #bcc3d1 #000000 #102050 #4a6aae',
      {
        dim: '#000000',
        faint: '#303848',
        accent3: '#3a6ea5',
        ink: '#ffffff',
        ok: '#1f8a4c',
        warn: '#a86b12',
        danger: '#c62f3b',
      },
    ],
    [
      'desert',
      'Desert',
      'light',
      '#d5ccbb #d5ccbb #ffffff #e3dccf #000000 #8a3a1e #c8764a',
      {
        dim: '#000000',
        faint: '#4a4230',
        accent3: '#a28c5a',
        ink: '#ffffff',
        ok: '#1f8a4c',
        warn: '#a86b12',
        danger: '#c62f3b',
      },
    ],
    [
      'contrast',
      'High Contrast',
      'dark',
      '#000000 #000000 #000000 #1c1c1c #ffffff #800080 #c000c0',
      { dim: '#ffffff', faint: '#ffff00', accent3: '#000000', ink: '#ffffff' },
    ],
  ]),
  ...family('holo', [
    [
      'pearl',
      'Pearl',
      'light',
      '#eceef7 #f6f6fc #ffffff #eceef8 #15142b #7b61ff #ff6ec7',
      {
        dim: '#44436a',
        faint: '#76759c',
        accent3: '#3de0ff',
        ink: '#ffffff',
        ok: '#1f8a4c',
        warn: '#a86b12',
        danger: '#c62f3b',
      },
    ],
    [
      'chrome',
      'Dark Chrome',
      'dark',
      '#0b0b11 #13131b #191923 #22222e #f4f3ff #b69cff #6ef3ff',
      { dim: '#c3c1dd', faint: '#8583a0', accent3: '#ff8ad8', ink: '#0b0b0f' },
    ],
    [
      'opal',
      'Opal',
      'light',
      '#e7f4f2 #f3fbfa #ffffff #e4f3f1 #10302d #00a99b #b16cff',
      {
        dim: '#3a5c58',
        faint: '#6a8a86',
        accent3: '#ffb86b',
        ink: '#ffffff',
        ok: '#1f8a4c',
        warn: '#a86b12',
        danger: '#c62f3b',
      },
    ],
    [
      'y2k',
      'Y2K',
      'light',
      '#e5eaff #f2f4ff #ffffff #e6ebff #0e1440 #2f6bff #ff49db',
      {
        dim: '#384070',
        faint: '#6a71a0',
        accent3: '#8aff3b',
        ink: '#ffffff',
        ok: '#1f8a4c',
        warn: '#a86b12',
        danger: '#c62f3b',
      },
    ],
    [
      'oilslick',
      'Oil Slick',
      'dark',
      '#07080c #0e1016 #13161e #1b1f2a #effff9 #39ffb6 #8c5bff',
      { dim: '#bcd6d0', faint: '#7e9892', accent3: '#ff5c8a', ink: '#0b0b0f' },
    ],
    [
      'champagne',
      'Champagne',
      'light',
      '#f4eee5 #faf6f0 #ffffff #f2ebe0 #2a1f12 #b27a2e #e58fb4',
      {
        dim: '#5a4a36',
        faint: '#8b7a64',
        accent3: '#8fcbea',
        ink: '#ffffff',
        ok: '#1f8a4c',
        warn: '#a86b12',
        danger: '#c62f3b',
      },
    ],
  ]),
  ...family('glitch', [
    [
      'rgb',
      'RGB',
      'dark',
      '#050505 #0b0b0c #111113 #19191c #f5f5f5 #ff1f4b #00fff0',
      { dim: '#b8b8bd', faint: '#7a7a82', accent3: '#f7ff00', ink: '#0b0b0f' },
    ],
    [
      'corrupt',
      'Corrupt',
      'dark',
      '#030603 #080c08 #0d120d #141b14 #effff0 #39ff14 #ff00e6',
      { dim: '#b5cdb6', faint: '#78907a', accent3: '#ffffff', ink: '#0b0b0f' },
    ],
    [
      'vhs',
      'VHS',
      'dark',
      '#0b0716 #120c21 #18102b #221739 #fff3fc #ff6ad5 #6af2ff',
      { dim: '#d4c1dc', faint: '#9583a0', accent3: '#ffe66a', ink: '#0b0b0f' },
    ],
    [
      'deadpixel',
      'Dead Pixel',
      'dark',
      '#000000 #080808 #0e0e0e #171717 #ffffff #ffffff #ff1f1f',
      { dim: '#bdbdbd', faint: '#7d7d7d', accent3: '#1f7bff', ink: '#000000' },
    ],
    [
      'bluescreen',
      'Bluescreen',
      'dark',
      '#001a8c #0020a6 #0026ba #1a3ec8 #ffffff #ffffff #00fff0',
      { dim: '#dde5ff', faint: '#a9b7f0', accent3: '#ffea00', ink: '#0020a6' },
    ],
    [
      'infrared',
      'Infrared',
      'dark',
      '#0c0303 #140606 #1b0909 #260e0e #fff1ea #ff3b00 #ffb800',
      { dim: '#dcbcb0', faint: '#9c7c70', accent3: '#7a2cff', ink: '#0b0b0f' },
    ],
  ]),

  ...family('luxury', [
    [
      'black-label',
      'Black Label',
      'dark',
      '#050505 #0b0b0b #111111 #181818 #f2efe8 #d4af37 #8a8a8a',
      'Black lacquer, gold leaf.',
    ],
    [
      'midnight-gold',
      'Midnight Gold',
      'dark',
      '#070912 #0d1120 #12172b #1a2038 #f3ead2 #e6c068 #9fb4d9',
      'Gold on a midnight suit.',
    ],
    [
      'titanium',
      'Titanium',
      'dark',
      '#121315 #1a1c1f #222428 #2c2f34 #eceef1 #b8c2cc #7dd3fc',
      'Brushed titanium, cool and exact.',
    ],
    [
      'bordeaux',
      'Bordeaux',
      'dark',
      '#0f0507 #1a0a0e #230e13 #30141b #f6e8ea #c9a96e #a3243b',
      'Wine-dark velvet and brass.',
    ],
    [
      'emerald-reserve',
      'Emerald Reserve',
      'dark',
      '#04100b #081a12 #0c2318 #123022 #e9f3ec #d6b46a #2f9e6e',
      'Old emerald and gilt.',
    ],
    [
      'ivory-executive',
      'Ivory Executive',
      'light',
      '#e7e1d6 #f2ede4 #fbf8f2 #efe9de #1f1a12 #9c7a2f #5b4636',
      'Ivory paper, bronze ink.',
    ],
    [
      'sapphire-noir',
      'Sapphire Noir',
      'dark',
      '#03060f #070c1c #0b1229 #111a38 #e9eefc #c8d3f5 #3b82f6',
      'Night sapphire and platinum.',
    ],
    [
      'platinum-atelier',
      'Platinum Atelier',
      'light',
      '#dadcdf #e9eaec #f7f7f8 #eceef0 #16181b #4b5563 #b08d57',
      'A quiet platinum studio.',
    ],
  ]),
  ...family('corporate', [
    [
      'enterprise-blue',
      'Enterprise Blue',
      'light',
      '#dfe5ee #eef2f7 #ffffff #e8edf4 #0f1b2d #0b5cd5 #14b8a6',
      'Trusted blue on white.',
    ],
    [
      'executive-charcoal',
      'Executive Charcoal',
      'dark',
      '#121417 #191c20 #1f2328 #282d33 #e8ebef #4f8cff #9aa5b1',
      'Board-room charcoal.',
    ],
    [
      'institutional-navy',
      'Institutional Navy',
      'dark',
      '#07101f #0c1830 #10203d #172b4d #e4ebf6 #3b82f6 #f59e0b',
      'Navy with signal amber.',
    ],
    [
      'slate-office',
      'Slate Office',
      'light',
      '#d5dae1 #e4e8ed #f3f5f8 #e0e5eb #1a2230 #475569 #2563eb',
      'Slate and paper, all business.',
    ],
    [
      'professional-light',
      'Professional Light',
      'light',
      '#e6e9ee #f2f4f7 #ffffff #eceff3 #101828 #1d4ed8 #0e9384',
      'Bright, neutral and clear.',
    ],
    [
      'steel-gray',
      'Steel Gray',
      'dark',
      '#16191d #1d2126 #24292f #2d333a #e6e9ed #7d8fa3 #5aa9e6',
      'Steel tones, restrained blue.',
    ],
    [
      'midnight-executive',
      'Midnight Executive',
      'dark',
      '#05070d #0a0e18 #0f1422 #161c2e #e5e9f2 #6c8cff #c9a227',
      'After-hours executive suite.',
    ],
    [
      'neutral-operations',
      'Neutral Operations',
      'light',
      '#dfe1e3 #edeeef #fafafa #e8e9eb #1f2328 #0969da #1a7f37',
      'Operations-grade neutral.',
    ],
  ]),
  ...family('nature', [
    [
      'forest-canopy',
      'Forest Canopy',
      'dark',
      '#08100b #0e1a12 #132218 #1a2e21 #e4efe5 #7ccf8a #d6b26e',
      'Light through leaves.',
    ],
    [
      'northern-lights',
      'Northern Lights',
      'dark',
      '#050b14 #0a1424 #0e1b30 #142640 #e3f2ff #5ef2b0 #b388ff',
      'Aurora over snow.',
    ],
    [
      'ocean-depth',
      'Ocean Depth',
      'dark',
      '#020c14 #051826 #072235 #0b2f48 #dff4ff #2ec4f1 #5eead4',
      'Blue going down.',
    ],
    [
      'arctic-morning',
      'Arctic Morning',
      'light',
      '#d6e3ea #e7f0f4 #f5fafc #e3edf2 #10202b #2b8cbe #e07a5f',
      'Cold sun on ice.',
    ],
    [
      'desert-dusk',
      'Desert Dusk',
      'dark',
      '#140c08 #1f140e #281a12 #352419 #f7e7d6 #f28c4b #c06c84',
      'Warm sand after sunset.',
    ],
    [
      'storm-cloud',
      'Storm Cloud',
      'dark',
      '#0f1216 #161b21 #1d232b #262e38 #dfe6ec #8fb3d9 #f4d35e',
      'Grey sky, lightning gold.',
    ],
    [
      'moss-and-stone',
      'Moss and Stone',
      'dark',
      '#11130f #181b15 #1f231b #292e24 #e6e8dc #a3b86c #c9a87c',
      'Moss on old walls.',
    ],
    [
      'mountain-mist',
      'Mountain Mist',
      'light',
      '#d8dde0 #e7ebed #f5f7f8 #e2e7ea #1d2428 #557a6e #8b6fa8',
      'Fog in the high valleys.',
    ],
  ]),
];

export const themeById = (id: string): Theme | undefined => THEMES.find((t) => t.id === id);
export const themesOf = (skin: string): Theme[] => THEMES.filter((t) => t.skin === skin);
