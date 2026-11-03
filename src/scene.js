import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

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
  scene.background = new THREE.Color(0xdde4ec);
  scene.fog = new THREE.Fog(0xdde4ec, 40, 140);
  return scene;
}

export function createCamera(container) {
  const camera = new THREE.PerspectiveCamera(
    50,
    container.clientWidth / container.clientHeight,
    0.1,
    300
  );
  camera.position.set(9, 8, 13);
  camera.lookAt(0, 0.5, 0);
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
  scene.add(ground);

  // Minor grid lines (every 1 unit) + darker major lines (every 5 units).
  const minor = new THREE.GridHelper(40, 40, 0xc9d3de, 0xdfe6ee);
  minor.position.y = 0.004;
  scene.add(minor);

  const major = new THREE.GridHelper(40, 8, 0x8f9cb0, 0xa8b4c4);
  major.position.y = 0.006;
  scene.add(major);

  return { ground, minor, major };
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

export function createControls(camera, domElement) {
  const controls = new OrbitControls(camera, domElement);
  controls.target.set(0, 0.6, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 4;
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
  transform.setRotationSnap(THREE.MathUtils.degToRad(15));
  transform.setScaleSnap(0.1);
  return transform;
}

export function handleResize(renderer, camera, container) {
  function onResize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }
  window.addEventListener('resize', onResize);
  return onResize;
}
