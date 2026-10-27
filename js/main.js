import { createCamera, unproject } from './camera.js';
import { createRenderer } from './renderer2d.js';
import { createWorld, addBody, computeAccelerations, stepVerlet } from './physics.js';

const canvas = document.getElementById('view');
const renderer = createRenderer(canvas);

const cam = createCamera();
cam.pitch = Math.PI / 3;
cam.yaw = 0.5;
cam.distance = 8;

const w = createWorld();
addBody(w, { pos: [0, 0, 0], vel: [0, 0, 0], mass: 1 });
addBody(w, { pos: [1, 0, 0], vel: [0, 2 * Math.PI, 0], mass: 3e-6 });
computeAccelerations(w);

window.addEventListener('resize', renderer.resize);
renderer.resize();

// ---- Input ----
// Right button (or middle) = rotate camera. Left button = launch a body.
const LAUNCH_MASS = 3e-6;     // solar masses (about an Earth)
const LAUNCH_GAIN = 4;        // (AU/yr) of speed per AU of drag

let mode = null;              // 'rotate' | 'launch' | null
let lastX = 0, lastY = 0;
let aim = null;               // { start: [x,y,z], current: [x,y,z] } while aiming

canvas.addEventListener('contextmenu', (e) => e.preventDefault());

canvas.addEventListener('pointerdown', (e) => {
  lastX = e.clientX;
  lastY = e.clientY;
  canvas.setPointerCapture(e.pointerId);

  if (e.button === 0) {
    const p = unproject(cam, e.clientX, e.clientY, window.innerWidth, window.innerHeight, 0);
    if (p) {
      mode = 'launch';
      aim = { start: p, current: p };
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
  } else if (mode === 'launch') {
    const p = unproject(cam, e.clientX, e.clientY, window.innerWidth, window.innerHeight, 0);
    if (p) aim.current = p;
  }
  lastX = e.clientX;
  lastY = e.clientY;
});

canvas.addEventListener('pointerup', (e) => {
  if (mode === 'launch' && aim) {
    // Slingshot: velocity points opposite to the drag
    const vel = [
      (aim.start[0] - aim.current[0]) * LAUNCH_GAIN,
      (aim.start[1] - aim.current[1]) * LAUNCH_GAIN,
      0,
    ];
    addBody(w, { pos: aim.start, vel, mass: LAUNCH_MASS });
    computeAccelerations(w);   // the new body needs valid accelerations
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