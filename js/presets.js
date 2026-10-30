import { G, addBody, computeAccelerations, radiusFromMass } from './physics.js';

const SUN = 1;
const EARTH = 3.0e-6;
const MOON = 3.7e-8;
const JUPITER = 9.5e-4;
const TWO_PI = Math.PI * 2;

// Adds a body and returns its index
function add(w, mass, pos, vel) {
  return addBody(w, { pos, vel, mass, radius: radiusFromMass(mass) });
}

// Small deterministic random generator, so scenarios are the same every load
function makeRand(seed) {
  let s = seed;
  return () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
}

// Planet on a circular orbit around a central mass at the origin.
// phi = angle of the starting position (also the line of nodes), incl = inclination in degrees.
// incl 90 = polar, incl > 90 = retrograde. vScale = 1 is exactly circular;
// slightly above or below gives an eccentric orbit.
function planet(w, { M = SUN, a, mass, phi = 0, incl = 0, vScale = 1 }) {
  const v = Math.sqrt((G * M) / a) * vScale;
  const i = (incl * Math.PI) / 180;
  const c = Math.cos(phi), s = Math.sin(phi);
  add(w, mass, [a * c, a * s, 0], [-s * v * Math.cos(i), c * v * Math.cos(i), v * Math.sin(i)]);
}

// Body on a circular orbit around another body that already exists (index `parent`).
// Position and velocity are relative to the parent, so it works even if the parent moves.
function orbiter(w, parent, { a, mass, phi = 0, incl = 0 }) {
  const v = Math.sqrt((G * (w.mass[parent] + mass)) / a);
  const i = (incl * Math.PI) / 180;
  const c = Math.cos(phi), s = Math.sin(phi);
  add(w, mass,
    [w.px[parent] + a * c, w.py[parent] + a * s, w.pz[parent]],
    [w.vx[parent] - s * v * Math.cos(i), w.vy[parent] + c * v * Math.cos(i), w.vz[parent] + v * Math.sin(i)]);
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

// Optional fields on each scenario:
//   distance  camera distance (AU)
//   trueScale start in true-scale mode (needed for tiny systems like Earth-Moon)
//   speed     starting simulation speed (years per second)
//   gain      starting launch strength
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
      add(w, 1, [ p[0] * L, p[1] * L, 0], [-v3[0] * vs / 2, -v3[1] * vs / 2, 0]);
      add(w, 1, [0, 0, 0], [v3[0] * vs, v3[1] * vs, 0]);
    },
  },

  // Earth + Moon on their own (no Sun), so the system stays centred on screen.
  // The Moon's real distance is only 0.00257 AU, so this needs true scale and a very close camera.
  earthmoon: {
    name: 'Earth + Moon (true scale)',
    distance: 0.009,
    trueScale: true,
    speed: 0.05,
    gain: 150,
    build(w) {
      const earth = add(w, EARTH, [0, 0, 0], [0, 0, 0]);
      orbiter(w, earth, { a: 0.00257, mass: MOON, phi: 0 });
    },
  },

  // Three moons of one planet: prograde, polar, retrograde
  moons: {
    name: 'Moons: prograde, polar, retrograde',
    distance: 0.012,
    trueScale: true,
    speed: 0.05,
    gain: 150,
    build(w) {
      const earth = add(w, EARTH, [0, 0, 0], [0, 0, 0]);
      orbiter(w, earth, { a: 0.0020, mass: MOON, phi: 0 });                // prograde
      orbiter(w, earth, { a: 0.0027, mass: MOON, phi: 2.0, incl: 90 });    // polar
      orbiter(w, earth, { a: 0.0034, mass: MOON, phi: 4.0, incl: 180 });   // retrograde
    },
  },

  // Jupiter with test asteroids near its L4 (60° ahead) and L5 (60° behind) points
  trojans: {
    name: 'Sun–Jupiter + trojans',
    distance: 14,
    speed: 3,
    build(w) {
      const rand = makeRand(777);
      add(w, SUN, [0, 0, 0], [0, 0, 0]);
      const M = SUN + JUPITER;
      planet(w, { M, a: 5.2, mass: JUPITER, phi: 0 });
      for (let k = 0; k < 10; k++) {
        const side = k % 2 === 0 ? 1 : -1; // L4, then L5, alternating
        const phi = side * (Math.PI / 3) + (rand() - 0.5) * 0.35;
        const a = 5.2 + (rand() - 0.5) * 0.3;
        planet(w, { M, a, mass: 1e-13, phi });
      }
    },
  },

  // A small planet on a slightly eccentric orbit, with a red-dwarf companion on an orbit tilted 55°.
  // Above ~39° of tilt, the planet trades inclination for eccentricity over a few hundred years.
  kozai: {
    name: 'Kozai–Lidov oscillation',
    distance: 9,
    speed: 3,
    build(w) {
      add(w, SUN, [0, 0, 0], [0, 0, 0]);
      planet(w, { a: 0.5, mass: EARTH, phi: 0, vScale: 1.02 });
      planet(w, { M: SUN + 0.1, a: 3, mass: 0.1, phi: 2.0, incl: 55 });
    },
  },

  // Test particles in a thick ring (inclinations within ±8°) around the Sun, with Jupiter stirring them
  belt: {
    name: 'Inclined asteroid belt',
    distance: 12,
    speed: 1,
    build(w) {
      const rand = makeRand(4242);
      add(w, SUN, [0, 0, 0], [0, 0, 0]);
      planet(w, { M: SUN + JUPITER, a: 5.2, mass: JUPITER, phi: 0.5 });
      for (let k = 0; k < 60; k++) {
        planet(w, {
          a: 2.1 + rand() * 1.2,
          mass: 1e-13,
          phi: rand() * TWO_PI,
          incl: (rand() - 0.5) * 16,
          vScale: 0.97 + rand() * 0.06,
        });
      }
    },
  },

  // A comet on an unbound path swings past the Sun. Select it to see "hyperbolic" in the panel.
  flyby: {
    name: 'Hyperbolic flyby',
    distance: 14,
    build(w) {
      add(w, SUN, [0, 0, 0], [0, 0, 0]);
      planet(w, { a: 1.0, mass: EARTH, phi: 1.0 });
      add(w, 1e-14, [-12, 3, 0.5], [4.5, 0, 0]);
    },
  },

  // Three stars started well below circular speed: they fall together and scatter.
  // Tiny changes in the numbers give completely different outcomes.
  chaos: {
    name: 'Chaotic three-body',
    distance: 10,
    speed: 0.3,
    build(w) {
      add(w, 1.0, [-2, 0, 0], [0, -1.2, 0.3]);
      add(w, 1.2, [2, 0, 0], [0, 1.0, -0.3]);
      add(w, 0.8, [0, 3, 0.5], [1.5, 0, 0]);
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