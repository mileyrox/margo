import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

/*
 * Spending circles that behave like bubbles: they never overlap, bounce off each other and the edges,
 * and you can grab one and fling it. Tapping one (without dragging) opens it. Purely for fun.
 * With "reduce motion" turned on, they sit still (still never overlapping) and can only be tapped.
 */
export type PitBubble = { key: string; size: number; style: CSSProperties; label: string; children: ReactNode; testId?: string };
type Body = { x: number; y: number; vx: number; vy: number; r: number; m: number };

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Pushes overlapping circles apart and keeps them inside the box. Used to settle the starting layout. */
function separate(bodies: Body[], width: number, height: number, rounds: number) {
  for (let round = 0; round < rounds; round++) {
    for (let i = 0; i < bodies.length; i++) for (let j = i + 1; j < bodies.length; j++) {
      const a = bodies[i], b = bodies[j];
      const dx = b.x - a.x, dy = b.y - a.y;
      const dist = Math.hypot(dx, dy) || 0.01, min = a.r + b.r + 2;
      if (dist < min) {
        const push = (min - dist) / 2, nx = dx / dist, ny = dy / dist;
        a.x -= nx * push; a.y -= ny * push; b.x += nx * push; b.y += ny * push;
      }
    }
    for (const body of bodies) {
      body.x = Math.max(body.r, Math.min(width - body.r, body.x));
      body.y = Math.max(body.r, Math.min(height - body.r, body.y));
    }
  }
}

