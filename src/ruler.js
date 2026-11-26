import * as THREE from "three";
import { GRID_STEPS, gridFamily, backgroundIsDark } from "./grid.js";

// Tinkercad-style measuring ruler on the work plane: two tick strips running right
// along the front edge (+X) and back along the left edge (-Z) from a draggable
// corner. The round x plate at the corner removes it, the four-way plate on the
// interior diagonal moves it.

const PLANE_Y = 0.05; // sits just clear of the grid plane at y = 0.02
const TAPE_WIDTH = 7; // strip thickness in world units (mm)
const TAPE_PX = 2048; // width of a tape's canvas texture
const MOVE_PX = 26; // move plate size on screen (it sits on the interior diagonal)
const CLOSE_PX = 18; // close plate size on screen (it sits on the corner)
const PLATE_GAP_PX = 64; // distance from the corner to the move plate; the plane is
// oblique on screen, so the gap needs to be generous to read clearly
const MOVE_HOVER = "#4a90d9"; // same accent the rotation handles use
const CLOSE_HOVER = "#e05555"; // red, so delete never reads as move

function worldPerPixel(camera, distance, viewportHeight) {
  if (camera.isOrthographicCamera) return ((camera.top - camera.bottom) / camera.zoom) / viewportHeight;
  const fov = THREE.MathUtils.degToRad(camera.fov);
  return (2 * distance * Math.tan(fov / 2)) / viewportHeight;
}

// Ink that stays legible over any work-plane colour: a translucent fill plus an
// outline, so the ruler reads on dark and light themes.
function themeFor(background) {
  return backgroundIsDark(background)
    ? { key: "dark", ink: "#d8dfe9", fill: "rgba(255,255,255,0.10)", outline: "rgba(255,255,255,0.55)", plate: "rgba(26,30,36,0.94)" }
    : { key: "light", ink: "#3c434c", fill: "rgba(0,0,0,0.06)", outline: "rgba(0,0,0,0.38)", plate: "rgba(255,255,255,0.96)" };
}

function makeCanvas(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  return { canvas, ctx: canvas.getContext("2d"), texture };
}

// A tape is four vertices in the work plane: u runs along the measuring axis,
// v across the strip. `offset` shifts the strip beside the axis so the two arms
// form an L instead of crossing each other at the corner. Normal is chosen so the
// winding faces up (v x u = +Y).
function createTape(direction, normal, offset) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(12), 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 1, 1, 1, 0]), 2));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  const { canvas, ctx, texture } = makeCanvas(TAPE_PX, 96);
  const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  material.polygonOffset = true;
  material.polygonOffsetFactor = -2;
  material.polygonOffsetUnits = -2;
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 4;
  mesh.frustumCulled = false;
  return { mesh, geometry, canvas, ctx, texture, direction, normal, offset, key: "" };
}

// Bake tick marks into the tape's texture. The arms carry no numbers: they are a
// pure scale, and `side` picks which long edge the ticks hang from.
function bakeTape(tape, length, majorStep, minorStep, theme, side, skipFrom) {
  if (length <= 0.5) return;
  const height = Math.max(48, Math.min(220, Math.round((tape.canvas.width * TAPE_WIDTH) / length)));
  if (tape.canvas.height !== height) {
    tape.canvas.height = height;
    tape.key = "";
  }
  const key = [Math.round(length * 2) / 2, majorStep, minorStep, theme.key, side, skipFrom].join("|");
  if (tape.key === key) return;
  tape.key = key;

  const { ctx, canvas } = tape;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = theme.fill;
  ctx.fillRect(0, 0, w, h);

  const line = Math.max(2, h * 0.035);
  ctx.strokeStyle = theme.outline;
  ctx.lineWidth = line;
  ctx.strokeRect(line / 2, line / 2, w - line, h - line);

  const pxPerMm = w / length;
  const edge = side === "top" ? line : h - line;
  const minorEnd = side === "top" ? h * 0.34 : h * 0.66;
  const majorEnd = side === "top" ? h * 0.58 : h * 0.42;

  // Ticks only begin past the corner square, where the two arms meet, so the marks
  // never run into the other arm.
  ctx.strokeStyle = theme.ink;
  ctx.lineWidth = Math.max(1, h * 0.022);
  ctx.beginPath();
  for (let mm = 0; mm <= length + 1e-6; mm += minorStep) {
    if (mm < skipFrom - 1e-6) continue;
    const x = mm * pxPerMm;
    ctx.moveTo(x, edge);
    ctx.lineTo(x, minorEnd);
  }
  ctx.stroke();

  ctx.lineWidth = Math.max(2, h * 0.035);
  ctx.beginPath();
  for (let i = 0; i * majorStep <= length + 1e-6; i += 1) {
    const mm = i * majorStep;
    if (mm < skipFrom - 1e-6) continue;
    const x = mm * pxPerMm;
    ctx.moveTo(x, edge);
    ctx.lineTo(x, majorEnd);
  }
  ctx.stroke();
  tape.texture.needsUpdate = true;
}

