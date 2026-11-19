import * as THREE from "three";

// Reference images are flat, unlit quads used to trace over a picture. They are
// ordinary meshes (so selection, undo and the gizmo work) but carry a
// referenceImage flag so booleans, grouping and export skip them.
export const DEFAULT_REFERENCE_SIZE = 10;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_IMAGE_EDGE = 1024;

const textureCache = new Map();
let placeholderTexture = null;

function createPlaceholderTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#eef2f7";
  ctx.fillRect(0, 0, 512, 512);
  ctx.fillStyle = "#dbe3ee";
  for (let y = 0; y < 512; y = y + 64) {
    for (let x = 0; x < 512; x = x + 64) {
      if ((x + y) % 128 === 0) ctx.fillRect(x, y, 64, 64);
    }
  }
  ctx.strokeStyle = "#8fa2bb";
  ctx.setLineDash([16, 12]);
  ctx.lineWidth = 6;
  ctx.strokeRect(18, 18, 476, 476);
  ctx.setLineDash([]);
  ctx.fillStyle = "#5a6b82";
  ctx.font = "600 40px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("Add an image", 256, 256);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

export function getPlaceholderTexture() {
  if (!placeholderTexture) placeholderTexture = createPlaceholderTexture();
  return placeholderTexture;
}

export function getCachedTexture(dataUrl) {
  if (!dataUrl) return null;
  let entry = textureCache.get(dataUrl);
  if (!entry) {
    const image = new Image();
    image.decoding = "async";
    entry = new THREE.Texture(image);
    entry.colorSpace = THREE.SRGBColorSpace;
    entry.anisotropy = 4;
    image.onload = () => { entry.needsUpdate = true; };
    image.src = dataUrl;
    textureCache.set(dataUrl, entry);
  }
  return entry;
}

// Orientation: "top" lies flat on the grid, "front"/"right" stand upright with
// their bottom edge resting on the work plane.
function applyOrientation(mesh, params) {
  const h = params.h ?? DEFAULT_REFERENCE_SIZE;
  const facing = params.facing ?? "top";
  if (facing === "front") {
    mesh.rotation.set(0, 0, 0);
    mesh.position.y = h / 2;
    return;
  }
  if (facing === "right") {
    mesh.rotation.set(0, Math.PI / 2, 0);
    mesh.position.y = h / 2;
    return;
  }
  mesh.rotation.set(-Math.PI / 2, 0, 0);
  mesh.position.y = 0.02;
}

export function applyReferenceMaterial(mesh, params) {
  const material = mesh.material;
  material.map = getCachedTexture(params.image) || getPlaceholderTexture();
  material.color.set(0xffffff);
  material.transparent = true;
  material.opacity = params.opacity ?? 0.85;
  material.depthWrite = false;
  material.side = THREE.DoubleSide;
  const onTop = params.onTop === true;
  material.depthTest = !onTop;
  material.needsUpdate = true;
  mesh.renderOrder = onTop ? 999 : 0;
}

export function createReferenceImage(params = {}) {
  const w = Math.max(0.01, params.w ?? DEFAULT_REFERENCE_SIZE);
  const h = Math.max(0.01, params.h ?? DEFAULT_REFERENCE_SIZE);
  const full = {
    w,
    h,
    image: params.image ?? null,
    ratio: params.ratio ?? 1,
    aspect: params.aspect !== false,
    opacity: params.opacity ?? 0.85,
    onTop: params.onTop === true,
    facing: params.facing ?? "top",
  };
  const material = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: full.opacity, side: THREE.DoubleSide, depthWrite: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), material);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.userData = { solid: true, shapeType: "reference", referenceImage: true, params: full };
  applyReferenceMaterial(mesh, full);
  applyOrientation(mesh, full);
  return mesh;
}

// Decode, downscale (keeps autosave inside the localStorage quota) and re-encode
// the chosen picture so its data URL can live in the object params.
export function processImageFile(file) {
  return new Promise((resolve, reject) => {
    if (!file) {
      reject(new Error("No image chosen."));
      return;
    }
    if (!file.type || file.type.indexOf("image/") !== 0) {
      reject(new Error("Please choose an image file."));
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      reject(new Error("Image must be 5 MB or smaller."));
      return;
    }
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      try {
        const longest = Math.max(image.naturalWidth, image.naturalHeight) || 1;
        const scale = Math.min(1, MAX_IMAGE_EDGE / longest);
        const width = Math.max(1, Math.round(image.naturalWidth * scale));
        const height = Math.max(1, Math.round(image.naturalHeight * scale));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(image, 0, 0, width, height);
        const type = file.type === "image/png" ? "image/png" : "image/jpeg";
        resolve({
          dataUrl: canvas.toDataURL(type, 0.9),
          ratio: image.naturalWidth / Math.max(1, image.naturalHeight),
          name: file.name,
        });
      } catch (error) {
        reject(error);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That image could not be read."));
    };
    image.src = url;
  });
}