export function BubblePit({ items, selected, onSelect }: { items: PitBubble[]; selected?: string; onSelect: (key: string) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const nodes = useRef(new Map<string, HTMLButtonElement>());
  const bodies = useRef(new Map<string, Body>());
  const frame = useRef(0);
  const grab = useRef<{ key: string; px: number; py: number; ox: number; oy: number; t: number; moved: boolean; lastX: number; lastY: number; lastT: number } | null>(null);
  const [width, setWidth] = useState(340);

  // The box is as tall as the circles need, so they have room to move.
  const area = items.reduce((sum, item) => sum + item.size * item.size, 0);
  const biggest = Math.max(0, ...items.map((item) => item.size));
  const height = Math.round(Math.max(biggest + 20, 240, (area * 1.55) / Math.max(width, 200)));

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const draw = () => {
    for (const [key, body] of bodies.current) {
      const node = nodes.current.get(key);
      if (node) node.style.transform = `translate(${body.x - body.r}px, ${body.y - body.r}px)`;
    }
  };

  const step = () => {
    const list = [...bodies.current.entries()];
    const held = grab.current?.moved ? grab.current.key : null;
    let energy = 0;
    for (const [key, body] of list) {
      if (key === held) continue;
      body.x += body.vx; body.y += body.vy;
      body.vx *= 0.985; body.vy *= 0.985;
      // Bounce off the edges.
      if (body.x < body.r) { body.x = body.r; body.vx = Math.abs(body.vx) * 0.8; }
      if (body.x > width - body.r) { body.x = width - body.r; body.vx = -Math.abs(body.vx) * 0.8; }
      if (body.y < body.r) { body.y = body.r; body.vy = Math.abs(body.vy) * 0.8; }
      if (body.y > height - body.r) { body.y = height - body.r; body.vy = -Math.abs(body.vy) * 0.8; }
      energy += body.vx * body.vx + body.vy * body.vy;
    }
    // Bounce off each other: push apart, then trade speed along the line between them.
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const [ka, a] = list[i], [kb, b] = list[j];
      const dx = b.x - a.x, dy = b.y - a.y;
      const dist = Math.hypot(dx, dy) || 0.01, min = a.r + b.r + 2;
      if (dist >= min) continue;
      const nx = dx / dist, ny = dy / dist, overlap = min - dist;
      const aFixed = ka === held, bFixed = kb === held;
      const share = aFixed ? 0 : bFixed ? 1 : b.m / (a.m + b.m);
      a.x -= nx * overlap * share; a.y -= ny * overlap * share;
      b.x += nx * overlap * (1 - share); b.y += ny * overlap * (1 - share);
      const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
      if (rel < 0) {
        const bounce = 1.8 * rel;
        if (aFixed) { b.vx -= bounce * nx; b.vy -= bounce * ny; }
        else if (bFixed) { a.vx += bounce * nx; a.vy += bounce * ny; }
        else {
          const total = a.m + b.m;
          a.vx += (bounce * b.m / total) * nx; a.vy += (bounce * b.m / total) * ny;
          b.vx -= (bounce * a.m / total) * nx; b.vy -= (bounce * a.m / total) * ny;
        }
      }
    }
    draw();
    // Stop the loop when everything has settled, to save battery.
    if (held || energy > 0.004) frame.current = requestAnimationFrame(step);
    else frame.current = 0;
  };
  const wake = () => { if (!frame.current && !reducedMotion()) frame.current = requestAnimationFrame(step); };

  // Place circles: keep the ones already on screen, add new ones, then settle without overlaps.
  useEffect(() => {
    const keep = new Map<string, Body>();
    items.forEach((item, i) => {
      const r = item.size / 2;
      const old = bodies.current.get(item.key);
      if (old) { old.r = r; old.m = r * r; keep.set(item.key, old); return; }
      // A loose zig-zag start, with a little push so they tumble into place.
      const col = i % 3, row = Math.floor(i / 3);
      keep.set(item.key, {
        x: (width / 3) * col + width / 6 + (row % 2 ? 20 : -20), y: r + 10 + row * (biggest * 0.7),
        vx: (i % 2 ? 1 : -1) * (1.2 + (i % 3) * 0.4), vy: 0.8 + (i % 4) * 0.3, r, m: r * r,
      });
    });
    bodies.current = keep;
    separate([...keep.values()], width, height, reducedMotion() ? 80 : 20);
    draw();
    wake();
    return () => { cancelAnimationFrame(frame.current); frame.current = 0; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.map((item) => `${item.key}:${Math.round(item.size)}`).join('|'), width, height]);

  const down = (key: string) => (event: React.PointerEvent<HTMLButtonElement>) => {
    const body = bodies.current.get(key);
    if (!body) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    grab.current = { key, px: event.clientX, py: event.clientY, ox: body.x, oy: body.y, t: performance.now(), moved: false, lastX: event.clientX, lastY: event.clientY, lastT: performance.now() };
  };
  const move = (key: string) => (event: React.PointerEvent<HTMLButtonElement>) => {
    const g = grab.current, body = bodies.current.get(key);
    if (!g || g.key !== key || !body) return;
    const dx = event.clientX - g.px, dy = event.clientY - g.py;
    if (!g.moved && Math.hypot(dx, dy) < 6) return;
    g.moved = true;
    const now = performance.now(), dt = Math.max(8, now - g.lastT);
    // Remember how fast the finger is moving, so letting go flings the bubble.
    body.vx = ((event.clientX - g.lastX) / dt) * 16; body.vy = ((event.clientY - g.lastY) / dt) * 16;
    g.lastX = event.clientX; g.lastY = event.clientY; g.lastT = now;
    body.x = Math.max(body.r, Math.min(width - body.r, g.ox + dx));
    body.y = Math.max(body.r, Math.min(height - body.r, g.oy + dy));
    if (reducedMotion()) { body.vx = 0; body.vy = 0; separate([...bodies.current.values()], width, height, 10); draw(); }
    else wake();
  };
  const up = (key: string) => () => {
    const g = grab.current;
    grab.current = null;
    if (!g || g.key !== key) return;
    if (!g.moved) { onSelect(key); return; }
    const body = bodies.current.get(key);
    if (body) { body.vx = Math.max(-28, Math.min(28, body.vx)); body.vy = Math.max(-28, Math.min(28, body.vy)); }
    wake();
  };

  return <div className="m-pit" ref={box} style={{ height }}>
    {items.map((item) => <button key={item.key} type="button" ref={(node) => { if (node) nodes.current.set(item.key, node); else nodes.current.delete(item.key); }}
      className={`m-bubble m-pit-bubble ${selected === item.key ? 'on' : ''}`} style={{ ...item.style, width: item.size, height: item.size }}
      aria-pressed={selected === item.key} aria-label={item.label} data-testid={item.testId}
      onPointerDown={down(item.key)} onPointerMove={move(item.key)} onPointerUp={up(item.key)} onPointerCancel={() => { grab.current = null; }}
      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(item.key); } }}>
      {item.children}
    </button>)}
  </div>;
}
