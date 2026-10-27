import { mulMat, mulMatVec, rotX, rotZ, sub } from './vec3.js';

export function createCamera() {
  return {
    target: [0, 0, 0],      // world point the camera orbits around (AU)
    yaw: 0,                 // radians, spin around z
    pitch: Math.PI / 2,     // radians, PI/2 = straight down (top-down view)
    distance: 5,            // AU from target to camera
    fov: 1.0,               // field of view in radians (perspective only)
    ortho: false,           // true = orthographic projection
  };
}

// Builds the 3x3 matrix that rotates world space into camera space.
// After this, camera space has: +x = screen right, +y = screen up,
// +z = away from the viewer (depth).
export function viewMatrix(cam) {
  // 1) spin the world by -yaw around z
  // 2) tilt the world by (pitch - PI/2) around x
  const spin = rotZ(-cam.yaw);
  const tilt = rotX(cam.pitch - Math.PI / 2);
  return mulMat(tilt, spin);
}

// Projects a world-space point to screen pixels.
// Returns { x, y, depth, scale } or null if it's behind the camera.
export function project(cam, point, width, height) {
  const m = viewMatrix(cam);
  const p = mulMatVec(m, sub(point, cam.target));   // camera-space position

  // Push the point away from the camera along +z by `distance`
  const depth = p[2] + cam.distance;

  let scale;
  if (cam.ortho) {
    // Orthographic: size doesn't depend on depth
    scale = (height / 2) / (cam.distance * Math.tan(cam.fov / 2));
  } else {
    if (depth <= 0.001) return null;                // behind the camera
    const focal = (height / 2) / Math.tan(cam.fov / 2);
    scale = focal / depth;
  }

  return {
    x: width / 2 + p[0] * scale,
    y: height / 2 - p[1] * scale,   // minus because screen y points down
    depth,
    scale,                          // pixels per AU at this depth
  };
}