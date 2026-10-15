// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { QrCode } from '../src/renderer/src/components/QrCode.tsx';

describe('QrCode', () => {
  it('draws the code as one SVG path on a white quiet zone', () => {
    const { getByRole } = render(
      <QrCode value="river://link?s=https%3A%2F%2Fa.example&c=ABCDEFGHJKMNPQRS" label="Link code" />,
    );
    const svg = getByRole('img', { name: 'Link code' });
    expect(svg.querySelector('rect')?.getAttribute('fill')).toBe('#fff');
    expect(svg.querySelector('path')?.getAttribute('d')?.length).toBeGreaterThan(500);
    // Version 3+ for this length: at least 29 modules plus 8 of quiet zone.
    expect(Number(svg.getAttribute('viewBox')?.split(' ')[2])).toBeGreaterThanOrEqual(37);
  });
});
