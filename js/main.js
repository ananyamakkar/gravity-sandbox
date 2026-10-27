import { createCamera } from './camera.js';
import { createRenderer } from './renderer2d.js';

const canvas = document.getElementById('view');
const renderer = createRenderer(canvas);

const cam = createCamera();
cam.pitch = Math.PI / 3;
cam.yaw = 0.5;
cam.distance = 12;

window.addEventListener('resize', renderer.resize);
renderer.resize();

function frame() {
  renderer.render(cam);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

import { createWorld, addBody, computeAccelerations, stepVerlet } from './physics.js';

const w = createWorld();
addBody(w, { pos: [0, 0, 0], vel: [0, 0, 0], mass: 1 });
addBody(w, { pos: [1, 0, 0], vel: [0, 2 * Math.PI, 0], mass: 0 });  // massless Earth for a clean test
computeAccelerations(w);

const dt = 0.001;                       // years (about 8.8 hours)
const steps = Math.round(1 / dt);       // exactly 1 year
for (let k = 0; k < steps; k++) stepVerlet(w, dt);

console.log('After 1 year, Earth at:', w.px[1], w.py[1], w.pz[1]);
console.log('Should be close to    : 1, 0, 0');
console.log('Sim time:', w.time);