import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

// Default ("home") view the camera resets to.
export const HOME_CAMERA_POSITION = new THREE.Vector3(9, 8, 13);
export const HOME_TARGET = new THREE.Vector3(0, 0.6, 0);

export function createRenderer(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  container.appendChild(renderer.domElement);
  return renderer;
}

export function createScene() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  scene.fog = new THREE.Fog(0x000000, 40, 140);
  return scene;
}

export function createCamera(container) {
  const camera = new THREE.PerspectiveCamera(
    50,
    container.clientWidth / container.clientHeight,
    0.5,
    2000
  );
  camera.position.copy(HOME_CAMERA_POSITION);
  camera.lookAt(HOME_TARGET);
  return camera;
}

export function createLights(scene) {
  const hemi = new THREE.HemisphereLight(0xffffff, 0x8a97a5, 1.0);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(12, 22, 10);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 0.5;
  sun.shadow.camera.far = 80;
  sun.shadow.camera.left = -40;
  sun.shadow.camera.right = 40;
  sun.shadow.camera.top = 40;
  sun.shadow.camera.bottom = -40;
  sun.shadow.bias = -0.0004;
  scene.add(sun);

  return { hemi, sun };
}

export function createGround(scene) {
  // Invisible plane that catches shadows.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 400),
    new THREE.ShadowMaterial({ opacity: 0.25 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  // A shadow catcher must not write depth or it can fight the grid above it.
  ground.material.depthWrite = false;
  ground.renderOrder = 0;
  scene.add(ground);

  // The work grid lines are rebuilt by grid.js whenever the units or the
  // work-area size change, so they keep exact real-world spacings.
  const gridGroup = new THREE.Group();
  scene.add(gridGroup);

  return { ground, gridGroup };
}

// Studio-style image-based lighting so standard materials get nice reflections.
export function applyEnvironment(renderer, scene) {
  try {
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
  } catch (error) {
    // Environment generation can fail on some GPUs; fall back to the plain lights
    // so shapes still render.
    console.warn('Environment lighting unavailable:', error);
  }
}


let studioScale = 0;

// Size the sun and its shadow camera from the work area so a 20 cm bed is fully
// lit without wasting shadow resolution on a small grid.
export function applyStudioScale(lights, width, length) {
  const max = Math.max(width || 40, length || 40);
  if (Math.abs(studioScale - max) < 0.01) return;
  studioScale = max;
  const sun = lights.sun;
  const reach = Math.max(20, max * 0.7);
  sun.position.set(max * 0.3, max * 0.55, max * 0.25);
  sun.shadow.camera.left = -reach;
  sun.shadow.camera.right = reach;
  sun.shadow.camera.top = reach;
  sun.shadow.camera.bottom = -reach;
  sun.shadow.camera.near = 0.5;
  sun.shadow.camera.far = max * 3;
  sun.shadow.camera.updateProjectionMatrix();
  const size = max > 120 ? 4096 : 2048;
  // Bias scaled to the shadow texel so it stays stable at any work-area size.
  const texel = (2 * reach) / size;
  sun.shadow.bias = -texel * 0.5;
  sun.shadow.normalBias = texel * 0.5;
  if (sun.shadow.mapSize.x !== size) {
    sun.shadow.mapSize.set(size, size);
    if (sun.shadow.map) {
      sun.shadow.map.dispose();
      sun.shadow.map = null;
    }
  }
}
export function createControls(camera, domElement) {
  const controls = new OrbitControls(camera, domElement);
  controls.target.copy(HOME_TARGET);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 2;
  controls.maxDistance = 80;
  controls.maxPolarAngle = Math.PI / 2 - 0.03; // stay above the ground
  // Left mouse is reserved for selecting / dragging shapes.
  controls.mouseButtons = {
    LEFT: null,
    MIDDLE: THREE.MOUSE.PAN,
    RIGHT: THREE.MOUSE.ROTATE,
  };
  return controls;
}

export function createTransformControls(camera, domElement) {
  const transform = new TransformControls(camera, domElement);
  transform.setMode('translate');
  transform.setSize(0.9);
  transform.setTranslationSnap(1);
  transform.setRotationSnap(null); // free rotation by default; Shift snaps to 15deg
  transform.setScaleSnap(0.1);
  return transform;
}

export function handleResize(renderer, getCamera, container) {
  function onResize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    const cam = getCamera();
    if (cam.isOrthographicCamera) {
      const halfH = (cam.top - cam.bottom) / 2;
      cam.left = -halfH * (w / h);
      cam.right = halfH * (w / h);
    } else {
      cam.aspect = w / h;
    }
    cam.updateProjectionMatrix();
    renderer.setSize(w, h);
  }
  window.addEventListener('resize', onResize);
  return onResize;
}
