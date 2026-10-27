import { rotX, rotZ, mulMat, mulMatVec } from './vec3.js';

// Temporary test: rotating [1,0,0] by 90° around z should give about [0,1,0]
console.log(mulMatVec(rotZ(Math.PI / 2), [1, 0, 0]));

const canvas = document.getElementById('view');
const ctx = canvas.getContext('2d');

let width = 0;   // size in CSS pixels
let height = 0;

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

  ctx.fillStyle = 'white';
  ctx.beginPath();
  ctx.arc(width / 2, height / 2, 20, 0, Math.PI * 2);
  ctx.fill();
}

window.addEventListener('resize', resize);
resize();