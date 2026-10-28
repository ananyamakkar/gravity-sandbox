import { G, addBody, computeAccelerations, radiusFromMass } from './physics.js';

const SUN = 1;

function add(w, mass, pos, vel) {
  addBody(w, { pos, vel, mass, radius: radiusFromMass(mass) });
}

// Planet on a circular orbit around a central mass at the origin.
// phi = angle of the starting position (also the line of nodes), incl = inclination in degrees.
// incl 90 = polar, incl > 90 = retrograde.
function planet(w, { M = SUN, a, mass, phi = 0, incl = 0 }) {
  const v = Math.sqrt((G * M) / a);
  const i = (incl * Math.PI) / 180;
  const c = Math.cos(phi), s = Math.sin(phi);
  add(w, mass, [a * c, a * s, 0], [-s * v * Math.cos(i), c * v * Math.cos(i), v * Math.sin(i)]);
}

// Shift all velocities so the total momentum is zero (the system doesn't drift away)
function zeroMomentum(w) {
  let px = 0, py = 0, pz = 0, m = 0;
  for (let i = 0; i < w.n; i++) {
    px += w.mass[i] * w.vx[i]; py += w.mass[i] * w.vy[i]; pz += w.mass[i] * w.vz[i];
    m += w.mass[i];
  }
  for (let i = 0; i < w.n; i++) {
    w.vx[i] -= px / m; w.vy[i] -= py / m; w.vz[i] -= pz / m;
  }
}

const EARTH = 3.0e-6;

export const PRESETS = {
  earth: {
    name: 'Sun + Earth',
    distance: 8,
    build(w) {
      add(w, SUN, [0, 0, 0], [0, 0, 0]);
      planet(w, { a: 1, mass: EARTH });
    },
  },
  solar: {
    name: 'Inner solar system',
    distance: 12,
    build(w) {
      add(w, SUN, [0, 0, 0], [0, 0, 0]);
      planet(w, { a: 0.387, mass: 1.66e-7, phi: 0.5 }); // Mercury
      planet(w, { a: 0.723, mass: 2.45e-6, phi: 2.2 }); // Venus
      planet(w, { a: 1.0, mass: EARTH, phi: 4.0 });     // Earth
      planet(w, { a: 1.524, mass: 3.2e-7, phi: 5.5 });  // Mars
      planet(w, { a: 5.2, mass: 9.5e-4, phi: 1.0 });    // Jupiter (banded)
      planet(w, { a: 9.5, mass: 2.9e-4, phi: 3.5 });    // Saturn (banded + rings)
    },
  },
  inclined: {
    name: 'Inclined orbits',
    distance: 8,
    build(w) {
      add(w, SUN, [0, 0, 0], [0, 0, 0]);
      planet(w, { a: 1.0, mass: EARTH, phi: 0, incl: 20 });
      planet(w, { a: 1.6, mass: EARTH, phi: 1.5, incl: 45 });
      planet(w, { a: 2.3, mass: EARTH, phi: 3.0, incl: 70 });
      planet(w, { a: 3.0, mass: EARTH, phi: 4.5, incl: 160 }); // retrograde
    },
  },
  polar: {
    name: 'Polar orbit',
    distance: 5,
    build(w) {
      add(w, SUN, [0, 0, 0], [0, 0, 0]);
      planet(w, { a: 1.0, mass: EARTH, phi: 0 });
      planet(w, { a: 0.6, mass: EARTH, phi: 1.0, incl: 90 });
    },
  },
  binary: {
    name: 'Binary star + planet',
    distance: 26,
    build(w) {
      // Two 0.5 Msun stars, 2 AU apart, on circular orbits around their barycenter
      const vStar = Math.sqrt((G * 1.0) / 2) / 2;
      add(w, 0.5, [1, 0, 0], [0, vStar, 0]);
      add(w, 0.5, [-1, 0, 0], [0, -vStar, 0]);
      // Circumbinary planet at 8 AU, orbiting the combined 1 Msun
      planet(w, { M: 1.0, a: 8, mass: EARTH, phi: 1.0 });
    },
  },
  figure8: {
    name: 'Figure-eight (3 stars)',
    distance: 10,
    build(w) {
      // Known periodic solution (Chenciner-Montgomery), scaled to 3 AU and 1 Msun each
      const L = 3, vs = (2 * Math.PI) / Math.sqrt(L);
      const p = [0.97000436, -0.24308753];
      const v3 = [-0.93240737, -0.86473146];
      add(w, 1, [-p[0] * L, -p[1] * L, 0], [-v3[0] * vs / 2, -v3[1] * vs / 2, 0]);
      add(w, 1, [ p[0] * L,  p[1] * L, 0], [-v3[0] * vs / 2, -v3[1] * vs / 2, 0]);
      add(w, 1, [0, 0, 0], [v3[0] * vs, v3[1] * vs, 0]);
    },
  },
  empty: {
    name: 'Empty space + one star',
    distance: 8,
    build(w) {
      add(w, SUN, [0, 0, 0], [0, 0, 0]);
    },
  },
};

// Clears the world and builds a preset. Returns the preset (for camera distance etc.)
export function loadPreset(w, key) {
  const preset = PRESETS[key] || PRESETS.earth;
  w.n = 0;
  w.time = 0;
  preset.build(w);
  zeroMomentum(w);
  computeAccelerations(w);
  return preset;
}