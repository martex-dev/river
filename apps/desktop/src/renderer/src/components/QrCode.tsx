import qrcode from 'qrcode-generator';
import { useMemo, type ReactElement } from 'react';

/**
 * A QR code drawn as one SVG path (no images, no injected markup). Dark modules on a white
 * quiet zone whatever the theme, so phone cameras read it.
 */
export function QrCode(props: { value: string; size?: number; label: string }): ReactElement {
  const { path, count } = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(props.value, 'Byte');
    qr.make();
    const n = qr.getModuleCount();
    let d = '';
    for (let row = 0; row < n; row++) {
      for (let col = 0; col < n; col++) {
        if (qr.isDark(row, col)) d += `M${col + 4} ${row + 4}h1v1h-1z`;
      }
    }
    return { path: d, count: n + 8 };
  }, [props.value]);
  const size = props.size ?? 200;
  return (
    <svg
      className="qr-code"
      role="img"
      aria-label={props.label}
      width={size}
      height={size}
      viewBox={`0 0 ${count} ${count}`}
      shapeRendering="crispEdges"
    >
      <rect width={count} height={count} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}
