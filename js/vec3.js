// 3D vector helpers. A vector is just [x, y, z].
// A 3x3 matrix is a flat array of 9 numbers, row by row:
// [m00, m01, m02, m10, m11, m12, m20, m21, m22]

export const add   = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub   = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot   = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

export const length = (a) => Math.hypot(a[0], a[1], a[2]);

export function normalize(a) {
  const len = length(a);
  return len === 0 ? [0, 0, 0] : [a[0] / len, a[1] / len, a[2] / len];
}

// Multiply a 3x3 matrix by a vector
export function mulMatVec(m, v) {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

// Rotation matrices around the x and z axes (angle in radians)
export function rotX(a) {
  const c = Math.cos(a), s = Math.sin(a);
  return [1, 0, 0,  0, c, -s,  0, s, c];
}

export function rotZ(a) {
  const c = Math.cos(a), s = Math.sin(a);
  return [c, -s, 0,  s, c, 0,  0, 0, 1];
}

// Multiply two 3x3 matrices: result = a * b
export function mulMat(a, b) {
  const r = new Array(9);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      r[i * 3 + j] =
        a[i * 3]     * b[j] +
        a[i * 3 + 1] * b[3 + j] +
        a[i * 3 + 2] * b[6 + j];
    }
  }
  return r;
}