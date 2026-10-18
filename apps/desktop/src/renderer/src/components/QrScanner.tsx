import type jsQRFn from 'jsqr';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Modal } from '../community/ui/common.tsx';
import { haptic } from './gestures.ts';

/** The browser's own QR reader where it has one (Android, macOS); jsQR everywhere else. */
interface Detector {
  detect(source: CanvasImageSource): Promise<Array<{ rawValue: string }>>;
}
function nativeDetector(): Detector | null {
  const Ctor = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector })
    .BarcodeDetector;
  try {
    return Ctor ? new Ctor({ formats: ['qr_code'] }) : null;
  } catch {
    return null;
  }
}

/** jsQR (a large decoder) loads only when a scanner opens without the browser's own reader. */
type JsQr = typeof jsQRFn;
let jsQrLoad: Promise<JsQr> | null = null;
function loadJsQr(): Promise<JsQr> {
  jsQrLoad ??= import('jsqr').then((m) => m.default);
  return jsQrLoad;
}

async function decode(
  detector: Detector | null,
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
): Promise<string | null> {
  if (detector) return (await detector.detect(canvas))[0]?.rawValue ?? null;
  const jsQR = await loadJsQr();
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' })?.data ?? null;
}

/**
 * Reads a QR code with the camera (2.9). Pictures never leave the device: each frame is decoded
 * here and thrown away. `onResult` returns true when the code was the right kind (the scanner
 * closes), or a message to show and keep scanning.
 */
export function QrScanner(props: {
  title: string;
  hint: string;
  onResult(text: string): true | string;
  onClose(): void;
}): ReactElement {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [wrong, setWrong] = useState<string | null>(null);
  const latest = useRef(props);
  useEffect(() => {
    latest.current = props;
  });

  useEffect(() => {
    let stream: MediaStream | null = null;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const detector = nativeDetector();
    if (!detector) void loadJsQr().catch(() => undefined);
    let lastWrong = '';

    const scan = async (): Promise<void> => {
      if (stopped) return;
      const v = video.current;
      if (v && ctx && v.readyState >= 2 && v.videoWidth) {
        const scale = Math.min(1, 640 / Math.max(v.videoWidth, v.videoHeight));
        canvas.width = Math.round(v.videoWidth * scale);
        canvas.height = Math.round(v.videoHeight * scale);
        ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
        const text = await decode(detector, ctx, canvas).catch(() => null);
        if (text && !stopped) {
          const result = latest.current.onResult(text);
          if (result === true) {
            haptic('success');
            return;
          }
          if (text !== lastWrong) {
            lastWrong = text;
            haptic('warning');
            setWrong(result);
          }
        }
      }
      timer = setTimeout(() => void scan(), 160);
    };

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
      .then((s) => {
        if (stopped) return s.getTracks().forEach((t) => t.stop());
        stream = s;
        const v = video.current;
        if (v) {
          v.srcObject = s;
          void v.play().catch(() => undefined);
        }
        void scan();
      })
      .catch(() => setError('River could not open the camera. Check that River may use it.'));
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <Modal title={props.title} onClose={props.onClose}>
      {error ? (
        <p className="field__error">{error}</p>
      ) : (
        <div className="qr-scanner">
          <video ref={video} className="qr-scanner__video" muted playsInline aria-label="Camera" />
          <span className="qr-scanner__frame" aria-hidden="true" />
        </div>
      )}
      <p className="muted small" aria-live="polite">
        {wrong ?? props.hint}
      </p>
      <div className="button-row">
        <button className="btn btn--ghost" onClick={props.onClose}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}
