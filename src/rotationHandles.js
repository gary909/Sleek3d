import * as THREE from "three";

const ARC_SPAN = Math.PI * 2; // full ring while a rotation drag is active
const ARC_SPAN_COLLAPSED = Math.PI / 4; // narrow hook until pressed
const ARC_RADIUS_PX = 48; // gap between a mid-edge handle and its arc
const ARC_THICK_PX = 1.2;
const HEAD_PX = 7; // arrowhead length, screen pixels
const HEAD_RADIUS_PX = 2.8;
const HEAD_PX_COLLAPSED = 5; // compact head until the arrow is pressed

// Fixed, world-aligned frame for the tilt arrow: flat, arching towards -Z so it
// behaves like the yaw arrows and never rotates with the camera.
const TILT_BASIS = new THREE.Matrix4().makeBasis(
  new THREE.Vector3(0, 0, 1),
  new THREE.Vector3(0, 1, 0),
  new THREE.Vector3(-1, 0, 0)
);
const GRAB_PX = 30; // invisible grab target size around each arc
const MARK_STEP = Math.PI / 12; // 15 degrees between protractor marks
const MARK_COUNT = 25; // one mark per 15 degrees around a full ring
const MARK_PX = 7; // protractor mark length
const MARK_BREADTH_PX = 1.6;
const PITCH_GAP_PX = 40;
const PITCH_RADIUS_PX = 34; // the pitch arrow faces the camera above the box
const BASE_COLOR = 0xffffff;
const HOVER_COLOR = 0x4a90d9;
const ORIGIN_COLOR = 0xe05555; // red tick marking the original orientation
const UP = new THREE.Vector3(0, 1, 0);

// Where the four horizontal (yaw) arrows sit around the footprint.
const YAW_KEYS = [
  { key: "s", angle: -Math.PI / 2 },
];

function worldPerPixel(camera, distance, viewportHeight) {
  if (camera.isOrthographicCamera) {
    return ((camera.top - camera.bottom) / camera.zoom) / viewportHeight;
  }
  const fov = THREE.MathUtils.degToRad(camera.fov);
  return (2 * distance * Math.tan(fov / 2)) / viewportHeight;
}

function cameraRight(camera) {
  const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
  right.y = 0;
  if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
  return right.normalize();
}

// One curved arrow: a thin torus arc plus a cone head, both flat in local XY.
function makeArc() {
  const material = new THREE.MeshBasicMaterial({ color: BASE_COLOR, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false });
  const group = new THREE.Group();
  group.visible = false;
  const arc = new THREE.Mesh(new THREE.TorusGeometry(1, ARC_THICK_PX / ARC_RADIUS_PX, 5, 22, ARC_SPAN), material);
  arc.renderOrder = 993;
  group.add(arc);
  const head = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 8), material);
  head.renderOrder = 993;
  group.add(head);
  const tickMaterial = new THREE.MeshBasicMaterial({ color: BASE_COLOR, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
  const tick = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), tickMaterial);
  tick.renderOrder = 994;
  tick.visible = false;
  group.add(tick);
  const originMaterial = new THREE.MeshBasicMaterial({ color: ORIGIN_COLOR, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
  const originTick = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), originMaterial);
  originTick.renderOrder = 994;
  originTick.visible = false;
  group.add(originTick);
  // Invisible camera-facing grab target: sprites are always easy to pick.
  const grab = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, opacity: 0, depthTest: false, depthWrite: false }));
  grab.renderOrder = 993;
  group.add(grab);
  // Protractor marks every 15 degrees along the arc.
  const markMaterial = new THREE.MeshBasicMaterial({ color: BASE_COLOR, transparent: true, opacity: 0.5, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
  const marks = [];
  for (let i = 0; i < MARK_COUNT; i = i + 1) {
    const mark = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), markMaterial);
    mark.renderOrder = 993;
    group.add(mark);
    marks.push(mark);
  }
  return { group, arc, head, tick, originTick, grab, marks, material };
}

