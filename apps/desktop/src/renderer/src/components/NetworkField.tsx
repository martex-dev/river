import { useEffect, useRef, type ReactElement } from 'react';

interface Node {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
}

interface Pulse {
  a: number;
  b: number;
  t: number;
  speed: number;
}

const LINK_DISTANCE = 150;

/**
 * Ambient network visualisation: devices drifting, links forming, encrypted
 * "packets" travelling along links. Purely decorative (aria-hidden) and
 * rendered as a single still frame when reduced motion is on.
 */
export function NetworkField({
  reducedMotion,
  density = 46,
}: {
  reducedMotion: boolean;
  density?: number;
}): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    let width = 0;
    let height = 0;
    let frame = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rand = mulberry32(7);
    const nodes: Node[] = [];
    const pulses: Pulse[] = [];

    const resize = (): void => {
      const rect = canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (nodes.length === 0) {
        for (let i = 0; i < density; i++) {
          nodes.push({
            x: rand() * width,
            y: rand() * height,
            vx: (rand() - 0.5) * 0.18,
            vy: (rand() - 0.5) * 0.18,
            r: 1 + rand() * 1.8,
          });
        }
      }
      draw();
    };

    const draw = (): void => {
      ctx.clearRect(0, 0, width, height);
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i]!;
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j]!;
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          if (d < LINK_DISTANCE) {
            const alpha = (1 - d / LINK_DISTANCE) * 0.22;
            ctx.strokeStyle = `rgba(106, 168, 255, ${alpha})`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
      }
      for (const p of pulses) {
        const a = nodes[p.a]!;
        const b = nodes[p.b]!;
        const x = a.x + (b.x - a.x) * p.t;
        const y = a.y + (b.y - a.y) * p.t;
        const g = ctx.createRadialGradient(x, y, 0, x, y, 7);
        g.addColorStop(0, 'rgba(79, 227, 209, 0.95)');
        g.addColorStop(1, 'rgba(79, 227, 209, 0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, 7, 0, Math.PI * 2);
        ctx.fill();
      }
      for (const n of nodes) {
        ctx.fillStyle = 'rgba(200, 220, 255, 0.75)';
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    const step = (): void => {
      for (const n of nodes) {
        n.x += n.vx;
        n.y += n.vy;
        if (n.x < 0 || n.x > width) n.vx *= -1;
        if (n.y < 0 || n.y > height) n.vy *= -1;
      }
      if (pulses.length < 6 && rand() < 0.04) {
        const a = Math.floor(rand() * nodes.length);
        let best = -1;
        let bestD = LINK_DISTANCE;
        nodes.forEach((n, i) => {
          const d = Math.hypot(n.x - nodes[a]!.x, n.y - nodes[a]!.y);
          if (i !== a && d < bestD) {
            best = i;
            bestD = d;
          }
        });
        if (best >= 0) pulses.push({ a, b: best, t: 0, speed: 0.008 + rand() * 0.01 });
      }
      for (let i = pulses.length - 1; i >= 0; i--) {
        const p = pulses[i]!;
        p.t += p.speed;
        if (p.t >= 1) pulses.splice(i, 1);
      }
      draw();
      frame = requestAnimationFrame(step);
    };

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();
    if (!reducedMotion) frame = requestAnimationFrame(step);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [reducedMotion, density]);

  return <canvas ref={canvasRef} className="network-field" aria-hidden="true" />;
}

/** Small deterministic PRNG so the layout is stable between renders. Not used for anything security-related. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
