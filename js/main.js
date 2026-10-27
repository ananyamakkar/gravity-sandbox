import { createCamera } from './camera.js';
import { createRenderer } from './renderer2d.js';
import { createWorld, addBody, computeAccelerations, stepVerlet } from './physics.js';

const canvas = document.getElementById('view');
const renderer = createRenderer(canvas);

const cam = createCamera();
cam.pitch = Math.PI / 3;
cam.yaw = 0.5;
cam.distance = 5;

const w = createWorld();
addBody(w, { pos: [0, 0, 0], vel: [0, 0, 0], mass: 1 });
addBody(w, { pos: [1, 0, 0], vel: [0, 2 * Math.PI, 0], mass: 3e-6 });
computeAccelerations(w);

window.addEventListener('resize', renderer.resize);
renderer.resize();

let last = performance.now();
let acc = 0;
const DT = 0.0005;          // fixed physics step, years
const SPEED = 0.5;          // simulated years per real second

function frame(now) {
  const real = Math.min((now - last) / 1000, 0.1);   // cap to avoid huge jumps
  last = now;
  acc += real * SPEED;

  let substeps = 0;
  while (acc >= DT && substeps < 200) {
    stepVerlet(w, DT);
    acc -= DT;
    substeps++;
  }
  if (substeps === 200) acc = 0;   // too slow: drop time instead of freezing

  renderer.render(cam, w);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);