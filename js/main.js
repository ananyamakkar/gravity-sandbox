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
  cam.yaw += 0.003;          // temporary slow spin, to prove 3D works
  renderer.render(cam);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);