export const G = 4 * Math.PI * Math.PI;   // AU^3 / (Msun * yr^2)

export function createWorld(capacity = 512) {
  const f = () => new Float64Array(capacity);
  return {
    n: 0,
    capacity,
    px: f(), py: f(), pz: f(),
    vx: f(), vy: f(), vz: f(),
    ax: f(), ay: f(), az: f(),
    mass: f(),
    radius: f(),
    softening: 1e-4,
    time: 0,
  };
}

export function addBody(w, { pos, vel, mass, radius = 0 }) {
  if (w.n >= w.capacity) throw new Error('World is full');
  const i = w.n++;
  w.px[i] = pos[0]; w.py[i] = pos[1]; w.pz[i] = pos[2];
  w.vx[i] = vel[0]; w.vy[i] = vel[1]; w.vz[i] = vel[2];
  w.mass[i] = mass;
  w.radius[i] = radius;
  return i;
}

export function computeAccelerations(w) {
  const { n, px, py, pz, ax, ay, az, mass } = w;
  const eps2 = w.softening * w.softening;

  for (let i = 0; i < n; i++) { ax[i] = 0; ay[i] = 0; az[i] = 0; }

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dx = px[j] - px[i];
      const dy = py[j] - py[i];
      const dz = pz[j] - pz[i];
      const d2 = dx * dx + dy * dy + dz * dz + eps2;
      const invD3 = 1 / (d2 * Math.sqrt(d2));

      const fi = G * mass[j] * invD3;
      ax[i] += fi * dx; ay[i] += fi * dy; az[i] += fi * dz;

      const fj = G * mass[i] * invD3;
      ax[j] -= fj * dx; ay[j] -= fj * dy; az[j] -= fj * dz;
    }
  }
}

export function stepVerlet(w, dt) {
  const { n, px, py, pz, vx, vy, vz, ax, ay, az } = w;
  const h = dt / 2;

  for (let i = 0; i < n; i++) {
    vx[i] += ax[i] * h; vy[i] += ay[i] * h; vz[i] += az[i] * h;
  }
  for (let i = 0; i < n; i++) {
    px[i] += vx[i] * dt; py[i] += vy[i] * dt; pz[i] += vz[i] * dt;
  }
  computeAccelerations(w);
  for (let i = 0; i < n; i++) {
    vx[i] += ax[i] * h; vy[i] += ay[i] * h; vz[i] += az[i] * h;
  }
  w.time += dt;
}

// Copies the world so we can simulate "what if" without touching the real one.
export function cloneWorld(w) {
  const c = createWorld(w.capacity);
  c.n = w.n;
  c.softening = w.softening;
  c.time = w.time;
  for (const key of ['px','py','pz','vx','vy','vz','ax','ay','az','mass','radius']) {
    c[key].set(w[key]);
  }
  return c;
}

// Simulates a ghost body forward and returns its path as an array of [x,y,z].
export function predictPath(w, pos, vel, mass, steps = 400, dt = 0.002) {
  const g = cloneWorld(w);
  const idx = addBody(g, { pos, vel, mass });
  computeAccelerations(g);

  const path = [[pos[0], pos[1], pos[2]]];
  for (let k = 0; k < steps; k++) {
    stepVerlet(g, dt);
    path.push([g.px[idx], g.py[idx], g.pz[idx]]);
  }
  return path;
}

// Conserved quantities of the whole system.
// Potential energy uses the same softened form as the force, so it is consistent.
export function diagnostics(w) {
  const { n, px, py, pz, vx, vy, vz, mass } = w;
  const eps2 = w.softening * w.softening;

  let ke = 0, pe = 0, pscale = 0;
  const P = [0, 0, 0];
  const L = [0, 0, 0];

  for (let i = 0; i < n; i++) {
    const m = mass[i];
    const v2 = vx[i] * vx[i] + vy[i] * vy[i] + vz[i] * vz[i];
    ke += 0.5 * m * v2;
    pscale += m * Math.sqrt(v2);

    P[0] += m * vx[i]; P[1] += m * vy[i]; P[2] += m * vz[i];

    // L = sum m (r x v)
    L[0] += m * (py[i] * vz[i] - pz[i] * vy[i]);
    L[1] += m * (pz[i] * vx[i] - px[i] * vz[i]);
    L[2] += m * (px[i] * vy[i] - py[i] * vx[i]);

    for (let j = i + 1; j < n; j++) {
      const dx = px[j] - px[i];
      const dy = py[j] - py[i];
      const dz = pz[j] - pz[i];
      pe -= G * m * mass[j] / Math.sqrt(dx * dx + dy * dy + dz * dz + eps2);
    }
  }
  return { energy: ke + pe, ke, pe, P, L, pscale };
}