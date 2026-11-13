import * as THREE from "three";

const SIZE = 128;

// label, local plane transform, and the camera direction that looks at that face.
const FACES = [
  { label: "FRONT", pos: [0, 0, 0.5], rot: [0, 0, 0], axis: [0, 0, 1] },
  { label: "BACK", pos: [0, 0, -0.5], rot: [0, Math.PI, 0], axis: [0, 0, -1] },
  { label: "RIGHT", pos: [0.5, 0, 0], rot: [0, Math.PI / 2, 0], axis: [1, 0, 0] },
  { label: "LEFT", pos: [-0.5, 0, 0], rot: [0, -Math.PI / 2, 0], axis: [-1, 0, 0] },
  { label: "TOP", pos: [0, 0.5, 0], rot: [-Math.PI / 2, 0, 0], axis: [0, 1, 0.02] },
  { label: "BOTTOM", pos: [0, -0.5, 0], rot: [Math.PI / 2, 0, 0], axis: [0, -1, 0.02] },
];
function makeTexture(label, hover) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = hover ? "#4a90d9" : "#e7ecf2";
  ctx.fillRect(0, 0, 256, 256);
  ctx.lineWidth = 12;
  ctx.strokeStyle = hover ? "#2f6fb0" : "#b7c1cd";
  ctx.strokeRect(6, 6, 244, 244);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = hover ? "#ffffff" : "#33404f";
  let size = 56;
  do {
    ctx.font = "700 " + size + "px system-ui, -apple-system, sans-serif";
    size -= 2;
  } while (ctx.measureText(label).width > 196 && size > 14);
  ctx.fillText(label, 128, 130);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
export function createViewCube({ mount, getCamera, controls, onFaceView, cancelTween }) {
  if (!mount) return { update() {} };
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(SIZE, SIZE, false);
  const canvas = renderer.domElement;
  canvas.style.width = SIZE + "px";
  canvas.style.height = SIZE + "px";
  canvas.style.display = "block";
  canvas.style.cursor = "grab";
  mount.appendChild(canvas);

  const scene = new THREE.Scene();
  const cubeCamera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  cubeCamera.position.set(0, 0, 3.1);
  cubeCamera.lookAt(0, 0, 0);
  const group = new THREE.Group();
  scene.add(group);

  const meshes = [];
  FACES.forEach((face) => {
    const normalTex = makeTexture(face.label, false);
    const hoverTex = makeTexture(face.label, true);
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: normalTex })
    );
    mesh.position.set(face.pos[0], face.pos[1], face.pos[2]);
    mesh.rotation.set(face.rot[0], face.rot[1], face.rot[2]);
    mesh.userData.index = meshes.length;
    mesh.userData.axis = face.axis;
    mesh.userData.normalTex = normalTex;
    mesh.userData.hoverTex = hoverTex;
    meshes.push(mesh);
    group.add(mesh);
  });

  group.add(new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(1.002, 1.002, 1.002)),
    new THREE.LineBasicMaterial({ color: 0x8a97a5 })
  ));
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let hovered = -1;
  let dragging = false;
  let moved = false;
  let totalMove = 0;
  let lastX = 0;
  let lastY = 0;

  function setHover(index) {
    if (index === hovered) return;
    if (hovered >= 0) {
      const m = meshes[hovered];
      m.material.map = m.userData.normalTex;
      m.material.needsUpdate = true;
    }
    hovered = index;
    if (hovered >= 0) {
      const m = meshes[hovered];
      m.material.map = m.userData.hoverTex;
      m.material.needsUpdate = true;
    }
    canvas.style.cursor = dragging ? "grabbing" : index >= 0 ? "pointer" : "grab";
  }

  function pick(event) {
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    group.updateMatrixWorld(true);
    raycaster.setFromCamera(pointer, cubeCamera);
    const hits = raycaster.intersectObjects(meshes, false);
    return hits.length ? hits[0].object.userData.index : -1;
  }

  function orbit(dx, dy) {
    cancelTween?.();
    const cam = getCamera();
    const offset = cam.position.clone().sub(controls.target);
    const sph = new THREE.Spherical().setFromVector3(offset);
    sph.theta -= dx * 0.01;
    sph.phi -= dy * 0.01;
    sph.phi = Math.max(0.02, Math.min(Math.PI - 0.02, sph.phi));
    offset.setFromSpherical(sph);
    cam.position.copy(controls.target).add(offset);
    controls.update();
  }

  canvas.addEventListener("pointerdown", (event) => {
    dragging = true;
    moved = false;
    totalMove = 0;
    lastX = event.clientX;
    lastY = event.clientY;
    setHover(pick(event));
    canvas.style.cursor = "grabbing";
    try { canvas.setPointerCapture(event.pointerId); } catch (e) {}
    event.preventDefault();
  });

  canvas.addEventListener("pointermove", (event) => {
    if (dragging) {
      const dx = event.clientX - lastX;
      const dy = event.clientY - lastY;
      lastX = event.clientX;
      lastY = event.clientY;
      totalMove += Math.abs(dx) + Math.abs(dy);
      if (totalMove > 4) moved = true;
      if (moved) orbit(dx, dy);
    } else {
      setHover(pick(event));
    }
  });

  function endDrag(event) {
    if (!dragging) return;
    dragging = false;
    canvas.style.cursor = hovered >= 0 ? "pointer" : "grab";
    try { canvas.releasePointerCapture(event.pointerId); } catch (e) {}
    if (!moved && hovered >= 0) onFaceView?.(meshes[hovered].userData.axis);
    moved = false;
  }
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);
  canvas.addEventListener("pointerleave", () => {
    if (!dragging) setHover(-1);
  });

  function update() {
    group.quaternion.copy(getCamera().quaternion).invert();
    renderer.render(scene, cubeCamera);
  }

  return { update };
}
