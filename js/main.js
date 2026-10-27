import { createCamera, project } from './camera.js';

const canvas = document.getElementById('view');
const ctx = canvas.getContext('2d');

let width = 0;   // size in CSS pixels
let height = 0;

const cam = createCamera();
cam.pitch = Math.PI / 3;   // 60 degrees: slightly tilted, so 3D is visible
cam.yaw = 0.5;

function resize() {
  const dpr = window.devicePixelRatio || 1;
  width = window.innerWidth;
  height = window.innerHeight;

  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);

  // Scale so 1 unit we draw = 1 CSS pixel
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  draw();
}

function draw() {
  ctx.fillStyle = '#05060a';
  ctx.fillRect(0, 0, width, height);

  // Draw a ring of points at radius 1 AU on the z=0 plane
  ctx.fillStyle = 'white';
  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * Math.PI * 2;
    const p = project(cam, [Math.cos(a), Math.sin(a), 0], width, height);
    if (!p) continue;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
    ctx.fill();
  }

  // The "sun" at the origin
  const s = project(cam, [0, 0, 0], width, height);
  ctx.fillStyle = 'orange';
  ctx.beginPath();
  ctx.arc(s.x, s.y, 8, 0, Math.PI * 2);
  ctx.fill();
}

window.addEventListener('resize', resize);
resize();