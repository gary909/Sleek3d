import * as THREE from 'three';

// Imported models are normalised to the app's simple look: one standard material
// per mesh (with the file's colour when it has one), shadows on, and a placeholder
// `uv` so the geometry can also take part in booleans.
const IMPORT_COLOR = 0x9aa6b8;

function ensureGeometry(geometry) {
  if (!geometry?.attributes?.position) return;
  if (!geometry.attributes.normal) geometry.computeVertexNormals();
  if (!geometry.attributes.uv) {
    const uv = new Float32Array(geometry.attributes.position.count * 2);
    geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  }
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
}

function normalizeMesh(mesh) {
  const source = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  const color = source?.color?.getHex ? source.color.getHex() : IMPORT_COLOR;
  mesh.material = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.55,
    metalness: 0.05,
  });
  mesh.userData = {
    ...mesh.userData,
    solid: true,
    transparent: false,
    _prevColor: color,
  };
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  ensureGeometry(mesh.geometry);
}

async function loadRoot(file) {
  const extension = file.name.split('.').pop()?.toLowerCase();

  if (extension === 'stl') {
    const { STLLoader } = await import('three/addons/loaders/STLLoader.js');
    const geometry = new STLLoader().parse(await file.arrayBuffer());
    return new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: IMPORT_COLOR }));
  }
  if (extension === 'obj') {
    const { OBJLoader } = await import('three/addons/loaders/OBJLoader.js');
    return new OBJLoader().parse(await file.text());
  }
  if (extension === 'glb' || extension === 'gltf') {
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
    const data = extension === 'glb' ? await file.arrayBuffer() : await file.text();
    const gltf = await new GLTFLoader().parseAsync(data, '');
    return gltf.scene;
  }
  throw new Error('Unsupported file type — use .stl, .obj, .glb or .gltf.');
}

export async function loadImportedFile(file) {
  const root = await loadRoot(file);

  // Drop lights/cameras/lines/points an imported scene may carry; the app only
  // models meshes and the studio lighting should stay untouched.
  const extras = [];
  root.traverse((object) => {
    if (object.isLight || object.isCamera || object.isLine || object.isPoints) extras.push(object);
  });
  extras.forEach((object) => object.parent?.remove(object));

  let meshCount = 0;
  root.traverse((object) => {
    if (!object.isMesh) return;
    meshCount += 1;
    normalizeMesh(object);
  });
  if (meshCount === 0) throw new Error('The file contains no mesh geometry.');

  // One selectable root whose pivot is the model's base centre: centre it on X/Z
  // and rest it on the work plane by offsetting the imported root (not the
  // wrapper), so the transform gizmo sits on the model rather than at the origin.
  const wrapper = new THREE.Group();
  wrapper.name = file.name;
  wrapper.add(root);
  wrapper.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(wrapper);
  if (box.isEmpty()) throw new Error('The file contains no geometry.');
  const center = box.getCenter(new THREE.Vector3());

  root.position.x -= center.x;
  root.position.y -= box.min.y;
  root.position.z -= center.z;
  wrapper.updateMatrixWorld(true);

  return wrapper;
}
