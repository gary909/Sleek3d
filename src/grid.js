import * as THREE from "three";

// One world unit is one millimetre. The grid is a single shaded plane so line
// weights stay constant in screen pixels at every zoom, and each tier fades out
// once its spacing drops below a few pixels (no moire on large work areas).
const IMPERIAL_UNITS = ["in", "ft", "yd"];
export const IMPERIAL_GRID_SIZE = 25.4 * 4; // 4 in

export const GRID_STEPS = {
  metric: { thin: 1, mid: 10, coarse: 100 }, // 1 mm / 1 cm / 10 cm
  imperial: { thin: 25.4 / 8, mid: 25.4, coarse: 25.4 * 12 }, // 1/8 in / 1 in / 12 in
};

export function gridFamily(settings) {
  return IMPERIAL_UNITS.indexOf(settings.units) >= 0 ? "imperial" : "metric";
}

const DARK_LINE = 0xdfe7f2;
const LIGHT_LINE = 0x4a5563;

function mixHex(a, b, t) {
  const ar = (a >> 16) & 255;
  const ag = (a >> 8) & 255;
  const ab = a & 255;
  const br = (b >> 16) & 255;
  const bg = (b >> 8) & 255;
  const bb = b & 255;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}

function toRgb(hex) {
  return new THREE.Vector3(((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255);
}

// Line colours follow the work-plane background so the grid stays legible on
// both the black default and a light theme.
function palette(background) {
  const hex = parseInt(String(background || "#000000").replace("#", ""), 16) || 0;
  const r = ((hex >> 16) & 255) / 255;
  const g = ((hex >> 8) & 255) / 255;
  const b = (hex & 255) / 255;
  const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const dark = luma <= 0.35;
  const target = dark ? DARK_LINE : LIGHT_LINE;
  return {
    thin: toRgb(mixHex(hex, target, dark ? 0.38 : 0.3)),
    mid: toRgb(mixHex(hex, target, dark ? 0.75 : 0.6)),
    coarse: toRgb(mixHex(hex, target, dark ? 0.95 : 0.85)),
    border: toRgb(mixHex(hex, target, dark ? 0.6 : 0.55)),
  };
}

const VERTEX_SHADER = [
  "out vec2 vUv;",
  "void main() {",
  "  vUv = uv;",
  "  vec4 mv = modelViewMatrix * vec4(position, 1.0);",
  "  gl_Position = projectionMatrix * mv;",
  "}",
].join("\n");

const FRAGMENT_SHADER = [
  "precision highp float;",
  "in vec2 vUv;",
  "out vec4 fragColor;",
  "uniform vec2 uSize;",
  "uniform float uThinStep;",
  "uniform float uMidStep;",
  "uniform float uCoarseStep;",
  "uniform float uThinWidth;",
  "uniform float uMidWidth;",
  "uniform float uCoarseWidth;",
  "uniform float uBorderWidth;",
  "uniform float uThinAlpha;",
  "uniform float uMidAlpha;",
  "uniform vec3 uThinColor;",
  "uniform vec3 uMidColor;",
  "uniform vec3 uCoarseColor;",
  "uniform vec3 uBorderColor;",
  "uniform float uPxPerUnit;",
  "float tier(vec2 mm, vec2 px, float step, float width) {",
  "  vec2 d = abs(fract(mm / step + 0.5) - 0.5) * step;",
  "  float nearest = min(d.x / px.x, d.y / px.y);",
  "  return 1.0 - smoothstep(width * 0.5 - 0.5, width * 0.5 + 0.5, nearest);",
  "}",
  "void main() {",
  "  vec2 mm = vUv * uSize;",
  "  vec2 px = max(fwidth(mm), vec2(0.0001));",
  "  float unitPerPx = max(px.x, px.y);",
  "  float pxSpacing = uThinStep / unitPerPx;",
  "  float midSpacing = uMidStep / unitPerPx;",
  "  float thinFade = smoothstep(2.2, 5.0, uThinStep * uPxPerUnit) * smoothstep(1.0, 2.0, pxSpacing);",
  "  float midFade = smoothstep(3.0, 8.0, uMidStep * uPxPerUnit) * smoothstep(1.5, 3.0, midSpacing);",
  "  float cThin = tier(mm, px, uThinStep, uThinWidth) * thinFade;",
  "  float cMid = tier(mm, px, uMidStep, uMidWidth) * midFade;",
  "  float cCoarse = tier(mm, px, uCoarseStep, uCoarseWidth);",
  "  vec2 edgePx = min(mm, uSize - mm) / px;",
  "  float cBorder = 1.0 - smoothstep(uBorderWidth * 0.5 - 0.5, uBorderWidth * 0.5 + 0.5, min(edgePx.x, edgePx.y));",
  "  float alpha = max(max(cThin * uThinAlpha, cMid * uMidAlpha), max(cCoarse, cBorder));",
  "  vec3 color = uThinColor;",
  "  color = mix(color, uMidColor, cMid);",
  "  color = mix(color, uCoarseColor, cCoarse);",
  "  color = mix(color, uBorderColor, cBorder);",
  "  fragColor = vec4(color, max(alpha, 0.0));",
  "}",
].join("\n");

function createMaterial({ width, length, steps, colors }) {
  return new THREE.ShaderMaterial({
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    glslVersion: THREE.GLSL3,
    alphaToCoverage: true,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
    uniforms: {
      uSize: { value: new THREE.Vector2(width, length) },
      uThinStep: { value: steps.thin },
      uMidStep: { value: steps.mid },
      uCoarseStep: { value: steps.coarse },
      uThinWidth: { value: 1.1 },
      uMidWidth: { value: 2.0 },
      uCoarseWidth: { value: 3.0 },
      uBorderWidth: { value: 3.0 },
      uThinAlpha: { value: 0.6 },
      uMidAlpha: { value: 1.0 },
      uThinColor: { value: colors.thin },
      uMidColor: { value: colors.mid },
      uCoarseColor: { value: colors.coarse },
      uBorderColor: { value: colors.border },
      uPxPerUnit: { value: 1.0 },
    },
  });
}

export function buildGrid({ width, length, thinStep, midStep, coarseStep, background }) {
  const group = new THREE.Group();
  group.name = "work-grid";
  const material = createMaterial({ width, length, steps: { thin: thinStep, mid: midStep, coarse: coarseStep }, colors: palette(background) });
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(width, length), material);
  plane.rotation.x = -Math.PI / 2;
  plane.position.y = 0.02;
  plane.renderOrder = 1;
  group.add(plane);
  return group;
}

// Rebuild the grid in place so unit or work-area changes keep exact spacings.
export function updateGrid(group, settings) {
  if (!group) return;
  for (const child of group.children.slice()) {
    group.remove(child);
    if (child.geometry) child.geometry.dispose();
    if (child.material) child.material.dispose();
  }
  const steps = GRID_STEPS[gridFamily(settings)];
  const built = buildGrid({
    width: Math.max(1, settings.gridWidth || 200),
    length: Math.max(1, settings.gridLength || 200),
    thinStep: steps.thin,
    midStep: steps.mid,
    coarseStep: steps.coarse,
    background: settings.background,
  });
  while (built.children.length > 0) group.add(built.children[0]);
}

// Keep the LOD factor smooth: derive pixels-per-millimetre from the camera
// each frame so the tiers cross-fade instead of popping while orbiting.
export function updateGridLod(group, camera, viewportHeightPx) {
  const mesh = group && group.children[0];
  if (!mesh || !mesh.material.uniforms || !viewportHeightPx) return;
  let pxPerUnit;
  if (camera.isOrthographicCamera) {
    pxPerUnit = viewportHeightPx / ((camera.top - camera.bottom) / camera.zoom);
  } else {
    const dist = Math.max(1, camera.position.length());
    pxPerUnit = viewportHeightPx / (2 * dist * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  }
  mesh.material.uniforms.uPxPerUnit.value = pxPerUnit;
}
