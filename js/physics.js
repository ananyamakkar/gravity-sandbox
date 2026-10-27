export const G = 4 * Math.PI * Math.PI;   // AU^3 / (Msun * yr^2)

export function createWorld(capacity = 512) {
  const f = () => new Float64Array(capacity);
  return {
    n: 0,                       // number of live bodies
    capacity,
    px: f(), py: f(), pz: f(),  // position (AU)
    vx: f(), vy: f(), vz: f(),  // velocity (AU/yr)
    ax: f(), ay: f(), az: f(),  // acceleration
    mass: f(),                  // solar masses
    radius: f(),                // AU (physical radius, used for collisions)
    softening: 1e-4,            // epsilon, in AU
    time: 0,                    // simulated years
  };
}

// Adds a body and returns its index.
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

      // i is pulled toward j, scaled by j's mass
      const fi = G * mass[j] * invD3;
      ax[i] += fi * dx; ay[i] += fi * dy; az[i] += fi * dz;

      // j is pulled toward i, scaled by i's mass (opposite direction)
      const fj = G * mass[i] * invD3;
      ax[j] -= fj * dx; ay[j] -= fj * dy; az[j] -= fj * dz;
    }
  }
}

export function stepVerlet(w, dt) {
  const { n, px, py, pz, vx, vy, vz, ax, ay, az } = w;
  const h = dt / 2;

  // Kick (half step) using current accelerations
  for (let i = 0; i < n; i++) {
    vx[i] += ax[i] * h; vy[i] += ay[i] * h; vz[i] += az[i] * h;
  }
  // Drift (full step)
  for (let i = 0; i < n; i++) {
    px[i] += vx[i] * dt; py[i] += vy[i] * dt; pz[i] += vz[i] * dt;
  }
  // New forces at the new positions
  computeAccelerations(w);
  // Kick (second half step)
  for (let i = 0; i < n; i++) {
    vx[i] += ax[i] * h; vy[i] += ay[i] * h; vz[i] += az[i] * h;
  }
  w.time += dt;
}