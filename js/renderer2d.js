import { project } from './camera.js';

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  let width = 0, height = 0;

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // Draw a closed circle of given radius on the z=0 plane
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

  function drawGrid(cam) {
    // Distance rings: 1, 2, 3, 4, 5 AU
    for (let r = 1; r <= 5; r++) {
      drawRing(cam, r, 'rgba(120, 150, 255, 0.18)');
    }
    // Spokes every 30 degrees
    ctx.strokeStyle = 'rgba(120, 150, 255, 0.10)';
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      const p1 = project(cam, [0, 0, 0], width, height);
      const p2 = project(cam, [5 * Math.cos(a), 5 * Math.sin(a), 0], width, height);
      if (!p1 || !p2) continue;
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
    }
  }

  function render(cam) {
    ctx.fillStyle = '#05060a';
    ctx.fillRect(0, 0, width, height);
    drawGrid(cam);

    // Temporary sun at origin
    const s = project(cam, [0, 0, 0], width, height);
    if (s) {
      ctx.fillStyle = 'orange';
      ctx.beginPath();
      ctx.arc(s.x, s.y, 8, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  return { resize, render };
}