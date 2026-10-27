import { createCamera, project, unproject } from './camera.js';
import { createRenderer } from './renderer2d.js';
import { createWorld, addBody, computeAccelerations, stepVerlet, predictPath } from './physics.js';
import { orbitalElements, AU_YR_TO_KMS } from './orbits.js';

const canvas = document.getElementById('view');
const renderer = createRenderer(canvas);

// ---- Camera ----
const cam = createCamera();
function resetCamera() {
  cam.target = [0, 0, 0];
  cam.yaw = 0.5;
  cam.pitch = Math.PI / 3;
  cam.distance = 8;
}
resetCamera();

// ---- World ----
const w = createWorld();
addBody(w, { pos: [0, 0, 0], vel: [0, 0, 0], mass: 1 });
addBody(w, { pos: [1, 0, 0], vel: [0, 2 * Math.PI, 0], mass: 3e-6 });
computeAccelerations(w);

window.addEventListener('resize', renderer.resize);
renderer.resize();

const W = () => window.innerWidth;
const H = () => window.innerHeight;

// ---- Time controls ----
const DT = 0.0005;
let speed = 0.5;            // simulated years per real second
let paused = false;
let stepOnce = false;

const playBtn = document.getElementById('btn-play');
const stepBtn = document.getElementById('btn-step');
const speedSlider = document.getElementById('speed');
const speedLabel = document.getElementById('speed-val');

function setPaused(p) {
  paused = p;
  playBtn.textContent = paused ? 'Play' : 'Pause';
}
playBtn.addEventListener('click', () => setPaused(!paused));
stepBtn.addEventListener('click', () => { setPaused(true); stepOnce = true; });

// Slider is log10(speed): -2 -> 0.01 yr/s, 2 -> 100 yr/s
speedSlider.addEventListener('input', () => {
  speed = Math.pow(10, Number(speedSlider.value));
  speedLabel.textContent = speed.toFixed(speed < 1 ? 2 : 1) + ' yr/s';
});

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') {
    e.preventDefault();
    setPaused(!paused);
  }
});

// ---- UI: inclination slider ----
const inclSlider = document.getElementById('incl');
const inclLabel = document.getElementById('incl-val');
let inclination = 0;

inclSlider.addEventListener('input', () => {
  inclination = Number(inclSlider.value);
  inclLabel.textContent = inclination + '°';
});

// ---- UI: camera buttons ----
document.getElementById('btn-top').addEventListener('click', () => { cam.pitch = Math.PI / 2; });
document.getElementById('btn-side').addEventListener('click', () => { cam.pitch = 0.05; });
document.getElementById('btn-reset').addEventListener('click', resetCamera);

const orthoBtn = document.getElementById('btn-ortho');
orthoBtn.addEventListener('click', () => {
  cam.ortho = !cam.ortho;
  orthoBtn.textContent = cam.ortho ? 'Orthographic' : 'Perspective';
});

// ---- Launch velocity ----
const LAUNCH_MASS = 3e-6;
const LAUNCH_GAIN = 4;

function launchVelocity(start, current) {
  const dx = (start[0] - current[0]) * LAUNCH_GAIN;
  const dy = (start[1] - current[1]) * LAUNCH_GAIN;
  const spd = Math.hypot(dx, dy);
  const i = (inclination * Math.PI) / 180;
  const c = Math.cos(i);
  return [dx * c, dy * c, spd * Math.sin(i)];
}

// ---- Picking: nearest body to the click, in screen space ----
let selected = -1;

function pickBody(sx, sy) {
  let best = -1, bestScore = Infinity;
  for (let i = 0; i < w.n; i++) {
    const p = project(cam, [w.px[i], w.py[i], w.pz[i]], W(), H());
    if (!p) continue;
    const d = Math.hypot(p.x - sx, p.y - sy);
    const tolerance = 16;
    if (d > tolerance) continue;
    const score = d + p.depth * 0.01;
    if (score < bestScore) { bestScore = score; best = i; }
  }
  return best;
}

// ---- Info panel ----
const infoEl = document.getElementById('info');

const fmt = (x, d = 3) => (x === null || x === undefined ? '—' : Number(x).toFixed(d));
const row = (k, v) => `<div class="row"><span>${k}</span><span>${v}</span></div>`;