export function createRuler() {
  const group = new THREE.Group();
  group.name = "work-ruler";
  group.visible = false;

  // L-shaped ruler: the +X arm runs right along the front edge, the -Z arm runs
  // back along the left edge. Each strip is pushed inside the work area so the two
  // only meet in the corner square, and each normal keeps the labels unmirrored.
  const xTape = createTape(
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(0, 0, -1),
    new THREE.Vector3(0, 0, -TAPE_WIDTH / 2)
  );
  const zTape = createTape(
    new THREE.Vector3(0, 0, -1),
    new THREE.Vector3(-1, 0, 0),
    new THREE.Vector3(TAPE_WIDTH / 2, 0, 0)
  );
  group.add(xTape.mesh);
  group.add(zTape.mesh);

  // The close plate sits on the corner where the arms meet; the move plate sits on
  // the diagonal just inside the L, so the two never overlap.
  const movePlate = createPlate("corner");
  const closePlate = createPlate("close");
  group.add(movePlate.mesh);
  group.add(closePlate.mesh);

  function createGrab() {
    // Invisible, camera-facing target: sprites are the easiest thing to pick.
    const grab = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, opacity: 0, depthTest: false, depthWrite: false }));
    grab.renderOrder = 9;
    return grab;
  }
  const moveGrab = createGrab();
  const closeGrab = createGrab();
  group.add(moveGrab);
  group.add(closeGrab);

  const state = {
    origin: new THREE.Vector3(0, PLANE_Y, 0),
    width: 200,
    length: 200,
    settings: null,
    theme: themeFor("#000000"),
    hovered: null,
  };

  // The ruler is a fixed size (half the work area on each axis, like Tinkercad), so
  // dragging it around never changes the measurements. The corner is clamped so
  // the whole L stays on the plane.
  function applyLayout() {
    const halfW = state.width / 2;
    const halfL = state.length / 2;
    const lengthX = Math.max(1, state.width / 2);
    const lengthZ = Math.max(1, state.length / 2);
    state.origin.x = Math.max(-halfW, Math.min(halfW - lengthX, state.origin.x));
    state.origin.z = Math.max(-halfL + lengthZ, Math.min(halfL, state.origin.z));
    layoutTape(xTape, state.origin.x, state.origin.z, lengthX);
    layoutTape(zTape, state.origin.x, state.origin.z, lengthZ);
    if (state.settings) {
      const steps = GRID_STEPS[gridFamily(state.settings)];
      // The X arm hangs its ticks off the inner edge; the Z arm keeps them on its
      // own inner edge. Neither starts inside the corner square.
      bakeTape(xTape, lengthX, steps.mid, steps.thin, state.theme, "top", TAPE_WIDTH);
      bakeTape(zTape, lengthZ, steps.mid, steps.thin, state.theme, "bottom", TAPE_WIDTH);
    }
    bakePlate(movePlate, state.theme, state.hovered === "ruler-move" ? MOVE_HOVER : null);
    bakePlate(closePlate, state.theme, state.hovered === "ruler-close" ? CLOSE_HOVER : null);
  }

  applyLayout();

  return {
    group,
    get visible() {
      return group.visible === true;
    },
    get origin() {
      return { x: state.origin.x, z: state.origin.z };
    },
    setVisible(value) {
      group.visible = value === true;
      if (group.visible) applyLayout();
    },
    // Background colour, units and work-area size all feed the ruler.
    setSettings(settings) {
      if (!settings) return;
      state.settings = settings;
      state.width = Math.max(1, settings.gridWidth || 200);
      state.length = Math.max(1, settings.gridLength || 200);
      const theme = themeFor(settings.background);
      if (theme.key !== state.theme.key) {
        state.theme = theme;
        xTape.key = "";
        zTape.key = "";
      }
      applyLayout();
    },
    setOrigin(x, z) {
      state.origin.x = x;
      state.origin.z = z;
      applyLayout();
    },
    // Put the corner back at the front-left vertex of the work area, so the X arm
    // runs right along the front edge and the Z arm runs back along the left one.
    resetOrigin() {
      state.origin.x = -state.width / 2;
      state.origin.z = state.length / 2;
      applyLayout();
    },
    // Highlight whichever plate the pointer is over (blue to move, red to delete).
    setHover(id) {
      const next = id === "ruler-move" || id === "ruler-close" ? id : null;
      if (state.hovered === next) return;
      state.hovered = next;
      bakePlate(movePlate, state.theme, next === "ruler-move" ? MOVE_HOVER : null);
      bakePlate(closePlate, state.theme, next === "ruler-close" ? CLOSE_HOVER : null);
    },
    // Keep both plates a constant size on screen.
    update(camera, viewportHeight) {
      if (group.visible === false || !(viewportHeight > 0)) return;
      const wpp = worldPerPixel(camera, camera.position.distanceTo(state.origin), viewportHeight);
      const y = PLANE_Y + 0.02;
      closePlate.mesh.position.set(state.origin.x, y, state.origin.z);
      closePlate.mesh.scale.setScalar(CLOSE_PX * wpp);
      const gap = PLATE_GAP_PX * wpp * Math.SQRT1_2;
      // Arms occupy +X and -Z from the corner, so the move plate sits on the
      // interior diagonal: on the work plane and always on screen.
      movePlate.mesh.position.set(state.origin.x + gap, y, state.origin.z - gap);
      movePlate.mesh.scale.setScalar(MOVE_PX * wpp);
      moveGrab.position.copy(movePlate.mesh.position);
      moveGrab.scale.set(MOVE_PX * 1.4 * wpp, MOVE_PX * 1.4 * wpp, 1);
      closeGrab.position.copy(closePlate.mesh.position);
      closeGrab.scale.set(CLOSE_PX * 2.1 * wpp, CLOSE_PX * 2.1 * wpp, 1);
    },
    pickHandle(raycaster) {
      if (group.visible === false) return null;
      const hits = raycaster.intersectObjects([closeGrab, moveGrab], false);
      if (hits.length === 0) return null;
      if (hits.some((hit) => hit.object === closeGrab)) return "ruler-close";
      return "ruler-move";
    },
  };
}

function roundedPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// Flat plates that lie on the plane: the move handle and the close button. They
// ignore depth so they stay visible on top of shapes and can always be grabbed.
function createPlate(kind) {
  const { canvas, ctx, texture } = makeCanvas(128, 128);
  const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.renderOrder = 8;
  return { kind, mesh, canvas, ctx, texture, key: "" };
}

// `hover` is the accent colour to fill with while the pointer is over the plate.
function bakePlate(plate, theme, hover) {
  const key = theme.key + "|" + (hover || "");
  if (plate.key === key) return;
  plate.key = key;
  const { ctx, canvas } = plate;
  const s = canvas.width;
  const c = s / 2;
  const fill = hover || theme.plate;
  const ink = hover ? "#ffffff" : theme.ink;
  ctx.clearRect(0, 0, s, s);
  ctx.fillStyle = fill;
  ctx.strokeStyle = ink;
  ctx.lineWidth = s * 0.06;

  if (plate.kind === "corner") {
    roundedPath(ctx, s * 0.11, s * 0.11, s * 0.78, s * 0.78, s * 0.16);
    ctx.fill();
    ctx.stroke();
    // Four-way move arrows.
    const arm = s * 0.21;
    const head = s * 0.09;
    ctx.lineWidth = s * 0.07;
    ctx.beginPath();
    ctx.moveTo(c - arm, c);
    ctx.lineTo(c + arm, c);
    ctx.moveTo(c, c - arm);
    ctx.lineTo(c, c + arm);
    ctx.stroke();
    ctx.fillStyle = ink;
    [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dx, dz]) => {
      const tipX = c + dx * arm;
      const tipZ = c + dz * arm;
      const base = arm - head;
      ctx.beginPath();
      ctx.moveTo(tipX, tipZ);
      ctx.lineTo(c + dx * base - dz * head * 0.75, c + dz * base + dx * head * 0.75);
      ctx.lineTo(c + dx * base + dz * head * 0.75, c + dz * base - dx * head * 0.75);
      ctx.closePath();
      ctx.fill();
    });
  } else {
    ctx.beginPath();
    ctx.arc(c, c, s * 0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.lineWidth = s * 0.08;
    ctx.beginPath();
    ctx.moveTo(c - s * 0.16, c - s * 0.16);
    ctx.lineTo(c + s * 0.16, c + s * 0.16);
    ctx.moveTo(c + s * 0.16, c - s * 0.16);
    ctx.lineTo(c - s * 0.16, c + s * 0.16);
    ctx.stroke();
  }
  plate.texture.needsUpdate = true;
}

function layoutTape(tape, originX, originZ, length) {
  const visible = length > 0.5;
  tape.mesh.visible = visible;
  if (visible === false) return;
  const hw = TAPE_WIDTH / 2;
  const d = tape.direction;
  const n = tape.normal;
  // The strip sits beside its axis, so the arm starts on the corner line but is
  // nudged sideways by half its width.
  const ox = originX + tape.offset.x;
  const oz = originZ + tape.offset.z;
  const corners = [
    [ox - n.x * hw, oz - n.z * hw],
    [ox + n.x * hw, oz + n.z * hw],
    [ox + d.x * length + n.x * hw, oz + d.z * length + n.z * hw],
    [ox + d.x * length - n.x * hw, oz + d.z * length - n.z * hw],
  ];
  const positions = tape.geometry.attributes.position;
  corners.forEach(([x, z], i) => positions.setXYZ(i, x, PLANE_Y, z));
  positions.needsUpdate = true;
  tape.geometry.computeBoundingSphere();
}
