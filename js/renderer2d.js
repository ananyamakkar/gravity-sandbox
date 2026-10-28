import { project, viewMatrix } from './camera.js';
import { mulMatVec } from './vec3.js';

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  let width = 0, height = 0;
  const SHOW_DROP_LINES = true;

  // Visual radii in AU (exaggerated so they're visible)
  const STAR_VIS_RADIUS = 0.1;
  const PLANET_VIS_RADIUS = 0.03;

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function fog(cam, p) {
    const z = p.depth - cam.distance;
    const f = 1 - z / (cam.distance * 2);
    return Math.min(1, Math.max(0.3, f));
  }

  // ---- Starfield: fixed directions on a distant sphere ----
  const STAR_COUNT = 2500;
  const bgStars = [];
  (function makeStarfield() {
    let seed = 12345; // seeded, so the sky is the same every load
    const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let i = 0; i < STAR_COUNT; i++) {
      const z = rand() * 2 - 1;
      const a = rand() * Math.PI * 2;
      const r = Math.sqrt(1 - z * z);
      const b = Math.pow(rand(), 3); // most stars dim, a few bright
      bgStars.push({
        d: [r * Math.cos(a), r * Math.sin(a), z],
        size: 0.5 + b * 1.4,
        alpha: 0.25 + b * 0.75,
        tint: rand(),
      });
    }
  })();

  function drawStarfield(cam) {
    const m = viewMatrix(cam);
    const focal = (height / 2) / Math.tan(cam.fov / 2);
    for (const s of bgStars) {
      const q = mulMatVec(m, s.d);
      if (q[2] < 0.1) continue; // behind the camera
      const x = width / 2 + (q[0] / q[2]) * focal;
      const y = height / 2 - (q[1] / q[2]) * focal;
      if (x < 0 || x > width || y < 0 || y > height) continue;
      const c = s.tint < 0.3 ? '170,190,255' : s.tint < 0.7 ? '255,255,255' : '255,225,190';
      ctx.fillStyle = `rgba(${c},${s.alpha})`;
      ctx.fillRect(x, y, s.size, s.size);
    }
  }

  function drawRing(cam, radius, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    const steps = 128;
    let started = false;
    for (let i = 0; i <= steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      const p = project(cam, [radius * Math.cos(a), radius * Math.sin(a), 0], width, height);
      if (!p) { started = false; continue; }
      if (!started) { ctx.moveTo(p.x, p.y); started = true; }
      else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
  }

  function drawGrid(cam) {
    for (let r = 1; r <= 5; r++) {
      drawRing(cam, r, 'rgba(120, 150, 255, 0.18)');
    }
    ctx.strokeStyle = 'rgba(120, 150, 255, 0.10)';
    ctx.lineWidth = 1;
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      const p1 = project(cam, [0, 0, 0], width, height);
      const p2 = project(cam, [5 * Math.cos(a), 5 * Math.sin(a), 0], width, height);
      if (!p1 || !p2) continue;
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
    }
  }

  // ---- Stars: mass-based colour + additive glow ----
  // 0.1 Msun = red, 1 = yellow-white, 10 = blue-white
  function starColor(m) {
    const t = Math.min(1, Math.max(0, (Math.log10(m) + 1) / 2));
    const lerp = (a, b, k) => a.map((v, i) => Math.round(v + (b[i] - v) * k));
    const red = [255, 120, 80], yellow = [255, 240, 210], blue = [160, 195, 255];
    return t < 0.5 ? lerp(red, yellow, t / 0.5) : lerp(yellow, blue, (t - 0.5) / 0.5);
  }

  // ---- Trails: ring buffers, recorded by SIMULATED time ----
  const TRAIL_LEN = 200;
  const TRAIL_DT = 0.002;
  const trails = [];
  let lastRecord = -Infinity;

  function clearTrails() {
    trails.length = 0;
    lastRecord = -Infinity;
  }

  function recordTrails(w) {
    if (Math.abs(w.time - lastRecord) < TRAIL_DT) return;
    lastRecord = w.time;
    for (let i = 0; i < w.n; i++) {
      if (!trails[i]) {
        trails[i] = {
          x: new Float32Array(TRAIL_LEN),
          y: new Float32Array(TRAIL_LEN),
          z: new Float32Array(TRAIL_LEN),
          head: 0,
          count: 0,
        };
      }
      const t = trails[i];
      t.x[t.head] = w.px[i];
      t.y[t.head] = w.py[i];
      t.z[t.head] = w.pz[i];
      t.head = (t.head + 1) % TRAIL_LEN;
      if (t.count < TRAIL_LEN) t.count++;
    }
  }

  // Trail colour by body type: stars match their glow, planets go by mass
  function trailColor(w, i) {
    const m = w.mass[i];
    if (m > 0.05) return starColor(m);        // star
    if (m > 5e-5) return [255, 190, 120];     // gas giant: tan/orange
    if (m > 1e-6) return [110, 200, 255];     // Earth-sized: blue
    return [190, 190, 200];                   // small rocks: grey
  }

  function drawTrails(cam, w) {
    ctx.lineCap = 'round';
    for (let i = 0; i < w.n; i++) {
      const t = trails[i];
      if (!t || t.count < 2) continue;
      const start = (t.head - t.count + TRAIL_LEN) % TRAIL_LEN;
      let prev = null;
      const [tr, tg, tb] = trailColor(w, i);
      for (let k = 0; k <= t.count; k++) {
        let wx, wy, wz;
        if (k < t.count) {
          const idx = (start + k) % TRAIL_LEN;
          wx = t.x[idx]; wy = t.y[idx]; wz = t.z[idx];
        } else {
          wx = w.px[i]; wy = w.py[i]; wz = w.pz[i];
        }
        const p = project(cam, [wx, wy, wz], width, height);
        if (p && prev) {
          const f = k / t.count;
          ctx.strokeStyle = `rgba(${tr}, ${tg}, ${tb}, ${Math.pow(f, 2) * 0.9 * fog(cam, p)})`;
          ctx.lineWidth = 0.5 + f * 2.5;
          ctx.beginPath();
          ctx.moveTo(prev.x, prev.y);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
        }
        prev = p;
      }
    }
  }

  // Aiming: launch dot, dashed drag line, and the predicted path
  function drawAim(cam, aim) {
    if (!aim) return;
    const a = project(cam, aim.start, width, height);
    const b = project(cam, aim.current, width, height);
    if (!a || !b) return;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#6cf';
    ctx.beginPath();
    ctx.arc(a.x, a.y, 4, 0, Math.PI * 2);
    ctx.fill();
    if (aim.path) {
      ctx.strokeStyle = 'rgba(108, 204, 255, 0.55)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 5]);
      ctx.beginPath();
      let started = false;
      for (const pt of aim.path) {
        const q = project(cam, pt, width, height);
        if (!q) { started = false; continue; }
        if (!started) { ctx.moveTo(q.x, q.y); started = true; }
        else ctx.lineTo(q.x, q.y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // Small labeled marker on the orbit (periapsis, apoapsis, nodes)
  function drawMarker(cam, pt, label, color) {
    if (!pt) return;
    const p = project(cam, pt, width, height);
    if (!p) return;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillText(label, p.x + 7, p.y + 4);
  }

  // The selected body's analytic orbit: ellipse + markers
  function drawOrbit(cam, orbit) {
    if (!orbit || orbit.points.length < 2) return;
    ctx.strokeStyle = 'rgba(255, 220, 120, 0.55)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    let started = false;
    for (const pt of orbit.points) {
      const q = project(cam, pt, width, height);
      if (!q) { started = false; continue; }
      if (!started) { ctx.moveTo(q.x, q.y); started = true; }
      else ctx.lineTo(q.x, q.y);
    }
    if (orbit.apoapsis) ctx.closePath();
    ctx.stroke();
    drawMarker(cam, orbit.periapsis, 'Pe', '#ffd27a');
    drawMarker(cam, orbit.apoapsis, 'Ap', '#ffd27a');
    drawMarker(cam, orbit.nodeUp, '☊ asc', '#7af0a8');
    drawMarker(cam, orbit.nodeDown, '☋ desc', '#f07a9a');
  }

  // Vertical line from the body to the z=0 plane, ending in a shadow dot
  function drawDropLine(cam, x, y, z, p) {
    if (Math.abs(z) < 1e-4) return;
    const g = project(cam, [x, y, 0], width, height);
    if (!g) return;
    const f = fog(cam, p);
    const above = z > 0;
    ctx.strokeStyle = above
      ? `rgba(120, 220, 255, ${0.45 * f})`
      : `rgba(255, 130, 200, ${0.45 * f})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(g.x, g.y);
    ctx.stroke();
    ctx.fillStyle = above
      ? `rgba(120, 220, 255, ${0.6 * f})`
      : `rgba(255, 130, 200, ${0.6 * f})`;
    ctx.beginPath();
    ctx.ellipse(g.x, g.y, 3, 3 * Math.cos(cam.pitch) + 1, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // ---- Merge flashes: glow + expanding particle burst ----
  const activeFlashes = [];
  const FLASH_TIME = 700; // milliseconds

  function addFlashes(events) {
    const now = performance.now();
    for (const ev of events) {
      const parts = [];
      const count = ev.big ? 24 : 12;
      for (let k = 0; k < count; k++) {
        parts.push({ a: Math.random() * Math.PI * 2, s: 0.5 + Math.random() });
      }
      activeFlashes.push({ x: ev.x, y: ev.y, z: ev.z, big: ev.big, born: now, parts });
    }
  }

  function drawFlashes(cam) {
    const now = performance.now();
    ctx.globalCompositeOperation = 'lighter';
    for (let k = activeFlashes.length - 1; k >= 0; k--) {
      const f = activeFlashes[k];
      const t = (now - f.born) / FLASH_TIME;
      if (t >= 1) { activeFlashes.splice(k, 1); continue; }
      const p = project(cam, [f.x, f.y, f.z], width, height);
      if (!p) continue;
      const base = f.big ? 40 : 22;
      const R = base * (0.3 + t);
      const alpha = 1 - t;
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, R);
      g.addColorStop(0, `rgba(255, 240, 200, ${alpha})`);
      g.addColorStop(0.4, `rgba(255, 170, 80, ${alpha * 0.5})`);
      g.addColorStop(1, 'rgba(255, 120, 40, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y, R, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgba(255, 220, 160, ${alpha})`;
      for (const q of f.parts) {
        const d = base * 1.5 * q.s * t;
        ctx.beginPath();
        ctx.arc(p.x + Math.cos(q.a) * d, p.y + Math.sin(q.a) * d, 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  function drawStar(p, mass, r, f) {
    const [cr, cg, cb] = starColor(mass);
    const pulse = 1 + 0.06 * Math.sin(performance.now() / 600 + mass * 10);
    const halo = r * 6 * pulse;

    ctx.globalCompositeOperation = 'lighter';

    // Outer glow / corona
    let g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, halo);
    g.addColorStop(0,    `rgba(${cr},${cg},${cb},${0.55 * f})`);
    g.addColorStop(0.25, `rgba(${cr},${cg},${cb},${0.20 * f})`);
    g.addColorStop(1,    `rgba(${cr},${cg},${cb},0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(p.x, p.y, halo, 0, Math.PI * 2);
    ctx.fill();

    // Bright core
    g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 1.3);
    g.addColorStop(0,   `rgba(255,255,255,${f})`);
    g.addColorStop(0.6, `rgba(${cr},${cg},${cb},${f})`);
    g.addColorStop(1,   `rgba(${cr},${cg},${cb},0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r * 1.3, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalCompositeOperation = 'source-over';
  }

  // ---- Planets: lit spheres ----
  // The star pulling hardest on body i (largest m/d^2), among bodies > 0.05 Msun
  function findLight(w, i) {
    let best = -1, bestPull = 0;
    for (let j = 0; j < w.n; j++) {
      if (j === i || w.mass[j] <= 0.05) continue;
      const dx = w.px[j] - w.px[i], dy = w.py[j] - w.py[i], dz = w.pz[j] - w.pz[i];
      const pull = w.mass[j] / (dx * dx + dy * dy + dz * dz + 1e-12);
      if (pull > bestPull) { bestPull = pull; best = j; }
    }
    return best;
  }

  function drawPlanet(cam, w, i, p, r, f) {
    // Light direction in camera space (defaults to "from the viewer")
    let lx = 0, ly = 0, lz = -1;
    const s = findLight(w, i);
    if (s >= 0) {
      const d = mulMatVec(viewMatrix(cam), [
        w.px[s] - w.px[i], w.py[s] - w.py[i], w.pz[s] - w.pz[i],
      ]);
      const len = Math.hypot(d[0], d[1], d[2]) || 1;
      lx = d[0] / len; ly = d[1] / len; lz = d[2] / len;
    }
    // lz = -1: star on the camera's side (fully lit). lz = +1: star behind (dark)
    const k = 0.25 + 0.75 * (0.5 - 0.5 * lz);
    const shade = (rgb, mul) => `rgb(${rgb.map(v => Math.round(v * mul)).join(',')})`;
    const base = [90, 170, 255];

    const hx = p.x + lx * r * 0.55;
    const hy = p.y - ly * r * 0.55; // screen y is flipped
    const g = ctx.createRadialGradient(hx, hy, r * 0.05, p.x, p.y, r * 1.05);
    g.addColorStop(0,    shade([235, 248, 255], k));
    g.addColorStop(0.45, shade(base, k));
    g.addColorStop(1,    shade([10, 18, 40], 1));

    ctx.globalAlpha = f;
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  function render(cam, w, aim, selected = -1, orbit = null, flashes = []) {
    addFlashes(flashes);
    ctx.fillStyle = '#05060a';
    ctx.fillRect(0, 0, width, height);
    drawStarfield(cam);
    drawGrid(cam);
    drawOrbit(cam, orbit);
    drawTrails(cam, w);
    drawAim(cam, aim);

    // Project everything, then sort far -> near (painter's algorithm)
    const items = [];
    for (let i = 0; i < w.n; i++) {
      const x = w.px[i], y = w.py[i], z = w.pz[i];
      const p = project(cam, [x, y, z], width, height);
      if (p) items.push({ i, x, y, z, p });
    }
    items.sort((a, b) => b.p.depth - a.p.depth);

    for (const it of items) {
      const { i, x, y, z, p } = it;
      const isStar = w.mass[i] > 0.05;
      if (SHOW_DROP_LINES) drawDropLine(cam, x, y, z, p);
      const visRadius = isStar ? STAR_VIS_RADIUS : PLANET_VIS_RADIUS;
      const r = Math.max(2, visRadius * p.scale);
      const f = fog(cam, p);
      if (isStar) drawStar(p, w.mass[i], r, f);
      else drawPlanet(cam, w, i, p, r, f);

      if (i === selected) {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r + 6, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    drawFlashes(cam);
  }

  return { resize, render, recordTrails, clearTrails };
}