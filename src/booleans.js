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

  geometry.computeVertexNormals();
  geometry.computeBoundingBox();

  // Re-center so the mesh's pivot matches its visual center. This keeps dragging
  // and rotation intuitive after combining (the geometry is otherwise baked in
  // world space with the pivot at the origin).
  const center = geometry.boundingBox.getCenter(new THREE.Vector3());
  geometry.translate(-center.x, -center.y, -center.z);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  const material = new THREE.MeshStandardMaterial({
    color: meshA.material.color.clone(),
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
