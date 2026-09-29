/* Геометрія долини: осьові координати (q, r), гострий верх (правила 5.1).
   Центр соти на площині: x = sqrt(3) * (q + r / 2), y = 1.5 * r - у тих самих
   одиницях задано бурі маніфесту. */

export const SQRT3 = Math.sqrt(3);

export const hexKey = (q: number, r: number): string => q + ',' + r;

export function parseKey(key: string): [number, number] {
  const [q, r] = key.split(',').map(Number);
  return [q ?? 0, r ?? 0];
}

export function hexDist(aq: number, ar: number, bq: number, br: number): number {
  const dq = aq - bq;
  const dr = ar - br;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

export function toPlane(q: number, r: number): { x: number; y: number } {
  return { x: SQRT3 * (q + r / 2), y: 1.5 * r };
}

/* найближча сота до точки площини (кубічне округлення) */
export function fromPlane(x: number, y: number): [number, number] {
  const r = y / 1.5;
  const q = x / SQRT3 - r / 2;
  const s = -q - r;
  let rq = Math.round(q);
  let rr = Math.round(r);
  const rs = Math.round(s);
  const dq = Math.abs(rq - q);
  const dr = Math.abs(rr - r);
  const ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  return [rq, rr];
}

/* соти на відстані до rad від центру, з відстанню */
export function disc(q: number, r: number, rad: number): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let dq = -rad; dq <= rad; dq++) {
    for (let dr = Math.max(-rad, -dq - rad); dr <= Math.min(rad, -dq + rad); dr++) {
      out.push([q + dq, r + dr, hexDist(0, 0, dq, dr)]);
    }
  }
  return out;
}

/* шість кутів шестикутника з центром (cx, cy) і радіусом size */
export function corners(cx: number, cy: number, size: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i - 30);
    out.push([cx + size * Math.cos(a), cy + size * Math.sin(a)]);
  }
  return out;
}
