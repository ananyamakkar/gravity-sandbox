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

import { createWorld, addBody, computeAccelerations, G } from './physics.js';

const w = createWorld();
addBody(w, { pos: [0, 0, 0], vel: [0, 0, 0], mass: 1 });          // Sun
addBody(w, { pos: [1, 0, 0], vel: [0, 2 * Math.PI, 0], mass: 3e-6 }); // Earth
computeAccelerations(w);
console.log('Earth accel:', w.ax[1], w.ay[1], w.az[1]);
console.log('Expected   :', -G, 0, 0);