import * as THREE from 'three';

const SEGMENTS = 48;

function createMaterial(color) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.55,
    metalness: 0.05,
  });
}

function build(geometry, color, shapeType, params) {
  const mesh = new THREE.Mesh(geometry, createMaterial(color));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData = { solid: true, shapeType, params };
  return mesh;
}

// All primitives are created with their base resting on the ground plane (y = 0),
// so they drop in nicely on the grid.

export function createBox({ w = 2, h = 2, d = 2, color = 0x4a90d9 } = {}) {
  const mesh = build(new THREE.BoxGeometry(w, h, d), color, 'box', { w, h, d });
  mesh.position.y = h / 2;
  return mesh;
}

export function createCylinder({ r = 1, h = 2, color = 0x59a96a } = {}) {
  const mesh = build(new THREE.CylinderGeometry(r, r, h, SEGMENTS), color, 'cylinder', { r, h });
  mesh.position.y = h / 2;
  return mesh;
}

export function createSphere({ r = 1, color = 0xf2b134 } = {}) {
  const mesh = build(new THREE.SphereGeometry(r, SEGMENTS, 32), color, 'sphere', { r });
  mesh.position.y = r;
  return mesh;
}

export function createCone({ r = 1, h = 2, color = 0xe8844d } = {}) {
  const mesh = build(new THREE.ConeGeometry(r, h, SEGMENTS), color, 'cone', { r, h });
  mesh.position.y = h / 2;
  return mesh;
}

export function createTorus({ r = 1, tube = 0.4, color = 0x9b6dd6 } = {}) {
  const mesh = build(new THREE.TorusGeometry(r, tube, 24, SEGMENTS), color, 'torus', { r, tube });
  mesh.position.y = r;
  return mesh;
}

export function createWedge({ w = 2, h = 2, d = 2, color = 0x5a9bd4 } = {}) {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(w, 0);
  shape.lineTo(0, h);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: false });
  geometry.translate(-w / 2, 0, -d / 2);
  const mesh = build(geometry, color, 'wedge', { w, h, d });
  mesh.position.y = 0;
  return mesh;
}

export function createPyramid({ s = 1.4, h = 2, color = 0xe8a33d } = {}) {
  const geometry = new THREE.ConeGeometry(s, h, 4);
  geometry.rotateY(Math.PI / 4);
  const mesh = build(geometry, color, 'pyramid', { s, h });
  mesh.position.y = h / 2;
  return mesh;
}

export function createHemisphere({ r = 1, color = 0x4aa88a } = {}) {
  const geometry = new THREE.SphereGeometry(r, SEGMENTS, 16, 0, Math.PI * 2, 0, Math.PI / 2);
  const mesh = build(geometry, color, 'hemisphere', { r });
  mesh.position.y = 0;
  return mesh;
}

export function createPrism({ r = 1, h = 2, color = 0x7d6bd4 } = {}) {
  const geometry = new THREE.CylinderGeometry(r, r, h, 3);
  geometry.rotateY(Math.PI / 6);
  const mesh = build(geometry, color, 'prism', { r, h });
  mesh.position.y = h / 2;
  return mesh;
}

function starShape(outer, inner, points) {
  const shape = new THREE.Shape();
  for (let i = 0; i < points * 2; i++) {
    const radius = i % 2 === 0 ? outer : inner;
    const angle = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  return shape;
}

export function createStar({ outer = 1.2, points = 5, d = 0.4, color = 0xedd24a } = {}) {
  const p = Math.max(3, Math.round(points || 5));
  const inner = outer * 0.5;
  const geometry = new THREE.ExtrudeGeometry(starShape(outer, inner, p), { depth: d, bevelEnabled: false });
  geometry.translate(0, 0, -d / 2);
  const mesh = build(geometry, color, 'star', { outer, points: p, d });
  mesh.position.y = outer;
  return mesh;
}

// --- registry ----------------------------------------------------------------

const param = (key, label, min, max, step = 0.1) => ({ key, label, min, max, step });

export const SHAPE_DEFS = {
  box: { label: 'Box', factory: createBox, params: [param('w', 'Width', 0.1, 20), param('h', 'Height', 0.1, 20), param('d', 'Depth', 0.1, 20)] },
  cylinder: { label: 'Cylinder', factory: createCylinder, params: [param('r', 'Radius', 0.1, 10), param('h', 'Height', 0.1, 20)] },
  sphere: { label: 'Sphere', factory: createSphere, params: [param('r', 'Radius', 0.1, 10)] },
  cone: { label: 'Cone', factory: createCone, params: [param('r', 'Radius', 0.1, 10), param('h', 'Height', 0.1, 20)] },
  torus: { label: 'Torus', factory: createTorus, params: [param('r', 'Radius', 0.1, 10), param('tube', 'Tube', 0.05, 5, 0.05)] },
  wedge: { label: 'Wedge', factory: createWedge, params: [param('w', 'Width', 0.1, 20), param('h', 'Height', 0.1, 20), param('d', 'Depth', 0.1, 20)] },
  pyramid: { label: 'Pyramid', factory: createPyramid, params: [param('s', 'Base', 0.1, 10), param('h', 'Height', 0.1, 20)] },
  hemisphere: { label: 'Hemisphere', factory: createHemisphere, params: [param('r', 'Radius', 0.1, 10)] },
  prism: { label: 'Prism', factory: createPrism, params: [param('r', 'Radius', 0.1, 10), param('h', 'Height', 0.1, 20)] },
  star: { label: 'Star', factory: createStar, params: [param('outer', 'Size', 0.1, 10), param('points', 'Points', 3, 12, 1), param('d', 'Thickness', 0.1, 5)] },
};

export const SHAPE_FACTORIES = Object.fromEntries(
  Object.entries(SHAPE_DEFS).map(([type, def]) => [type, def.factory])
);

// Rebuild a shape's geometry in place, keeping its transform, color, and hole flag.
export function rebuildShapeGeometry(mesh, params) {
  const def = SHAPE_DEFS[mesh.userData.shapeType];
  if (!def) return false;
  const fresh = def.factory({ ...params });
  mesh.geometry.dispose();
  mesh.geometry = fresh.geometry;
  mesh.position.y = fresh.position.y;
  mesh.userData.params = { ...params };
  fresh.material.dispose();
  return true;
}

