import { mulMat, mulMatVec, rotX, rotZ, sub, add } from './vec3.js';

export function createCamera() {
  return {
    target: [0, 0, 0],
    yaw: 0,
    pitch: Math.PI / 2,
    distance: 5,
    fov: 1.0,
    ortho: false,
  };
}

export function viewMatrix(cam) {
  const spin = rotZ(-cam.yaw);
  const tilt = rotX(cam.pitch - Math.PI / 2);
  return mulMat(tilt, spin);
}

export function project(cam, point, width, height) {
  const m = viewMatrix(cam);
  const p = mulMatVec(m, sub(point, cam.target));
  const depth = p[2] + cam.distance;

  let scale;
  if (cam.ortho) {
    scale = (height / 2) / (cam.distance * Math.tan(cam.fov / 2));
  } else {
    if (depth <= 0.001) return null;
    const focal = (height / 2) / Math.tan(cam.fov / 2);
    scale = focal / depth;
  }

  return {
    x: width / 2 + p[0] * scale,
    y: height / 2 - p[1] * scale,
    depth,
    scale,
  };
}

// Inverse of project: screen pixel -> point where the ray hits the plane z = planeZ.
// Returns [x, y, z] or null if the ray misses (e.g. looking parallel to the plane).
export function unproject(cam, sx, sy, width, height, planeZ = 0) {
  const m = viewMatrix(cam);
  // The view matrix is a rotation, so its inverse is its transpose
  const mt = [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];

  const focal = (height / 2) / Math.tan(cam.fov / 2);
  let origin, dir;

  if (cam.ortho) {
    const scale = (height / 2) / (cam.distance * Math.tan(cam.fov / 2));
    origin = [(sx - width / 2) / scale, -(sy - height / 2) / scale, -cam.distance];
    dir = [0, 0, 1];
  } else {
    origin = [0, 0, -cam.distance];
    dir = [(sx - width / 2) / focal, -(sy - height / 2) / focal, 1];
  }

  // Rotate the ray from camera space back into world space
  const o = add(mulMatVec(mt, origin), cam.target);
  const d = mulMatVec(mt, dir);

  if (Math.abs(d[2]) < 1e-9) return null;
  const t = (planeZ - o[2]) / d[2];
  if (t < 0) return null;
  return [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t];
}