// Span the arc from spanStart to spanStart + ARC_SPAN and put the head on its tip.
function layoutArc(view, radiusWorld, spanStart, span, wpp, showMarks = true, headPx = HEAD_PX, flipHead = false) {
  view.arc.rotation.z = spanStart;
  view.arc.geometry.dispose();
  // Tube ratio is taken from the real radius so the arc stays ARC_THICK_PX thick.
  view.arc.geometry = new THREE.TorusGeometry(1, ARC_THICK_PX / (radiusWorld / wpp), 5, 26, span);
  view.arc.scale.setScalar(radiusWorld);
  const aMid = spanStart + span / 2;
  view.grab.position.set(Math.cos(aMid) * radiusWorld, Math.sin(aMid) * radiusWorld, 0);
  view.grab.scale.set(GRAB_PX * wpp, GRAB_PX * wpp, 1);
  view.marks.forEach((mark, i) => {
    const a = spanStart + i * MARK_STEP;
    const on = showMarks && a <= spanStart + span + 1e-6;
    mark.visible = on;
    if (!on) return;
    mark.position.set(Math.cos(a) * radiusWorld, Math.sin(a) * radiusWorld, 0);
    mark.rotation.z = a;
    mark.scale.set(MARK_PX * wpp, MARK_BREADTH_PX * wpp, 1);
  });
  const a = flipHead ? spanStart : spanStart + span;
  const cos = Math.cos(a);
  const sin = Math.sin(a) * (flipHead ? -1 : 1);
  const headLen = headPx * wpp;
  const headRad = headPx * (HEAD_RADIUS_PX / HEAD_PX) * wpp;
  view.head.position.set(cos * radiusWorld - sin * headLen * 0.5, sin * radiusWorld + cos * headLen * 0.5, 0);
  view.head.scale.set(headRad, headLen, headRad);
  view.head.quaternion.setFromUnitVectors(UP, new THREE.Vector3(-sin, cos, 0));
  view.head.visible = span < Math.PI * 1.95; // a closed ring needs no arrowhead
}

export function createRotationHandles() {
  const group = new THREE.Group();
  group.name = "rotation-handles";
  group.visible = false;
  const items = [];

  YAW_KEYS.forEach(({ key, angle }) => {
    const pivot = new THREE.Group();
    const flat = new THREE.Group();
    flat.rotation.x = -Math.PI / 2; // lay the arc down in the work plane
    const view = makeArc();
    view.group.userData.handle = "rotY";
    view.arc.userData.handle = "rotY";
    view.head.userData.handle = "rotY";
    view.grab.userData.handle = "rotY";
    flat.add(view.group);
    pivot.add(flat);
    group.add(pivot);
    items.push({ id: "rotY", key, angle, pivot, view, material: view.material });
  });

  const pitchPivot = new THREE.Group();
  const pitchView = makeArc();
  pitchView.group.userData.handle = "rotX";
  pitchView.arc.userData.handle = "rotX";
  pitchView.head.userData.handle = "rotX";
  pitchView.grab.userData.handle = "rotX";
  pitchPivot.add(pitchView.group);
  group.add(pitchPivot);
  items.push({ id: "rotX", pivot: pitchPivot, view: pitchView, material: pitchView.material });

  return { group, items };
}

