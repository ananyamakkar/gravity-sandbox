import { project } from './camera.js';

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  let width = 0, height = 0;

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
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
  const TRAIL_LEN = 200;     // points kept per body
  const TRAIL_DT = 0.002;    // years between recorded points (200 pts = 0.4 yr)
  const trails = [];
  let lastRecord = -Infinity;

  // Called from the physics loop (after each step), not from render.
  function recordTrails(w) {
    if (w.time < lastRecord) lastRecord = -Infinity;      // sim was reset
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
      if (w.mass[i] > 0.05) continue;          // skip stars for now

      const start = (t.head - t.count + TRAIL_LEN) % TRAIL_LEN;
      let prev = null;
      for (let k = 0; k <= t.count; k++) {
        // the last point is the body's live position, so there's no gap at the head
        let wx, wy, wz;
        if (k < t.count) {
          const idx = (start + k) % TRAIL_LEN;
          wx = t.x[idx]; wy = t.y[idx]; wz = t.z[idx];
        } else {
          wx = w.px[i]; wy = w.py[i]; wz = w.pz[i];
        }
        const p = project(cam, [wx, wy, wz], width, height);
        if (p && prev) {
          const f = k / t.count;                       // 0 = tail, 1 = head
          ctx.strokeStyle = `rgba(110, 200, 255, ${Math.pow(f, 2) * 0.9})`;
          ctx.lineWidth = 0.5 + f * 2.5;               // thin tail, thick head
          ctx.beginPath();
          ctx.moveTo(prev.x, prev.y);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
        }
        prev = p;
      }
    }
  }

  // Shows where you're aiming: a dot at the launch point and a line to the cursor
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
  }

  function render(cam, w, aim) {
    ctx.fillStyle = '#05060a';
    ctx.fillRect(0, 0, width, height);
    drawGrid(cam);
    drawTrails(cam, w);
    drawAim(cam, aim);

    for (let i = 0; i < w.n; i++) {
      const p = project(cam, [w.px[i], w.py[i], w.pz[i]], width, height);
      if (!p) continue;
      const isStar = w.mass[i] > 0.05;
      ctx.fillStyle = isStar ? 'orange' : '#6cf';
      ctx.beginPath();
      ctx.arc(p.x, p.y, isStar ? 8 : 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  return { resize, render, recordTrails };
}