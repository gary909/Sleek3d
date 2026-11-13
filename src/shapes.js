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

export function createCylinder({ r = 1, h = 2, sides = SEGMENTS, color = 0x59a96a } = {}) {
  const seg = Math.max(3, Math.round(sides));
  const mesh = build(new THREE.CylinderGeometry(r, r, h, seg), color, 'cylinder', { r, h, sides: seg });
  mesh.position.y = h / 2;
  return mesh;
}

export function createSphere({ r = 1, steps = SEGMENTS, color = 0xf2b134 } = {}) {
  const seg = Math.max(3, Math.round(steps));
  const heightSeg = Math.max(2, Math.round((seg * 2) / 3));
  const mesh = build(new THREE.SphereGeometry(r, seg, heightSeg), color, 'sphere', { r, steps: seg });
  mesh.position.y = r;
  return mesh;
}

export function createCone({ r = 1, h = 2, sides = SEGMENTS, color = 0xe8844d } = {}) {
  const seg = Math.max(3, Math.round(sides));
  const mesh = build(new THREE.ConeGeometry(r, h, seg), color, 'cone', { r, h, sides: seg });
  mesh.position.y = h / 2;
  return mesh;
}

export function createTorus({ r = 1, tube = 0.4, sides = SEGMENTS, color = 0x9b6dd6 } = {}) {
  const seg = Math.max(3, Math.round(sides));
  const mesh = build(new THREE.TorusGeometry(r, tube, 24, seg), color, 'torus', { r, tube, sides: seg });
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

export function createPyramid({ s = 1.4, h = 2, sides = 4, color = 0xe8a33d } = {}) {
  const seg = Math.max(3, Math.round(sides));
  const geometry = new THREE.ConeGeometry(s, h, seg);
  geometry.rotateY(Math.PI / seg);
  const mesh = build(geometry, color, 'pyramid', { s, h, sides: seg });
  mesh.position.y = h / 2;
  return mesh;
}

export function createHemisphere({ r = 1, steps = SEGMENTS, color = 0x4aa88a } = {}) {
  const seg = Math.max(3, Math.round(steps));
  const heightSeg = Math.max(2, Math.round(seg / 3));
  const geometry = new THREE.SphereGeometry(r, seg, heightSeg, 0, Math.PI * 2, 0, Math.PI / 2);
  const mesh = build(geometry, color, 'hemisphere', { r, steps: seg });
  mesh.position.y = 0;
  return mesh;
}

export function createPrism({ r = 1, h = 2, sides = 3, color = 0x7d6bd4 } = {}) {
  const seg = Math.max(3, Math.round(sides));
  const geometry = new THREE.CylinderGeometry(r, r, h, seg);
  geometry.rotateY(Math.PI / 6);
  const mesh = build(geometry, color, 'prism', { r, h, sides: seg });
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

const param = (key, label, min, max, step = 0.1, unit = true, def = min) => ({ key, label, min, max, step, unit, def });

export const SHAPE_DEFS = {
  box: { label: 'Box', factory: createBox, params: [param('w', 'Width', 0.1, 20), param('h', 'Height', 0.1, 20), param('d', 'Depth', 0.1, 20)] },
  cylinder: { label: 'Cylinder', factory: createCylinder, params: [param('r', 'Radius', 0.1, 10), param('h', 'Height', 0.1, 20), param('sides', 'Sides', 3, 64, 1, false, 48)] },
  sphere: { label: 'Sphere', factory: createSphere, params: [param('r', 'Radius', 0.1, 10), param('steps', 'Steps', 3, 64, 1, false, 48)] },
  cone: { label: 'Cone', factory: createCone, params: [param('r', 'Radius', 0.1, 10), param('h', 'Height', 0.1, 20), param('sides', 'Sides', 3, 64, 1, false, 48)] },
  torus: { label: 'Torus', factory: createTorus, params: [param('r', 'Radius', 0.1, 10), param('tube', 'Tube', 0.05, 5, 0.05), param('sides', 'Sides', 3, 64, 1, false, 48)] },
  wedge: { label: 'Wedge', factory: createWedge, params: [param('w', 'Width', 0.1, 20), param('h', 'Height', 0.1, 20), param('d', 'Depth', 0.1, 20)] },
  pyramid: { label: 'Pyramid', factory: createPyramid, params: [param('s', 'Base', 0.1, 10), param('h', 'Height', 0.1, 20), param('sides', 'Sides', 3, 64, 1, false, 4)] },
  hemisphere: { label: 'Hemisphere', factory: createHemisphere, params: [param('r', 'Radius', 0.1, 10), param('steps', 'Steps', 3, 64, 1, false, 48)] },
  prism: { label: 'Prism', factory: createPrism, params: [param('r', 'Radius', 0.1, 10), param('h', 'Height', 0.1, 20), param('sides', 'Sides', 3, 64, 1, false, 3)] },
  star: { label: 'Star', factory: createStar, params: [param('outer', 'Size', 0.1, 10), param('points', 'Points', 3, 12, 1, false), param('d', 'Thickness', 0.1, 5)] },
};

export const SHAPE_FACTORIES = Object.fromEntries(
  Object.entries(SHAPE_DEFS).map(([type, def]) => [type, def.factory])
);

// Rebuild a shape's geometry in place, keeping its transform, color, and hole flag.
export function rebuildShapeGeometry(mesh, params) {
  const def = SHAPE_DEFS[mesh.userData.shapeType];
  if (!def) return false;

  // Compute the old grounded height so we can preserve any manual lift when the
  // dimensions change (a raised shape stays raised instead of snapping back down).
  const oldParams = mesh.userData.params ?? {};
  const oldProbe = def.factory({ ...oldParams });
  const oldGroundY = oldProbe.position.y;
  oldProbe.geometry.dispose();
  oldProbe.material.dispose();

  const lift = mesh.position.y - oldGroundY;

  const fresh = def.factory({ ...params });
  mesh.geometry.dispose();
  mesh.geometry = fresh.geometry;
  mesh.position.y = fresh.position.y + lift;
  mesh.userData.params = { ...params };
  fresh.material.dispose();
  return true;
}

// Fold a shape's current (non-unit) scale into its dimension parameters and reset
// the scale back to 1×. Width/Depth fold their own axes, height folds Y, and
// radial parameters (radius/tube/base/size) fold the horizontal XZ scale. Returns
// true if anything changed.
export function bakeScaleIntoParams(mesh) {
  const def = SHAPE_DEFS[mesh.userData.shapeType];
  if (!def || !mesh.userData.params) return false;

  const s = mesh.scale;
  const nearlyOne = (v) => Math.abs(v - 1) < 1e-6;
  if (nearlyOne(s.x) && nearlyOne(s.y) && nearlyOne(s.z)) return false;

  const p = { ...mesh.userData.params };
  const rh = (s.x + s.z) / 2; // radial dimensions live in the XZ plane
  const mul = (k, f) => {
    if (p[k] != null) p[k] *= f;
  };

  switch (mesh.userData.shapeType) {
    case 'box':
    case 'wedge':
      mul('w', s.x);
      mul('h', s.y);
      mul('d', s.z);
      break;
    case 'cylinder':
    case 'cone':
    case 'prism':
      mul('r', rh);
      mul('h', s.y);
      break;
    case 'pyramid':
      mul('s', rh);
      mul('h', s.y);
      break;
    case 'sphere':
    case 'hemisphere':
      mul('r', Math.cbrt(s.x * s.y * s.z));
      break;
    case 'torus':
      mul('r', rh);
      mul('tube', rh);
      break;
    case 'star':
      mul('outer', rh);
      mul('d', s.z);
      break;
    default:
      return false;
  }

  rebuildShapeGeometry(mesh, p);
  mesh.scale.set(1, 1, 1);
  return true;
}

