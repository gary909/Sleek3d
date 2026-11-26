import * as THREE from "three";
import { FontLoader } from "three/addons/loaders/FontLoader.js";
import { TextGeometry } from "three/addons/geometries/TextGeometry.js";

// Open-source typefaces bundled in public/fonts (see FONTS.md there). Each one is
// fetched the first time it is used, then cached for the rest of the session.
export const TEXT_FONTS = [
  { id: "helvetiker_regular", label: "Helvetiker", weight: "Regular" },
  { id: "helvetiker_bold", label: "Helvetiker", weight: "Bold" },
  { id: "optimer_regular", label: "Optimer", weight: "Regular" },
  { id: "optimer_bold", label: "Optimer", weight: "Bold" },
  { id: "gentilis_regular", label: "Gentilis", weight: "Regular" },
  { id: "gentilis_bold", label: "Gentilis", weight: "Bold" },
  { id: "droid_sans_regular", label: "Droid Sans", weight: "Regular" },
  { id: "droid_sans_bold", label: "Droid Sans", weight: "Bold" },
  { id: "droid_serif_regular", label: "Droid Serif", weight: "Regular" },
  { id: "droid_serif_bold", label: "Droid Serif", weight: "Bold" },
];

export const TEXT_FONT_OPTIONS = TEXT_FONTS.map((font) => ({
  value: font.id,
  label: `${font.label} ${font.weight}`,
}));

const TEXT_SIZE = 10; // world units — the size text has always been created at

export const DEFAULT_TEXT_PARAMS = {
  text: "Sleek3d",
  font: "helvetiker_regular",
  thickness: 2,
  bevel: 0,
  segments: 8,
};

// Rows shown in the inspector for a text shape (see renderDimensions in ui.js).
export const TEXT_PARAM_SPECS = [
  { key: "font", label: "Font", type: "select", options: TEXT_FONT_OPTIONS, def: DEFAULT_TEXT_PARAMS.font },
  { key: "thickness", label: "Thickness", min: 0.5, max: 20, step: 0.5, unit: true, def: DEFAULT_TEXT_PARAMS.thickness },
  { key: "bevel", label: "Bevel", min: 0, max: 2, step: 0.1, unit: true, def: 0 },
  { key: "segments", label: "Segments", min: 1, max: 24, step: 1, unit: false, def: DEFAULT_TEXT_PARAMS.segments },
];

const pending = new Map(); // id -> Promise<Font>
const ready = new Map(); // id -> Font

function resolveId(id) {
  return TEXT_FONTS.some((font) => font.id === id) ? id : DEFAULT_TEXT_PARAMS.font;
}

export function hasFont(id) {
  return ready.has(resolveId(id));
}

export function loadFont(id = DEFAULT_TEXT_PARAMS.font) {
  const key = resolveId(id);
  if (ready.has(key)) return Promise.resolve(ready.get(key));
  if (!pending.has(key)) {
    const request = new FontLoader()
      .loadAsync(`/fonts/${key}.typeface.json`)
      .then((font) => {
        ready.set(key, font);
        return font;
      });
    pending.set(key, request);
  }
  return pending.get(key);
}

// Thickness/bevel/segments are stored in world units and mapped straight onto
// TextGeometry's extrusion options.
function geometryOptions(params) {
  const thickness = Math.max(0.1, Number(params.thickness ?? DEFAULT_TEXT_PARAMS.thickness));
  const bevel = Math.max(0, Math.min(2, Number(params.bevel ?? 0)));
  const segments = Math.max(1, Math.round(Number(params.segments ?? DEFAULT_TEXT_PARAMS.segments)));
  return {
    size: TEXT_SIZE,
    depth: thickness,
    curveSegments: segments,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel * 0.5,
    bevelSize: bevel * 0.5,
    bevelSegments: 2,
  };
}

// Centre horizontally and sit the bottom on the work plane (y = 0).
function centreGeometry(geometry) {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  geometry.translate(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

export function buildTextGeometry(font, params) {
  const text = String(params.text ?? DEFAULT_TEXT_PARAMS.text) || " ";
  return centreGeometry(new TextGeometry(text, { font, ...geometryOptions(params) }));
}

export async function createTextMesh(text, params = {}) {
  const merged = { ...DEFAULT_TEXT_PARAMS, ...params, text };
  const font = await loadFont(merged.font);
  const geometry = buildTextGeometry(font, merged);
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0.05 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData = { solid: true, shapeType: "text", params: merged };
  return mesh;
}

// Rebuild in place when the font is already cached (instant, so undo/redo feels
// immediate). Returns false when the font still needs downloading.
export function rebuildTextMeshSync(mesh, params) {
  const merged = { ...(mesh.userData.params || {}), ...params };
  const font = ready.get(resolveId(merged.font));
  if (!font) return false;
  const geometry = buildTextGeometry(font, merged);
  mesh.geometry.dispose();
  mesh.geometry = geometry;
  mesh.userData.params = merged;
  return true;
}

// Async rebuild with a per-mesh token, so fast slider drags can't apply out of order.
const tokens = new WeakMap();

export async function rebuildTextMesh(mesh, params) {
  const token = (tokens.get(mesh) || 0) + 1;
  tokens.set(mesh, token);
  const merged = { ...(mesh.userData.params || {}), ...params };
  const font = await loadFont(merged.font);
  if (tokens.get(mesh) !== token) return false;
  const geometry = buildTextGeometry(font, merged);
  mesh.geometry.dispose();
  mesh.geometry = geometry;
  mesh.userData.params = merged;
  return true;
}
