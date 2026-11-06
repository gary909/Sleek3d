import * as THREE from 'three';
import {
  Evaluator,
  Brush,
  ADDITION,
  SUBTRACTION,
  INTERSECTION,
} from 'three-bvh-csg';

const evaluator = new Evaluator();

const OPERATIONS = {
  union: ADDITION,
  subtract: SUBTRACTION,
  intersect: INTERSECTION,
};

// Bake a mesh's world transform into a fresh geometry, then wrap it in a Brush.
// The input geometry is cloned so the original mesh (still in the scene) is untouched.
function toBrush(mesh) {
  mesh.updateMatrixWorld(true);
  const geometry = mesh.geometry.clone();
  geometry.applyMatrix4(mesh.matrixWorld);
  const brush = new Brush(geometry);
  brush.updateMatrixWorld(true);
  return brush;
}

// three-bvh-csg results use `drawRange` to hide unused triangles, which breaks
// exporters (they read the full buffers) and can leave stale vertices around.
// Rebuild a clean, non-indexed geometry that contains only the drawn triangles.
function extractDrawnTriangles(geometry) {
  const { start, count } = geometry.drawRange;
  const index = geometry.index;
  const position = geometry.attributes.position;

  const total = index ? index.count : position.count;
  const end = count === Infinity ? total : start + count;

  const positions = new Float32Array((end - start) * 3);
  let o = 0;
  for (let i = start; i < end; i += 3) {
    const a = index ? index.getX(i) : i;
    const b = index ? index.getX(i + 1) : i + 1;
    const c = index ? index.getX(i + 2) : i + 2;

    positions[o++] = position.getX(a);
    positions[o++] = position.getY(a);
    positions[o++] = position.getZ(a);
    positions[o++] = position.getX(b);
    positions[o++] = position.getY(b);
    positions[o++] = position.getZ(b);
    positions[o++] = position.getX(c);
    positions[o++] = position.getY(c);
    positions[o++] = position.getZ(c);
  }

  const clean = new THREE.BufferGeometry();
  clean.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return clean;
}

// Re-center a (world-space) geometry so its pivot matches its visual center, and
// wrap it in a fresh material + mesh. Keeps dragging/rotation intuitive after baking.
function finalizeGeometry(geometry, colorHex) {
  geometry.computeVertexNormals();

  // The CSG evaluator requires `position`, `uv` and `normal` on every brush.
  // We don't use textures, so add a placeholder `uv` so boolean results can be
  // chained (i.e. combined more than once) without an attribute mismatch.
  if (!geometry.attributes.uv) {
    const uv = new Float32Array(geometry.attributes.position.count * 2);
    geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  }

  geometry.computeBoundingBox();

  const center = geometry.boundingBox.getCenter(new THREE.Vector3());
  geometry.translate(-center.x, -center.y, -center.z);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  const material = new THREE.MeshStandardMaterial({
    color: colorHex,
    roughness: 0.55,
    metalness: 0.05,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.copy(center);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData = { solid: true, shapeType: 'combined' };

  return mesh;
}

export function booleanOperation(meshA, meshB, operation = 'union') {
  const op = OPERATIONS[operation] ?? ADDITION;

  const brushA = toBrush(meshA);
  const brushB = toBrush(meshB);

  const result = evaluator.evaluate(brushA, brushB, op);
  const geometry = extractDrawnTriangles(result.geometry);

  // Free the CSG intermediate geometries.
  result.geometry.dispose();
  brushA.geometry.dispose();
  brushB.geometry.dispose();

  return finalizeGeometry(geometry, meshA.material.color.getHex());
}

// Bake a single mesh's world transform into a fresh, re-centered mesh (no CSG).
export function bakeMesh(mesh) {
  mesh.updateMatrixWorld(true);
  const geometry = mesh.geometry.clone();
  geometry.applyMatrix4(mesh.matrixWorld);
  return finalizeGeometry(geometry, mesh.material.color.getHex());
}

// Flatten a group into a single mesh: union its solids, subtract its holes.
export function combineGroupToMesh(group) {
  const meshes = [];
  group.traverse((o) => {
    if (o.isMesh) meshes.push(o);
  });

  const solids = meshes.filter((m) => m.userData.solid !== false);
  const holes = meshes.filter((m) => m.userData.solid === false);
  if (!solids.length) return null;

  let result = bakeMesh(solids[0]);
  for (let i = 1; i < solids.length; i++) {
    const next = booleanOperation(result, solids[i], 'union');
    result.geometry.dispose();
    result.material.dispose();
    result = next;
  }
  for (const hole of holes) {
    const next = booleanOperation(result, hole, 'subtract');
    result.geometry.dispose();
    result.material.dispose();
    result = next;
  }
  return result;
}
