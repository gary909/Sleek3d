import * as THREE from 'three';

const SEGMENTS = 48;

function createMaterial(color) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.55,
    metalness: 0.05,
  });
}

function finalize(geometry, color, shapeType) {
  const mesh = new THREE.Mesh(geometry, createMaterial(color));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData = { solid: true, shapeType };
  return mesh;
}

// All primitives are created with their base resting on the ground plane (y = 0),
// so they drop in nicely on the grid.

export function createBox({ w = 2, h = 2, d = 2, color = 0x4a90d9 } = {}) {
  const mesh = finalize(new THREE.BoxGeometry(w, h, d), color, 'box');
  mesh.position.y = h / 2;
  return mesh;
}

export function createCylinder({ r = 1, h = 2, color = 0x59a96a } = {}) {
  const mesh = finalize(new THREE.CylinderGeometry(r, r, h, SEGMENTS), color, 'cylinder');
  mesh.position.y = h / 2;
  return mesh;
}

export function createSphere({ r = 1, color = 0xf2b134 } = {}) {
  const mesh = finalize(new THREE.SphereGeometry(r, SEGMENTS, 32), color, 'sphere');
  mesh.position.y = r;
  return mesh;
}

export function createCone({ r = 1, h = 2, color = 0xe8844d } = {}) {
  const mesh = finalize(new THREE.ConeGeometry(r, h, SEGMENTS), color, 'cone');
  mesh.position.y = h / 2;
  return mesh;
}

export function createTorus({ r = 1, tube = 0.4, color = 0x9b6dd6 } = {}) {
  const mesh = finalize(new THREE.TorusGeometry(r, tube, 24, SEGMENTS), color, 'torus');
  mesh.position.y = r;
  return mesh;
}

export const SHAPE_FACTORIES = {
  box: createBox,
  cylinder: createCylinder,
  sphere: createSphere,
  cone: createCone,
  torus: createTorus,
};