export function updateRotationHandles(handles, { box, camera, viewportHeight, visible, turn = 0, expandedAxis = null, tilt = 0 }) {
  const show = visible === true && box && box.isEmpty() === false && viewportHeight > 0;
  handles.group.visible = show;
  if (show === false) return;

  const centre = box.getCenter(new THREE.Vector3());
  const width = box.max.x - box.min.x;
  const depth = box.max.z - box.min.z;
  const height = box.max.y - box.min.y;
  const y = box.min.y + 0.03;
  const wpp = worldPerPixel(camera, camera.position.distanceTo(centre), viewportHeight);

  handles.items.forEach((item) => {
    if (item.key) {
      const expanded = expandedAxis === "yaw"; // only this arrow grows
      const reach = item.key === "e" || item.key === "w" ? width / 2 : depth / 2;
      const radius = reach + ARC_RADIUS_PX * wpp;
      const span = expanded ? ARC_SPAN : ARC_SPAN_COLLAPSED;
      item.pivot.position.set(centre.x, y, centre.z);
      item.pivot.rotation.set(0, item.angle, 0);
      item.view.group.visible = true;
      layoutArc(item.view, radius, -span / 2, span, wpp, expanded, expanded ? HEAD_PX : HEAD_PX_COLLAPSED);
      // White tick: the current angle. Red tick: where the object started.
      const clamped = Math.max(-ARC_SPAN / 2, Math.min(ARC_SPAN / 2, turn));
      const tickWidth = 12 * wpp;
      const tickBreadth = 2.6 * wpp;
      item.view.tick.visible = expanded && Math.abs(turn) > 0.02;
      item.view.tick.position.set(Math.cos(clamped) * radius, Math.sin(clamped) * radius, 0);
      item.view.tick.rotation.z = clamped;
      item.view.tick.scale.set(tickWidth, tickBreadth, 1);
      item.view.originTick.visible = expanded;
      item.view.originTick.position.set(radius, 0, 0);
      item.view.originTick.scale.set(tickWidth, tickBreadth, 1);
      return;
    }
    // The tilt arrow lies flat above the box: its plane normal is the world up
    // axis, and its half-circle opens towards the viewer.

    const expanded = expandedAxis === "tilt"; // only this arrow grows
    item.pivot.position.set(centre.x, centre.y, box.max.z + PITCH_GAP_PX * wpp);
    // Turned 180 degrees about the up axis: the flat arc bows away from the
    // viewer, so on screen it reads as a rainbow arching over the object.
    item.pivot.quaternion.setFromRotationMatrix(TILT_BASIS);
    item.view.group.visible = true;
    const radius = PITCH_RADIUS_PX * wpp;
    const span = expanded ? Math.PI : Math.PI / 4;
    const start = expanded ? 0 : Math.PI / 2 - Math.PI / 8;
    layoutArc(item.view, radius, start, span, wpp, expanded, expanded ? HEAD_PX : HEAD_PX_COLLAPSED, true);
    // Protractor: the red mark stays upright (top of the arch), the white tick
    // follows how far the object has been tilted.
    const tiltAngle = Math.PI / 2 - Math.max(-Math.PI / 2, Math.min(Math.PI / 2, tilt));
    const tickW = 12 * wpp;
    const tickB = 2.6 * wpp;
    item.view.tick.visible = expanded && Math.abs(tilt) > 0.02;
    item.view.tick.position.set(Math.cos(tiltAngle) * radius, Math.sin(tiltAngle) * radius, 0);
    item.view.tick.rotation.z = tiltAngle;
    item.view.tick.scale.set(tickW, tickB, 1);
    item.view.originTick.visible = expanded;
    item.view.originTick.position.set(0, radius, 0);
    item.view.originTick.rotation.z = Math.PI / 2;
    item.view.originTick.scale.set(tickW, tickB, 1);
  });
}

export function pickRotationHandle(handles, raycaster) {
  if (handles.group.visible === false) return null;
  const targets = handles.items.map((item) => item.pivot);
  const hits = raycaster.intersectObjects(targets, true);
  if (hits.length === 0) return null;
  let node = hits[0].object;
  while (node && !node.userData.handle) node = node.parent;
  return node ? node.userData.handle : null;
}

export function setHoveredRotationHandle(handles, id) {
  handles.items.forEach((item) => item.material.color.setHex(item.id === id ? HOVER_COLOR : BASE_COLOR));
}

