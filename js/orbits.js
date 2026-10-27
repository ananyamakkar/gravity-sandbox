import { G } from './physics.js';
import { cross, dot, length } from './vec3.js';

export const AU_YR_TO_KMS = 4.740470446;   // 1 AU/yr in km/s
const TWO_PI = Math.PI * 2;

// The body exerting the strongest pull on body i (largest m / d^2)
export function findDominant(w, i) {
  let best = -1, bestPull = 0;
  for (let j = 0; j < w.n; j++) {
    if (j === i) continue;
    const dx = w.px[j] - w.px[i];
    const dy = w.py[j] - w.py[i];
    const dz = w.pz[j] - w.pz[i];
    const pull = w.mass[j] / (dx * dx + dy * dy + dz * dz + 1e-12);
    if (pull > bestPull) { bestPull = pull; best = j; }
  }
  return best;
}

function angleBetween(a, b) {
  const c = dot(a, b) / (length(a) * length(b));
  return Math.acos(Math.min(1, Math.max(-1, c)));
}

// Orbital elements of body i around its dominant body. Angles in degrees.
export function orbitalElements(w, i) {
  const j = findDominant(w, i);
  if (j < 0) return null;

  const r = [w.px[i] - w.px[j], w.py[i] - w.py[j], w.pz[i] - w.pz[j]];
  const v = [w.vx[i] - w.vx[j], w.vy[i] - w.vy[j], w.vz[i] - w.vz[j]];
  const mu = G * (w.mass[i] + w.mass[j]);

  const rMag = length(r);
  const vMag = length(v);
  const h = cross(r, v);
  const hMag = length(h);

  const energy = (vMag * vMag) / 2 - mu / rMag;          // specific orbital energy
  const eVec = [
    cross(v, h)[0] / mu - r[0] / rMag,
    cross(v, h)[1] / mu - r[1] / rMag,
    cross(v, h)[2] / mu - r[2] / rMag,
  ];
  const ecc = length(eVec);
  const bound = energy < 0;

  let type;
  if (ecc < 1e-3) type = 'circular';
  else if (Math.abs(ecc - 1) < 1e-3) type = 'parabolic';
  else if (ecc < 1) type = 'elliptical';
  else type = 'hyperbolic';

  // Semi-major axis (negative for hyperbolic, meaningless for parabolic)
  const a = Math.abs(energy) < 1e-12 ? Infinity : -mu / (2 * energy);
  const peri = (hMag * hMag) / mu / (1 + ecc);
  const apo = bound ? a * (1 + ecc) : null;
  const period = bound ? TWO_PI * Math.sqrt((a * a * a) / mu) : null;   // years

  const incl = Math.acos(Math.min(1, Math.max(-1, h[2] / hMag)));

  // Node vector n = z_hat x h. Undefined for a flat (i ~ 0) orbit.
  const n = [-h[1], h[0], 0];
  const nMag = length(n);
  const hasNode = nMag > 1e-9 * hMag;

  let node = null, argPeri = null, nu = null;
  if (hasNode) {
    node = Math.atan2(n[1], n[0]);
    if (node < 0) node += TWO_PI;
    if (ecc > 1e-6) {
      argPeri = angleBetween(n, eVec);
      if (eVec[2] < 0) argPeri = TWO_PI - argPeri;
    }
  }
  if (ecc > 1e-6) {
    nu = angleBetween(eVec, r);
    if (dot(r, v) < 0) nu = TWO_PI - nu;
  }

  const deg = (x) => (x === null ? null : (x * 180) / Math.PI);

  return {
    dominant: j,
    dist: rMag,
    speed: vMag,
    vCirc: Math.sqrt(mu / rMag),
    vEsc: Math.sqrt((2 * mu) / rMag),
    energy, bound, type, ecc, a, peri, apo, period,
    incl: deg(incl),
    node: deg(node),
    argPeri: deg(argPeri),
    nu: deg(nu),
    retrograde: incl > Math.PI / 2,
  };
}