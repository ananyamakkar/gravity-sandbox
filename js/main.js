import { createCamera, unproject } from './camera.js';
import { createRenderer } from './renderer2d.js';
import { createWorld, addBody, computeAccelerations, stepVerlet, predictPath } from './physics.js';

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

// ---- UI: inclination slider ----
const inclSlider = document.getElementById('incl');
const inclLabel = document.getElementById('incl-val');
let inclination = 0;   // degrees

inclSlider.addEventListener('input', () => {
  inclination = Number(inclSlider.value);
  inclLabel.textContent = inclination + '°';
});

// ---- UI: camera buttons ----
document.getElementById('btn-top').addEventListener('click', () => {
  cam.pitch = Math.PI / 2;
});
document.getElementById('btn-side').addEventListener('click', () => {
  cam.pitch = 0.05;
});
document.getElementById('btn-reset').addEventListener('click', resetCamera);

const orthoBtn = document.getElementById('btn-ortho');
orthoBtn.addEventListener('click', () => {
  cam.ortho = !cam.ortho;
  orthoBtn.textContent = cam.ortho ? 'Orthographic' : 'Perspective';
});

// Tilts an in-plane drag vector out of the plane by the inclination angle.
function launchVelocity(start, current) {
  const dx = (start[0] - current[0]) * LAUNCH_GAIN;
  const dy = (start[1] - current[1]) * LAUNCH_GAIN;
  const speed = Math.hypot(dx, dy);
  const i = (inclination * Math.PI) / 180;
  const c = Math.cos(i);
  return [dx * c, dy * c, speed * Math.sin(i)];
}

// ---- Input ----
// Left = launch. Right = rotate. Middle or Shift+Left = pan.
const LAUNCH_MASS = 3e-6;
const LAUNCH_GAIN = 4;

let mode = null;              // 'rotate' | 'launch' | 'pan' | null
let lastX = 0, lastY = 0;
let aim = null;

const W = () => window.innerWidth;
const H = () => window.innerHeight;

canvas.addEventListener('contextmenu', (e) => e.preventDefault());

canvas.addEventListener('pointerdown', (e) => {
  lastX = e.clientX;
  lastY = e.clientY;
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
    // Find the plane point under the cursor before and after the move,
    // then shift the camera target by the difference.
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
    const p = unproject(cam, e.clientX, e.clientY, W(), H(), 0);
    if (p) {
      aim.current = p;
      aim.path = predictPath(w, aim.start, launchVelocity(aim.start, p), LAUNCH_MASS);
    }
  }
  lastX = e.clientX;
  lastY = e.clientY;
});

canvas.addEventListener('pointerup', (e) => {
  if (mode === 'launch' && aim) {
    const vel = launchVelocity(aim.start, aim.current);
    addBody(w, { pos: aim.start, vel, mass: LAUNCH_MASS });
    computeAccelerations(w);
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
const DT = 0.0005;
const SPEED = 0.5;

function frame(now) {
  const real = Math.min((now - last) / 1000, 0.1);
  last = now;
  acc += real * SPEED;

  let substeps = 0;
  while (acc >= DT && substeps < 200) {
    stepVerlet(w, DT);
    renderer.recordTrails(w);
    acc -= DT;
    substeps++;
  }
  if (substeps === 200) acc = 0;

  renderer.render(cam, w, aim);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);