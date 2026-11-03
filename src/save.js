import * as THREE from 'three';

const STORAGE_KEY = 'sleek3d:project';

// Serialize geometry ourselves (position/normal/index as plain arrays) rather than
// relying on BufferGeometry.toJSON()/BufferGeometryLoader, whose formats drift
// between three.js releases.
function geometryToJSON(geometry) {
  return {
    position: Array.from(geometry.attributes.position.array),
    normal: geometry.attributes.normal ? Array.from(geometry.attributes.normal.array) : null,
    index: geometry.index ? Array.from(geometry.index.array) : null,
  };
}

function geometryFromJSON(data) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.position, 3));
  if (data.normal) {
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(data.normal, 3));
  }
  if (data.index) {
    geometry.setIndex(new THREE.Uint32BufferAttribute(data.index, 1));
  }
  return geometry;
}

function objectToJSON(object) {
  object.updateMatrix();
  if (object.isMesh) {
    return {
      kind: 'mesh',
      matrix: object.matrix.toArray(),
      // Store the "resting" color: a hole's material is tinted red, but its real
      // color lives in `_prevColor`.
      color: object.userData._prevColor ?? object.material.color.getHex(),
      solid: object.userData.solid !== false,
      shapeType: object.userData.shapeType ?? 'combined',
      params: object.userData.params ?? null,
      geometry: geometryToJSON(object.geometry),
    };
  }
  return {
    kind: 'group',
    matrix: object.matrix.toArray(),
    children: object.children.map(objectToJSON),
  };
}

export function serializeScene(shapes) {
  return JSON.stringify({ version: 1, objects: shapes.map(objectToJSON) });
}

function objectFromJSON(json) {
  if (json.kind === 'mesh') {
    const geometry = geometryFromJSON(json.geometry);
    const material = new THREE.MeshStandardMaterial({
      color: json.color,
      roughness: 0.55,
      metalness: 0.05,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.matrix.fromArray(json.matrix);
    mesh.matrix.decompose(mesh.position, mesh.quaternion, mesh.scale);
    mesh.rotation.setFromQuaternion(mesh.quaternion);
    mesh.userData = {
      solid: json.solid,
      shapeType: json.shapeType ?? 'combined',
      params: json.params ?? null,
    };
    return mesh;
  }
  const group = new THREE.Group();
  group.matrix.fromArray(json.matrix);
  group.matrix.decompose(group.position, group.quaternion, group.scale);
  group.rotation.setFromQuaternion(group.quaternion);
  json.children.forEach((child) => group.add(objectFromJSON(child)));
  return group;
}

export function deserializeScene(jsonString) {
  const data = JSON.parse(jsonString);
  return (data.objects || []).map(objectFromJSON);
}

export function loadProject() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw == null) return null;
    return deserializeScene(raw);
  } catch {
    return null;
  }
}

export function saveProject(shapes) {
  try {
    localStorage.setItem(STORAGE_KEY, serializeScene(shapes));
  } catch {
    // storage unavailable — ignore
  }
}

