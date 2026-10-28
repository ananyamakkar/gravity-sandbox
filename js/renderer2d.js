import { project } from './camera.js';

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

  // ---- Trails: ring buffers, recorded by SIMULATED time ----
  const TRAIL_LEN = 200;
  const TRAIL_DT = 0.002;
  const trails = [];
  let lastRecord = -Infinity;

  function recordTrails(w) {
    if (w.time < lastRecord) {
      lastRecord = -Infinity;
      trails.length = 0;                 // sim was restarted: clear old trails
    }
    if (w.time - lastRecord < TRAIL_DT) return;
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

  function drawTrails(cam, w) {
    ctx.lineCap = 'round';
    for (let i = 0; i < w.n; i++) {
      const t = trails[i];
      if (!t || t.count < 2) continue;
      if (w.mass[i] > 0.05) continue;

      const start = (t.head - t.count + TRAIL_LEN) % TRAIL_LEN;
      let prev = null;
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
          ctx.strokeStyle = `rgba(110, 200, 255, ${Math.pow(f, 2) * 0.9 * fog(cam, p)})`;
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
  const FLASH_TIME = 700;   // milliseconds

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
    ctx.globalCompositeOperation = 'lighter';   // additive: overlapping light accumulates
    for (let k = activeFlashes.length - 1; k >= 0; k--) {
      const f = activeFlashes[k];
      const t = (now - f.born) / FLASH_TIME;     // 0 -> 1 over the flash's life
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

  function render(cam, w, aim, selected = -1, orbit = null, flashes = []) {
    addFlashes(flashes);

    ctx.fillStyle = '#05060a';
    ctx.fillRect(0, 0, width, height);
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

      ctx.globalAlpha = fog(cam, p);
      ctx.fillStyle = isStar ? 'orange' : '#6cf';
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;

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

  return { resize, render, recordTrails };
}