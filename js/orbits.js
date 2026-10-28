import { G } from './physics.js';
import { cross, dot, length, normalize, add, scale } from './vec3.js';

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

  const energy = (vMag * vMag) / 2 - mu / rMag;
  const vxh = cross(v, h);
  const eVec = [
    vxh[0] / mu - r[0] / rMag,
    vxh[1] / mu - r[1] / rMag,
    vxh[2] / mu - r[2] / rMag,
  ];
  const ecc = length(eVec);
  const bound = energy < 0;

  let type;
  if (ecc < 1e-3) type = 'circular';
  else if (Math.abs(ecc - 1) < 1e-3) type = 'parabolic';
  else if (ecc < 1) type = 'elliptical';
  else type = 'hyperbolic';

  const a = Math.abs(energy) < 1e-12 ? Infinity : -mu / (2 * energy);
  const peri = (hMag * hMag) / mu / (1 + ecc);
  const apo = bound ? a * (1 + ecc) : null;
  const period = bound ? TWO_PI * Math.sqrt((a * a * a) / mu) : null;

  const incl = Math.acos(Math.min(1, Math.max(-1, h[2] / hMag)));

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

// Samples the selected body's current orbit as 3D points (world space).
// Returns { points, periapsis, apoapsis, nodeUp, nodeDown } or null.
export function sampleOrbit(w, i, count = 180) {
  const j = findDominant(w, i);
  if (j < 0) return null;

  const center = [w.px[j], w.py[j], w.pz[j]];
  const r = [w.px[i] - center[0], w.py[i] - center[1], w.pz[i] - center[2]];
  const v = [w.vx[i] - w.vx[j], w.vy[i] - w.vy[j], w.vz[i] - w.vz[j]];
  const mu = G * (w.mass[i] + w.mass[j]);

  const rMag = length(r);
  const h = cross(r, v);
  const hMag = length(h);
  if (hMag < 1e-12) return null;                 // straight-line fall, no orbit plane

  const vxh = cross(v, h);
  let eVec = [
    vxh[0] / mu - r[0] / rMag,
    vxh[1] / mu - r[1] / rMag,
    vxh[2] / mu - r[2] / rMag,
  ];
  let ecc = length(eVec);

  const hHat = normalize(h);
  // For near-circular orbits the periapsis direction is undefined: use r itself
  let pHat = ecc > 1e-6 ? normalize(eVec) : normalize(r);
  if (ecc <= 1e-6) ecc = 0;
  const qHat = cross(hHat, pHat);

  const ell = (hMag * hMag) / mu;                // semi-latus rectum

  // Range of true anomaly: full circle if bound, else limited by the asymptotes
  let nuMax = Math.PI;
  if (ecc >= 1) nuMax = Math.acos(-1 / ecc) * 0.98;

  const pointAt = (nu) => {
    const rad = ell / (1 + ecc * Math.cos(nu));
    return add(center, add(scale(pHat, rad * Math.cos(nu)), scale(qHat, rad * Math.sin(nu))));
  };

  const points = [];
  for (let k = 0; k <= count; k++) {
    const nu = -nuMax + (2 * nuMax * k) / count;
    const rad = ell / (1 + ecc * Math.cos(nu));
    if (rad > 200) continue;                     // skip absurdly far hyperbolic points
    points.push(pointAt(nu));
  }

  const periapsis = pointAt(0);
  const apoapsis = ecc < 1 ? pointAt(Math.PI) : null;

  // Nodes: where the orbit crosses z = 0. Direction n = z_hat x h.
  let nodeUp = null, nodeDown = null;
  const nVec = [-h[1], h[0], 0];
  if (length(nVec) > 1e-9 * hMag) {
    // True anomaly of the ascending node: angle from periapsis to the node direction
    const nHat = normalize(nVec);
    const cosNu = dot(nHat, pHat);
    const sinNu = dot(nHat, qHat);
    const nuNode = Math.atan2(sinNu, cosNu);
    const tryNode = (nu) => {
      if (ecc >= 1 && Math.cos(nu) <= -1 / ecc) return null;   // not on a hyperbola
      return pointAt(nu);
    };
    nodeUp = tryNode(nuNode);
    nodeDown = tryNode(nuNode + Math.PI);
  }

  return { points, periapsis, apoapsis, nodeUp, nodeDown, center };
}