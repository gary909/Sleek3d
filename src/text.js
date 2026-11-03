import * as THREE from 'three';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';

let fontPromise = null;

export function loadFont() {
  if (!fontPromise) {
    fontPromise = new FontLoader().loadAsync('/fonts/helvetiker_regular.typeface.json');
  }
  return fontPromise;
}

export async function createTextMesh(text, { size = 1, depth = 0.4, color = 0xffffff } = {}) {
  const font = await loadFont();
  const geometry = new TextGeometry(text, {
    font,
    size,
    depth,
    curveSegments: 12,
    bevelEnabled: false,
  });
  geometry.computeBoundingBox();

  // Center horizontally (x/z) and sit the bottom on the ground plane (y = 0).
  const box = geometry.boundingBox;
  geometry.translate(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);

  const material = new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.05 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData = { solid: true, shapeType: 'text', params: null };
  return mesh;
}