function updateInfo() {
  if (selected < 0 || selected >= w.n) {
    infoEl.hidden = true;
    return;
  }
  infoEl.hidden = false;

  const i = selected;
  const el = orbitalElements(w, i);
  const earthMasses = w.mass[i] / 3.003e-6;

  let html = `<h3>Body #${i}</h3>`;
  html += row('Mass', w.mass[i] >= 0.01
    ? fmt(w.mass[i], 3) + ' M☉'
    : fmt(earthMasses, 2) + ' M⊕');
  html += row('Position (AU)', `${fmt(w.px[i], 2)}, ${fmt(w.py[i], 2)}, ${fmt(w.pz[i], 2)}`);

  if (!el) {
    html += '<div class="sec">No other bodies</div>';
    infoEl.innerHTML = html;
    return;
  }

  html += `<div class="sec">Around body #${el.dominant}</div>`;
  html += row('Distance', fmt(el.dist, 3) + ' AU');
  html += row('Speed', fmt(el.speed * AU_YR_TO_KMS, 2) + ' km/s');
  html += row('Circular speed', fmt(el.vCirc * AU_YR_TO_KMS, 2) + ' km/s');
  html += row('Escape speed', fmt(el.vEsc * AU_YR_TO_KMS, 2) + ' km/s');

  html += `<div class="sec">Orbit</div>`;
  html += row('Type', el.type + (el.bound ? ' (bound)' : ' (escaping)'));
  html += row('Eccentricity', fmt(el.ecc, 4));
  html += row('Semi-major axis', el.type === 'parabolic' ? '∞' : fmt(el.a, 3) + ' AU');
  html += row('Periapsis', fmt(el.peri, 3) + ' AU');
  html += row('Apoapsis', el.apo === null ? '—' : fmt(el.apo, 3) + ' AU');
  html += row('Period', el.period === null ? '—' : fmt(el.period, 3) + ' yr');

  html += `<div class="sec">Orientation</div>`;
  html += row('Inclination', fmt(el.incl, 1) + '°' + (el.retrograde ? ' (retrograde)' : ''));
  html += row('Ascending node Ω', el.node === null ? '—' : fmt(el.node, 1) + '°');
  html += row('Arg. periapsis ω', el.argPeri === null ? '—' : fmt(el.argPeri, 1) + '°');
  html += row('True anomaly ν', el.nu === null ? '—' : fmt(el.nu, 1) + '°');

  infoEl.innerHTML = html;
}

// ---- Input ----
let mode = null;
let lastX = 0, lastY = 0;
let downX = 0, downY = 0;
let aim = null;
const CLICK_THRESHOLD = 5;

canvas.addEventListener('contextmenu', (e) => e.preventDefault());

canvas.addEventListener('pointerdown', (e) => {
  lastX = downX = e.clientX;
  lastY = downY = e.clientY;
  canvas.setPointerCapture(e.pointerId);

  if (e.button === 1 || (e.button === 0 && e.shiftKey)) {
    e.preventDefault();
    mode = 'pan';
  } else if (e.button === 0) {
    const p = unproject(cam, e.clientX, e.clientY, W(), H(), 0);
    if (p) {
      mode = 'launch';
      aim = { start: p, current: p, path: null };
    }
  } else {
    mode = 'rotate';
  }
});

canvas.addEventListener('pointermove', (e) => {
  if (mode === 'rotate') {
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    cam.yaw -= dx * 0.005;
    cam.pitch = Math.min(Math.PI / 2, Math.max(0.05, cam.pitch + dy * 0.005));
  } else if (mode === 'pan') {
    const p0 = unproject(cam, lastX, lastY, W(), H(), 0);
    const p1 = unproject(cam, e.clientX, e.clientY, W(), H(), 0);
    if (p0 && p1) {
      cam.target = [
        cam.target[0] + (p0[0] - p1[0]),
        cam.target[1] + (p0[1] - p1[1]),
        cam.target[2],
      ];
    }
  } else if (mode === 'launch') {
    const moved = Math.hypot(e.clientX - downX, e.clientY - downY);
    if (moved >= CLICK_THRESHOLD) {
      const p = unproject(cam, e.clientX, e.clientY, W(), H(), 0);
      if (p) {
        aim.current = p;
        aim.path = predictPath(w, aim.start, launchVelocity(aim.start, p), LAUNCH_MASS);
      }
    }
  }
  lastX = e.clientX;
  lastY = e.clientY;
});

canvas.addEventListener('pointerup', (e) => {
  if (mode === 'launch' && aim) {
    const moved = Math.hypot(e.clientX - downX, e.clientY - downY);
    if (moved < CLICK_THRESHOLD) {
      selected = pickBody(e.clientX, e.clientY);
    } else {
      const vel = launchVelocity(aim.start, aim.current);
      addBody(w, { pos: aim.start, vel, mass: LAUNCH_MASS });
      computeAccelerations(w);
    }
  }
  mode = null;
  aim = null;
  canvas.releasePointerCapture(e.pointerId);
});

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  cam.distance *= Math.exp(e.deltaY * 0.001);
  cam.distance = Math.min(200, Math.max(0.2, cam.distance));
}, { passive: false });

// ---- Main loop ----
let last = performance.now();
let acc = 0;
let lastInfo = 0;

function frame(now) {
  const real = Math.min((now - last) / 1000, 0.1);
  last = now;

  if (!paused) acc += real * speed;

  let substeps = 0;
  if (stepOnce) {
    stepVerlet(w, DT);
    renderer.recordTrails(w);
    stepOnce = false;
  }
  while (acc >= DT && substeps < 200) {
    stepVerlet(w, DT);
    renderer.recordTrails(w);
    acc -= DT;
    substeps++;
  }
  if (substeps === 200) acc = 0;

  renderer.render(cam, w, aim, selected);

  if (now - lastInfo > 100) {
    updateInfo();
    lastInfo = now;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);