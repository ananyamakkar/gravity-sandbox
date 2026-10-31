export const G = 4 * Math.PI * Math.PI; // AU^3 / (Msun * yr^2)

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
    color: new Array(capacity).fill(null),   // null = automatic, or [r, g, b]
    softening: 1e-4,
    time: 0,
  };
}

export function addBody(w, { pos, vel, mass, radius = 0, color = null }) {
  if (w.n >= w.capacity) throw new Error('World is full');
  const i = w.n++;
  w.px[i] = pos[0]; w.py[i] = pos[1]; w.pz[i] = pos[2];
  w.vx[i] = vel[0]; w.vy[i] = vel[1]; w.vz[i] = vel[2];
  w.mass[i] = mass;
  w.radius[i] = radius;
  w.color[i] = color;   
  return i;
}

export function removeBody(w, j) {
  const last = w.n - 1;
  if (j !== last) {
    for (const key of ['px','py','pz','vx','vy','vz','ax','ay','az','mass','radius']) {
      w[key][j] = w[key][last];
    }
  }
  w.color[j] = w.color[last];
  w.color[last] = null;
  w.n--;
  computeAccelerations(w);
  return { removed: j, moved: last };
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
// If frameIdx >= 0, the path is drawn as seen from that body (for the follow camera).
export function predictPath(w, pos, vel, mass, steps = 400, dt = 0.002, frameIdx = -1) {
  const g = cloneWorld(w);
  const idx = addBody(g, { pos, vel, mass });
  computeAccelerations(g);
  const path = [[pos[0], pos[1], pos[2]]];
  const useFrame = frameIdx >= 0 && frameIdx < w.n;
  for (let k = 0; k < steps; k++) {
    stepVerlet(g, dt);
    let x = g.px[idx], y = g.py[idx], z = g.pz[idx];
    if (useFrame) {
      x += w.px[frameIdx] - g.px[frameIdx];
      y += w.py[frameIdx] - g.py[frameIdx];
      z += w.pz[frameIdx] - g.pz[frameIdx];
    }
    path.push([x, y, z]);
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

// ---- Alternative integrators ----

// Explicit Euler: the "what not to do" method. It adds energy every step,
// so orbits spiral outward. Positions use the OLD velocity, velocities use the OLD acceleration.
export function stepEuler(w, dt) {
  const { n, px, py, pz, vx, vy, vz, ax, ay, az } = w;
  for (let i = 0; i < n; i++) {
    px[i] += vx[i] * dt; py[i] += vy[i] * dt; pz[i] += vz[i] * dt;
  }
  for (let i = 0; i < n; i++) {
    vx[i] += ax[i] * dt; vy[i] += ay[i] * dt; vz[i] += az[i] * dt;
  }
  computeAccelerations(w);
  w.time += dt;
}

function triple(cap) {
  return [new Float64Array(cap), new Float64Array(cap), new Float64Array(cap)];
}

// Classic 4th-order Runge-Kutta. Very accurate per step, but not symplectic,
// so energy drifts slowly over long runs.
export function stepRK4(w, dt) {
  const n = w.n;
  if (!w._rk || w._rk.cap !== w.capacity) {
    const c = w.capacity;
    w._rk = { cap: c, p0: triple(c), v0: triple(c), v2: triple(c), v3: triple(c),
              v4: triple(c), a1: triple(c), a2: triple(c), a3: triple(c) };
  }
  const s = w._rk;
  const P = [w.px, w.py, w.pz];
  const V = [w.vx, w.vy, w.vz];
  const A = [w.ax, w.ay, w.az];
  const h = dt / 2;

  // Save the starting state and the starting acceleration (a1)
  for (let c = 0; c < 3; c++) for (let i = 0; i < n; i++) {
    s.p0[c][i] = P[c][i]; s.v0[c][i] = V[c][i]; s.a1[c][i] = A[c][i];
  }

  // Stage 2: half step using v1 (= v0)
  for (let c = 0; c < 3; c++) for (let i = 0; i < n; i++) P[c][i] = s.p0[c][i] + s.v0[c][i] * h;
  computeAccelerations(w);
  for (let c = 0; c < 3; c++) for (let i = 0; i < n; i++) {
    s.a2[c][i] = A[c][i];
    s.v2[c][i] = s.v0[c][i] + s.a1[c][i] * h;
  }

  // Stage 3: half step using v2
  for (let c = 0; c < 3; c++) for (let i = 0; i < n; i++) P[c][i] = s.p0[c][i] + s.v2[c][i] * h;
  computeAccelerations(w);
  for (let c = 0; c < 3; c++) for (let i = 0; i < n; i++) {
    s.a3[c][i] = A[c][i];
    s.v3[c][i] = s.v0[c][i] + s.a2[c][i] * h;
  }

  // Stage 4: full step using v3. Afterwards w.ax/ay/az hold a4.
  for (let c = 0; c < 3; c++) for (let i = 0; i < n; i++) {
    P[c][i] = s.p0[c][i] + s.v3[c][i] * dt;
    s.v4[c][i] = s.v0[c][i] + s.a3[c][i] * dt;
  }
  computeAccelerations(w);

  // Combine the four stages
  for (let c = 0; c < 3; c++) for (let i = 0; i < n; i++) {
    P[c][i] = s.p0[c][i] + (dt / 6) * (s.v0[c][i] + 2 * s.v2[c][i] + 2 * s.v3[c][i] + s.v4[c][i]);
    V[c][i] = s.v0[c][i] + (dt / 6) * (s.a1[c][i] + 2 * s.a2[c][i] + 2 * s.a3[c][i] + A[c][i]);
  }
  computeAccelerations(w); // leave valid accelerations for the next step
  w.time += dt;
}

// Picks an integrator by name
export function step(w, dt, method = 'verlet') {
  if (method === 'euler') stepEuler(w, dt);
  else if (method === 'rk4') stepRK4(w, dt);
  else stepVerlet(w, dt);
}

// Radius from mass at constant density (AU). Calibrated so the Sun is ~0.00465 AU
// and Earth ~4.26e-5 AU (real sizes).
export function radiusFromMass(m) {
  return 0.00465 * Math.cbrt(m);
}

// Merges overlapping bodies (inelastic, momentum-conserving).
// Returns an array of events for the renderer and main loop:
// { x, y, z, size, big, kept, removed, moved }
export function handleCollisions(w, scaleFactor = 1) {
  const events = [];
  let i = 0;
  while (i < w.n) {
    let merged = false;
    for (let j = i + 1; j < w.n; j++) {
      const dx = w.px[j] - w.px[i];
      const dy = w.py[j] - w.py[i];
      const dz = w.pz[j] - w.pz[i];
      const rr = (w.radius[i] + w.radius[j]) * scaleFactor;
      if (dx * dx + dy * dy + dz * dz < rr * rr) {
        mergeBodies(w, i, j, events);
        merged = true;
        break;
      }
    }
    if (!merged) i++;
  }
  return events;
}

function mergeBodies(w, i, j, events) {
  const mi = w.mass[i], mj = w.mass[j];
  const m = mi + mj;
  const wi = mi / m, wj = mj / m;
  w.px[i] = w.px[i] * wi + w.px[j] * wj;
  w.py[i] = w.py[i] * wi + w.py[j] * wj;
  w.pz[i] = w.pz[i] * wi + w.pz[j] * wj;
  w.vx[i] = w.vx[i] * wi + w.vx[j] * wj;
  w.vy[i] = w.vy[i] * wi + w.vy[j] * wj;
  w.vz[i] = w.vz[i] * wi + w.vz[j] * wj;
  w.mass[i] = m;
  w.radius[i] = radiusFromMass(m);
  if (mj > mi) w.color[i] = w.color[j];
  // w.n has not been decremented yet, so w.n - 1 is the slot that gets moved into j
  events.push({ x: w.px[i], y: w.py[i], z: w.pz[i], size: Math.cbrt(Math.min(mi, mj)), big: m > 0.05,
                kept: i, removed: j, moved: w.n - 1 });

  // Remove j by moving the last body into its slot
  const last = w.n - 1;
  if (j !== last) {
    for (const key of ['px','py','pz','vx','vy','vz','ax','ay','az','mass','radius']) {
      w[key][j] = w[key][last];
    }
  }
  w.color[j] = w.color[last];
  w.color[last] = null;
  w.n--;
  computeAccelerations(w);
}

// Safe timestep from the closest pair: a fraction (eta) of the pair's
// free-fall timescale sqrt(d^3 / (G (m1 + m2))).
export function adaptiveDt(w, eta = 0.02) {
  const { n, px, py, pz, mass } = w;
  const eps2 = w.softening * w.softening;
  let t2min = Infinity;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dx = px[j] - px[i], dy = py[j] - py[i], dz = pz[j] - pz[i];
      const d2 = dx * dx + dy * dy + dz * dz + eps2;
      const t2 = (d2 * Math.sqrt(d2)) / (G * (mass[i] + mass[j]));
      if (t2 < t2min) t2min = t2;
    }
  }
  return Math.max(1e-6, eta * Math.sqrt(t2min));
}

