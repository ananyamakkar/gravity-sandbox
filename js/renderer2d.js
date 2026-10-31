import { project, viewMatrix } from './camera.js';
import { mulMat, mulMatVec } from './vec3.js';
import { findDominant } from './orbits.js';

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  let width = 0, height = 0;
  const SHOW_DROP_LINES = true;

  // Visual radii in AU (exaggerated so they're visible)
  const STAR_VIS_RADIUS = 0.1;
  const PLANET_VIS_RADIUS = 0.03;
  const GIANT_VIS_RADIUS = 0.06;
  const GIANT_MASS = 5e-5;   // above this: gas giant (bands)
  const RINGED_MASS = 2e-4;  // above this: also gets rings (Saturn-like)
  const ROCKY_MASS = 1e-6;   // below this: small rocky body

  // Visual vs true scale
  let trueScale = false;
  function setTrueScale(v) { trueScale = v; }

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

  // ---- Adaptive grid: ring spacing follows the zoom ----
  // Rounds up to the next "nice" number: 1, 2, 5, 10 (times a power of ten)
  function niceStep(x) {
    const p = Math.pow(10, Math.floor(Math.log10(x)));
    const m = x / p;
    return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
  }

  function fmtAU(v) {
    if (v >= 1) return String(+v.toPrecision(3));
    if (v >= 0.01) return String(+v.toPrecision(2));
    return v.toExponential(0);
  }

  function drawGrid(cam) {
    // Cover everything from the origin out to the far edge of the view
    const extent = Math.hypot(cam.target[0], cam.target[1]) + cam.distance;
    const step = niceStep(extent / 8);
    const rings = Math.min(12, Math.max(1, Math.ceil(extent / step)));
    const outer = rings * step;

    for (let r = 1; r <= rings; r++) {
      drawRing(cam, r * step, 'rgba(120, 150, 255, 0.18)');
    }

    ctx.strokeStyle = 'rgba(120, 150, 255, 0.10)';
    ctx.lineWidth = 1;
    const p1 = project(cam, [0, 0, 0], width, height);
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      const p2 = project(cam, [outer * Math.cos(a), outer * Math.sin(a), 0], width, height);
      if (!p1 || !p2) continue;
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
    }

    // Distance labels along the +x axis
    ctx.font = '10px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(150, 170, 255, 0.55)';
    for (let r = 1; r <= rings; r++) {
      const q = project(cam, [r * step, 0, 0], width, height);
      if (q) ctx.fillText(fmtAU(r * step) + ' AU', q.x + 4, q.y - 3);
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
  const TRAIL_CAP = 600;  // samples stored per body (the slider picks how many are drawn)
  const TRAIL_DT = 0.002; // simulated years between samples
  let trailLength = 200;  // samples drawn; 0 = trails off
  const trails = [];
  let lastRecord = -Infinity;

  function setTrailLength(n) { trailLength = n; }

  function clearTrails() {
    trails.length = 0;
    lastRecord = -Infinity;
  }

  // Mirrors physics' "move the last body into the freed slot" for trails
  function removeTrail(removed, moved) {
    trails[removed] = trails[moved];
    trails.length = moved;
  }

  function recordTrails(w) {
    if (Math.abs(w.time - lastRecord) < TRAIL_DT) return;
    lastRecord = w.time;
    for (let i = 0; i < w.n; i++) {
      if (!trails[i]) {
        trails[i] = {
          x: new Float32Array(TRAIL_CAP),
          y: new Float32Array(TRAIL_CAP),
          z: new Float32Array(TRAIL_CAP),
          head: 0,
          count: 0,
        };
      }
      const t = trails[i];
      t.x[t.head] = w.px[i];
      t.y[t.head] = w.py[i];
      t.z[t.head] = w.pz[i];
      t.head = (t.head + 1) % TRAIL_CAP;
      if (t.count < TRAIL_CAP) t.count++;
    }
  }

  // Trail colour by body type: stars match their glow, planets go by mass
  function trailColor(w, i) {
    const m = w.mass[i];
    if (m > 0.05) return starColor(m);            // star
    if (m > GIANT_MASS) return [255, 190, 120];   // gas giant: tan/orange
    if (m > ROCKY_MASS) return [110, 200, 255];   // Earth-sized: blue
    return [190, 190, 200];                       // small rocks: grey
  }

  // Strokes the path built so far in one draw call, then starts a fresh path.
  // f = how far along the trail we are (0 = oldest, 1 = newest): controls fade and thickness.
  function strokeChunk(cam, p, f, c) {
    ctx.strokeStyle = `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${Math.pow(f, 2) * 0.9 * fog(cam, p)})`;
    ctx.lineWidth = 0.5 + f * 2.5;
    ctx.stroke();
    ctx.beginPath();
  }

  // Trails are drawn in chunks of several segments (one stroke per chunk, at most ~40
  // strokes per body) instead of one stroke per segment, which keeps long trails cheap.
  function drawTrails(cam, w, follow = -1) {
    if (trailLength < 2) return;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // While following, shift each old sample by how far the followed body has moved since then
    const ft = (follow >= 0 && follow < w.n) ? trails[follow] : null;
    for (let i = 0; i < w.n; i++) {
      if (i === follow) continue;
      const t = trails[i];
      if (!t) continue;
      const n = Math.min(t.count, trailLength);
      if (n < 2) continue;
      const start = (t.head - n + TRAIL_CAP) % TRAIL_CAP;
      const chunk = Math.max(1, Math.ceil(n / 40));
      const col = trailColor(w, i);
      let prev = null;
      let pending = 0; // segments in the path waiting to be stroked
      ctx.beginPath();
      for (let k = 0; k <= n; k++) {
        let wx, wy, wz;
        if (k < n) {
          const idx = (start + k) % TRAIL_CAP;
          wx = t.x[idx]; wy = t.y[idx]; wz = t.z[idx];
          if (ft) {
            const d = n - 1 - k; // samples back from the newest
            if (d >= ft.count) {
              if (pending) { strokeChunk(cam, prev, k / n, col); pending = 0; }
              prev = null;
              continue;
            }
            const fi = (ft.head - 1 - d + TRAIL_CAP) % TRAIL_CAP;
            wx += w.px[follow] - ft.x[fi];
            wy += w.py[follow] - ft.y[fi];
            wz += w.pz[follow] - ft.z[fi];
          }
        } else {
          wx = w.px[i]; wy = w.py[i]; wz = w.pz[i];
        }
        const p = project(cam, [wx, wy, wz], width, height);
        if (p && prev) {
          if (pending === 0) ctx.moveTo(prev.x, prev.y);
          ctx.lineTo(p.x, p.y);
          if (++pending >= chunk) { strokeChunk(cam, p, k / n, col); pending = 0; }
        } else if (pending) {
          strokeChunk(cam, prev, k / n, col);
          pending = 0;
        }
        prev = p;
      }
      if (pending) strokeChunk(cam, prev, 1, col);
    }
  }

  // Aiming: launch dot, dashed drag line, drop line to the z=0 plane, and the predicted path
  function drawAim(cam, aim) {
    if (!aim) return;
    const a = project(cam, aim.start, width, height);
    const b = project(cam, aim.current, width, height);
    if (!a || !b) return;

    // Drop line: shows how far above or below the plane the launch point is
    if (Math.abs(aim.start[2]) > 1e-4) {
      const g = project(cam, [aim.start[0], aim.start[1], 0], width, height);
      if (g) {
        const above = aim.start[2] > 0;
        const col = above ? '120, 220, 255' : '255, 130, 200';
        ctx.strokeStyle = `rgba(${col}, 0.7)`;
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 3]);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(g.x, g.y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = `rgba(${col}, 0.8)`;
        ctx.beginPath();
        ctx.ellipse(g.x, g.y, 3.5, 3.5 * Math.cos(cam.pitch) + 1, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }

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
    g.addColorStop(0, `rgba(${cr},${cg},${cb},${0.55 * f})`);
    g.addColorStop(0.25, `rgba(${cr},${cg},${cb},${0.20 * f})`);
    g.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(p.x, p.y, halo, 0, Math.PI * 2);
    ctx.fill();

    // Bright core
    g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 1.3);
    g.addColorStop(0, `rgba(255,255,255,${f})`);
    g.addColorStop(0.6, `rgba(${cr},${cg},${cb},${f})`);
    g.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r * 1.3, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalCompositeOperation = 'source-over';
  }

  // ---- Planets: lit spheres, with bands and rings for giants ----
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

  // Ring around a planet, tilted in 3D. Draws only the half that is
  // behind (front = false) or in front of (front = true) the planet.
  const RING_TILT = 0.45; // radians
  function drawRingHalf(cam, cx, cy, cz, R, planetDepth, front, color, lineW) {
    const ct = Math.cos(RING_TILT), st = Math.sin(RING_TILT);
    ctx.strokeStyle = color;
    ctx.lineWidth = lineW;
    ctx.beginPath();
    const steps = 96;
    let started = false;
    for (let k = 0; k <= steps; k++) {
      const a = (k / steps) * Math.PI * 2;
      const lx = R * Math.cos(a);
      const ly = R * Math.sin(a) * ct;
      const lz = R * Math.sin(a) * st;
      const q = project(cam, [cx + lx, cy + ly, cz + lz], width, height);
      if (!q || (q.depth < planetDepth) !== front) { started = false; continue; }
      if (!started) { ctx.moveTo(q.x, q.y); started = true; }
      else ctx.lineTo(q.x, q.y);
    }
    ctx.stroke();
  }

  function drawPlanet(cam, w, i, p, r, f) {
    const m = w.mass[i];
    const isGiant = m > GIANT_MASS;
    const hasRings = m > RINGED_MASS;
    const visR = trueScale ? w.radius[i] : (isGiant ? GIANT_VIS_RADIUS : PLANET_VIS_RADIUS);

    // Base colour by type
    let base;
    if (isGiant) base = [225, 185, 130];          // tan gas giant
    else if (m > ROCKY_MASS) base = [90, 170, 255]; // Earth-like
    else base = [175, 150, 125];                  // small rocky: brownish grey

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
    const shade = (rgb, mul) => `rgb(${rgb.map(v => Math.round(Math.min(255, v * mul))).join(',')})`;

    ctx.globalAlpha = f;

    // Ring: back half first (behind the planet)
    const ringIn = visR * 1.5, ringOut = visR * 2.3;
    const ringMid = (ringIn + ringOut) / 2;
    const ringPx = (ringOut - ringIn) * p.scale;
    const ringColor = `rgba(220, 200, 160, ${0.55 * k + 0.15})`;
    if (hasRings) {
      drawRingHalf(cam, w.px[i], w.py[i], w.pz[i], ringMid, p.depth, false, ringColor, Math.max(1.5, ringPx));
    }

    // Sphere with light gradient
    const hx = p.x + lx * r * 0.55;
    const hy = p.y - ly * r * 0.55; // screen y is flipped
    const g = ctx.createRadialGradient(hx, hy, r * 0.05, p.x, p.y, r * 1.05);
    g.addColorStop(0, shade([base[0] + 40, base[1] + 40, base[2] + 40], k));
    g.addColorStop(0.45, shade(base, k));
    g.addColorStop(1, shade([10, 18, 40], 1));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();

    // Bands: stripes clipped to the sphere (only worth drawing if big enough)
    if (isGiant && r > 5) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.clip();
      const bands = 7;
      for (let b = 0; b < bands; b++) {
        const y0 = p.y - r + ((b + 0.25) / bands) * 2 * r;
        const hgt = (2 * r) / bands * 0.5;
        ctx.fillStyle = b % 2 === 0 ? 'rgba(120, 70, 30, 0.28)' : 'rgba(255, 235, 200, 0.12)';
        ctx.fillRect(p.x - r, y0, 2 * r, hgt);
      }
      ctx.restore();
    }

    // Ring: front half (in front of the planet)
    if (hasRings) {
      drawRingHalf(cam, w.px[i], w.py[i], w.pz[i], ringMid, p.depth, true, ringColor, Math.max(1.5, ringPx));
    }
    ctx.globalAlpha = 1;
  }

  // ---- Overlay: center of mass ----
  let showCOM = false;
  function setShowCOM(v) { showCOM = v; }

  function drawCOM(cam, w) {
    if (!showCOM || w.n === 0) return;
    let x = 0, y = 0, z = 0, m = 0;
    for (let i = 0; i < w.n; i++) {
      x += w.mass[i] * w.px[i];
      y += w.mass[i] * w.py[i];
      z += w.mass[i] * w.pz[i];
      m += w.mass[i];
    }
    const p = project(cam, [x / m, y / m, z / m], width, height);
    if (!p) return;
    const s = 7;
    ctx.strokeStyle = 'rgba(255, 120, 120, 0.9)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(p.x, p.y, s, 0, Math.PI * 2);
    ctx.moveTo(p.x - s - 3, p.y); ctx.lineTo(p.x + s + 3, p.y);
    ctx.moveTo(p.x, p.y - s - 3); ctx.lineTo(p.x, p.y + s + 3);
    ctx.stroke();
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255, 120, 120, 0.9)';
    ctx.fillText('CoM', p.x + 10, p.y - 8);
  }

  // ---- Overlay: velocity / acceleration arrows ----
  let showVel = false, showAcc = false;
  function setShowVel(v) { showVel = v; }
  function setShowAcc(v) { showAcc = v; }

  // Arrow length in pixels = 12 + 50 * (this body's magnitude / largest magnitude)
  function drawArrows(cam, w, X, Y, Z, color) {
    let maxMag = 0;
    for (let i = 0; i < w.n; i++) {
      maxMag = Math.max(maxMag, Math.hypot(X[i], Y[i], Z[i]));
    }
    if (maxMag === 0) return;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 1.5;
    for (let i = 0; i < w.n; i++) {
      const mag = Math.hypot(X[i], Y[i], Z[i]);
      if (mag === 0) continue;
      const pos = [w.px[i], w.py[i], w.pz[i]];
      const p = project(cam, pos, width, height);
      if (!p) continue;
      const worldLen = (12 + 50 * (mag / maxMag)) / p.scale;
      const tip = project(cam, [
        pos[0] + (X[i] / mag) * worldLen,
        pos[1] + (Y[i] / mag) * worldLen,
        pos[2] + (Z[i] / mag) * worldLen,
      ], width, height);
      if (!tip) continue;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(tip.x, tip.y);
      ctx.stroke();
      // arrow head
      const ang = Math.atan2(tip.y - p.y, tip.x - p.x);
      const hs = 6;
      ctx.beginPath();
      ctx.moveTo(tip.x, tip.y);
      ctx.lineTo(tip.x - hs * Math.cos(ang - 0.4), tip.y - hs * Math.sin(ang - 0.4));
      ctx.lineTo(tip.x - hs * Math.cos(ang + 0.4), tip.y - hs * Math.sin(ang + 0.4));
      ctx.closePath();
      ctx.fill();
    }
  }

  // ---- Overlay: Hill spheres ----
  let showHill = false;
  function setShowHill(v) { showHill = v; }

  function drawHill(cam, w) {
    if (!showHill) return;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgba(190, 140, 255, 0.6)';
    for (let i = 0; i < w.n; i++) {
      const j = findDominant(w, i);
      if (j < 0 || w.mass[j] <= w.mass[i]) continue; // parent must be heavier
      const dx = w.px[i] - w.px[j], dy = w.py[i] - w.py[j], dz = w.pz[i] - w.pz[j];
      const a = Math.hypot(dx, dy, dz);
      const rH = a * Math.cbrt(w.mass[i] / (3 * w.mass[j]));
      const p = project(cam, [w.px[i], w.py[i], w.pz[i]], width, height);
      if (!p) continue;
      const R = rH * p.scale;
      if (R < 3 || R > 4000) continue; // too small to see / absurdly large
      ctx.beginPath();
      ctx.arc(p.x, p.y, R, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  // ---- Overlay: habitable zone ----
  // Luminosity from mass: L ~ M^3.5 (in solar units). Zone edges: 0.95*sqrt(L) to 1.37*sqrt(L) AU.
  let showHZ = false;
  function setShowHZ(v) { showHZ = v; }

  // Points of a circle in the plane z = cz, as projected screen points (null if any is off-camera)
  function projectedCircle(cam, cx, cy, cz, radius, steps = 96) {
    const pts = [];
    for (let k = 0; k < steps; k++) {
      const a = (k / steps) * Math.PI * 2;
      const q = project(cam, [cx + radius * Math.cos(a), cy + radius * Math.sin(a), cz], width, height);
      if (!q) return null;
      pts.push(q);
    }
    return pts;
  }

  function drawHabitableZone(cam, w) {
    if (!showHZ) return;
    for (let i = 0; i < w.n; i++) {
      if (w.mass[i] <= 0.05) continue; // only stars
      const lum = Math.pow(w.mass[i], 3.5);
      const inner = 0.95 * Math.sqrt(lum);
      const outer = 1.37 * Math.sqrt(lum);
      const a = projectedCircle(cam, w.px[i], w.py[i], w.pz[i], outer);
      const b = projectedCircle(cam, w.px[i], w.py[i], w.pz[i], inner);
      if (!a || !b) continue;
      ctx.beginPath();
      a.forEach((q, k) => (k === 0 ? ctx.moveTo(q.x, q.y) : ctx.lineTo(q.x, q.y)));
      ctx.closePath();
      b.forEach((q, k) => (k === 0 ? ctx.moveTo(q.x, q.y) : ctx.lineTo(q.x, q.y)));
      ctx.closePath();
      ctx.fillStyle = 'rgba(80, 255, 140, 0.10)';
      ctx.fill('evenodd');
      ctx.strokeStyle = 'rgba(80, 255, 140, 0.35)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  // ---- Overlay: orbit plane disc for the selected body ----
  let showPlane = false;
  function setShowPlane(v) { showPlane = v; }

  function drawOrbitPlane(cam, orbit) {
    if (!showPlane || !orbit || !orbit.pHat) return;
    const c = orbit.center;
    // Radius: a bit bigger than the farthest orbit point (capped so hyperbolas stay sane)
    let R = 0;
    for (const pt of orbit.points) {
      R = Math.max(R, Math.hypot(pt[0] - c[0], pt[1] - c[1], pt[2] - c[2]));
    }
    R = Math.min(R * 1.1, cam.distance * 3);
    const steps = 96;
    ctx.beginPath();
    let started = false;
    for (let k = 0; k < steps; k++) {
      const a = (k / steps) * Math.PI * 2;
      const ca = Math.cos(a) * R, sa = Math.sin(a) * R;
      const q = project(cam, [
        c[0] + orbit.pHat[0] * ca + orbit.qHat[0] * sa,
        c[1] + orbit.pHat[1] * ca + orbit.qHat[1] * sa,
        c[2] + orbit.pHat[2] * ca + orbit.qHat[2] * sa,
      ], width, height);
      if (!q) { started = false; continue; }
      if (!started) { ctx.moveTo(q.x, q.y); started = true; }
      else ctx.lineTo(q.x, q.y);
    }
    ctx.closePath();
    ctx.fillStyle = 'rgba(255, 220, 120, 0.07)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 220, 120, 0.25)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // ---- Overlay: distance scale bar ----
  // Pixels per AU at the camera target's depth (same formula for perspective and orthographic).
  let showScaleBar = true;
  function setShowScaleBar(v) { showScaleBar = v; }

  function drawScaleBar(cam) {
    if (!showScaleBar) return;
    const pxPerAU = (height / 2) / (cam.distance * Math.tan(cam.fov / 2));
    const targetPx = 120;
    const au = niceStep(targetPx / pxPerAU);
    const len = au * pxPerAU;
    const x0 = width / 2 - len / 2;
    const x1 = width / 2 + len / 2;
    const y = height - 28;

    ctx.strokeStyle = 'rgba(200, 215, 255, 0.85)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x0, y); ctx.lineTo(x1, y);
    ctx.moveTo(x0, y - 5); ctx.lineTo(x0, y + 5);
    ctx.moveTo(x1, y - 5); ctx.lineTo(x1, y + 5);
    ctx.stroke();

    let label;
    if (au >= 0.01) label = fmtAU(au) + ' AU';
    else label = Math.round(au * 149597870.7).toLocaleString() + ' km';
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(200, 215, 255, 0.9)';
    ctx.textAlign = 'center';
    ctx.fillText(label, width / 2, y - 9);
    ctx.textAlign = 'start';
  }

  // ---- Overlay: gravity field (rubber-sheet grid) ---- // NEW (E)
  let showField = false;
  function setShowField(v) { showField = v; }

  function drawGravityField(cam, w) {
    if (!showField || w.n === 0) return;
    let maxM = 0;
    for (let i = 0; i < w.n; i++) maxM = Math.max(maxM, w.mass[i]);
    if (maxM === 0) return;

    const half = cam.distance * 1.2;          // half-width of the sheet
    const lines = 25, samples = 48;
    const step = (2 * half) / (lines - 1);
    // snap the sheet to a step multiple so it doesn't "swim" while panning
    const cx = Math.round(cam.target[0] / step) * step;
    const cy = Math.round(cam.target[1] / step) * step;

    // ignore bodies far too light to dent the sheet (keeps it fast)
    const src = [];
    for (let i = 0; i < w.n; i++) if (w.mass[i] > maxM * 1e-4) src.push(i);

    const soft = half * 0.03;
    const ref = maxM / (0.1 * half);
    const depthMax = 0.35 * half;

    function sheetZ(x, y) {
      let phi = 0;
      for (const i of src) {
        const dx = x - w.px[i], dy = y - w.py[i], dz = w.pz[i];
        phi += w.mass[i] / (Math.sqrt(dx * dx + dy * dy + dz * dz) + soft);
      }
      return -depthMax * (1 - Math.exp(-phi / ref));
    }

    ctx.strokeStyle = 'rgba(120, 190, 255, 0.35)';
    ctx.lineWidth = 1;
    for (let dir = 0; dir < 2; dir++) {
      for (let l = 0; l < lines; l++) {
        const fixed = -half + l * step;
        ctx.beginPath();
        let started = false;
        for (let s = 0; s <= samples; s++) {
          const t = -half + (s / samples) * 2 * half;
          const x = cx + (dir === 0 ? t : fixed);
          const y = cy + (dir === 0 ? fixed : t);
          const q = project(cam, [x, y, sheetZ(x, y)], width, height);
          if (!q) { started = false; continue; }
          if (!started) { ctx.moveTo(q.x, q.y); started = true; }
          else ctx.lineTo(q.x, q.y);
        }
        ctx.stroke();
      }
    }
  }

  function render(cam, w, aim, selected = -1, orbit = null, flashes = [], follow = -1) {
    addFlashes(flashes);
    ctx.fillStyle = '#05060a';
    ctx.fillRect(0, 0, width, height);
    drawStarfield(cam);
    drawGrid(cam);
    drawGravityField(cam, w);    // NEW (E)
    drawHabitableZone(cam, w);
    drawOrbitPlane(cam, orbit);
    drawOrbit(cam, orbit);
    drawTrails(cam, w, follow);
    drawAim(cam, aim);
    drawCOM(cam, w);
    drawHill(cam, w);

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

      const physR = w.radius[i];
      const visRadius = isStar ? STAR_VIS_RADIUS
        : (w.mass[i] > GIANT_MASS ? GIANT_VIS_RADIUS : PLANET_VIS_RADIUS);
      const r = trueScale
        ? Math.max(isStar ? 3 : 1.5, physR * p.scale)
        : Math.max(2, visRadius * p.scale);
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

    if (showVel) drawArrows(cam, w, w.vx, w.vy, w.vz, 'rgba(120, 255, 160, 0.9)');
    if (showAcc) drawArrows(cam, w, w.ax, w.ay, w.az, 'rgba(255, 150, 90, 0.9)');
    drawFlashes(cam);
    drawScaleBar(cam);
  }

  return { resize, render, recordTrails, clearTrails, removeTrail,
           setTrueScale, setTrailLength, setShowCOM,
           setShowVel, setShowAcc, setShowHill,
           setShowHZ, setShowPlane, setShowScaleBar, setShowField }; // NEW (E): setShowField
}