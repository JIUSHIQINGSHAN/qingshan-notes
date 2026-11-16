import * as THREE from 'three';
import { OrbitControls } from './vendor/addons/controls/OrbitControls.js';
import { RoomEnvironment } from './vendor/addons/environments/RoomEnvironment.js';
import { GLTFExporter } from './vendor/addons/exporters/GLTFExporter.js';
import { createPenguin } from './penguin.js';

const $ = selector => document.querySelector(selector);
const buttons = Array.from(document.querySelectorAll('button'));
let renderer, scene, camera, controls, model;
let frameId = 0;
let active = true;
let autoRotate = false;
let lightMode = 'day';
let transition = null;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const homeTarget = new THREE.Vector3(0, 1.64, 0);
const initialPosition = new THREE.Vector3(.35, 2.05, 7.1);
let previousFrameTime = performance.now();

function fallback(message) {
  $('#loading').hidden = true;
  $('#fallback').hidden = false;
  $('#fallback-message').textContent = message;
  $('#viewer').hidden = true;
  buttons.forEach(button => { button.disabled = true; });
  document.body.dataset.ready = 'fallback';
  if (frameId) cancelAnimationFrame(frameId);
}

function resize() {
  if (!renderer) return;
  const bounds = $('#stage').getBoundingClientRect();
  renderer.setSize(bounds.width, bounds.height, false);
  camera.aspect = bounds.width / bounds.height;
  camera.updateProjectionMatrix();
  requestRender();
}
function requestRender() {
  if (!active || frameId) return;
  frameId = requestAnimationFrame(render);
}
function render() {
  frameId = 0;
  if (!active || !renderer) return;
  const now = performance.now();
  const dt = Math.min((now - previousFrameTime) / 1000, .05);
  previousFrameTime = now;
  if (transition) {
    const t = Math.min(1, (performance.now() - transition.start) / transition.duration);
    const ease = t * t * (3 - 2 * t);
    const spherical = new THREE.Spherical(
      THREE.MathUtils.lerp(transition.from.radius, transition.to.radius, ease),
      THREE.MathUtils.lerp(transition.from.phi, transition.to.phi, ease),
      transition.from.theta + transition.thetaDelta * ease
    );
    controls.target.lerpVectors(transition.fromTarget, homeTarget, ease);
    camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(spherical));
    if (t === 1) transition = null;
  }
  controls.autoRotate = autoRotate && !transition;
  const changed = controls.update(dt);
  renderer.render(scene, camera);
  if (autoRotate || transition || changed) requestRender();
}
function announce(text) { $('#announcement').textContent = text; }
function preset(name) {
  const distance = 7.1;
  const positions = { front: new THREE.Vector3(.0, 2.05, distance), side: new THREE.Vector3(distance, 2.05, .0), back: new THREE.Vector3(.0, 2.05, -distance) };
  const to = positions[name];
  if (!to) return;
  if (reducedMotion.matches) {
    camera.position.copy(to); controls.target.copy(homeTarget); transition = null;
  } else {
    const fromSpherical = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
    const toSpherical = new THREE.Spherical().setFromVector3(to.clone().sub(homeTarget));
    const thetaDelta = Math.atan2(Math.sin(toSpherical.theta - fromSpherical.theta), Math.cos(toSpherical.theta - fromSpherical.theta));
    transition = { from: fromSpherical, to: toSpherical, thetaDelta, fromTarget: controls.target.clone(), start: performance.now(), duration: 600 };
  }
  document.querySelectorAll('[data-view]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.view === name)));
  const label = { front: '正面', side: '侧面', back: '背面' }[name];
  $('#angle-label').textContent = '青衫 · ' + label;
  announce('已切换为' + label + '视角');
  requestRender();
}
function zoom(factor) {
  transition = null;
  const delta = camera.position.clone().sub(controls.target);
  delta.setLength(THREE.MathUtils.clamp(delta.length() * factor, controls.minDistance, controls.maxDistance));
  camera.position.copy(controls.target).add(delta);
  requestRender();
}

try {
  renderer = new THREE.WebGLRenderer({ canvas: $('#viewer'), antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = .98;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  scene = new THREE.Scene();
  scene.background = new THREE.Color('#e9eee2');
  camera = new THREE.PerspectiveCamera(32, 1, .05, 100);
  camera.position.copy(initialPosition);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(homeTarget);
  controls.enableDamping = true;
  controls.dampingFactor = .08;
  controls.enablePan = false;
  controls.minDistance = 3.8;
  controls.maxDistance = 10.5;
  controls.minPolarAngle = .35;
  controls.maxPolarAngle = Math.PI / 2 + .06;
  controls.autoRotateSpeed = 1.1;
  controls.rotateSpeed = .65;
  controls.zoomSpeed = .7;
  controls.addEventListener('change', requestRender);
  controls.addEventListener('start', () => { transition = null; document.querySelectorAll('[data-view]').forEach(button => button.setAttribute('aria-pressed', 'false')); $('#angle-label').textContent = '青衫 · 自由视角'; });
  const environment = new RoomEnvironment();
  const generator = new THREE.PMREMGenerator(renderer);
  const envMap = generator.fromScene(environment, .04);
  scene.environment = envMap.texture;
  scene.environmentIntensity = .20;
  environment.dispose(); generator.dispose();

  const ambient = new THREE.HemisphereLight('#f7ffe9', '#88977d', 1.25); scene.add(ambient);
  const key = new THREE.DirectionalLight('#fff1da', 2.05);
  key.position.set(-3, 6, 4.5); key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048); key.shadow.camera.left = -3; key.shadow.camera.right = 3;
  key.shadow.camera.top = 5; key.shadow.camera.bottom = -2; key.shadow.camera.near = .1; key.shadow.camera.far = 15;
  key.shadow.bias = -.0002; key.shadow.normalBias = .025; key.shadow.radius = 4;
  scene.add(key);
  const fill = new THREE.DirectionalLight('#d3edf1', .65); fill.position.set(4, 3, 2); scene.add(fill);
  const rim = new THREE.DirectionalLight('#f9e7c4', 1.4); rim.position.set(1, 5, -3); scene.add(rim);

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.ShadowMaterial({ color: '#314735', opacity: .20 }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -.11; floor.receiveShadow = true; scene.add(floor);
  const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(1.55, 1.59, .10, 96), new THREE.MeshStandardMaterial({ color: '#cbd5bd', roughness: .90 }));
  pedestal.position.y = -.06; pedestal.receiveShadow = true; pedestal.castShadow = true; scene.add(pedestal);
  model = createPenguin(); scene.add(model);
  controls.update();
  new ResizeObserver(resize).observe($('#stage'));
  resize();
  buttons.forEach(button => { button.disabled = false; });
  $('#loading').hidden = true;
  document.body.dataset.ready = 'true';
  announce('3D 模型加载完成。可拖动旋转、滚轮或双指缩放，也可使用视角按钮。');

  document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => preset(button.dataset.view)));
  $('#reset').addEventListener('click', () => { autoRotate = false; $('#auto-rotate').setAttribute('aria-checked', 'false'); preset('front'); });
  $('#zoom-in').addEventListener('click', () => zoom(.85));
  $('#zoom-out').addEventListener('click', () => zoom(1.17));
  $('#auto-rotate').addEventListener('click', () => {
    autoRotate = !autoRotate; $('#auto-rotate').setAttribute('aria-checked', String(autoRotate)); requestRender();
  });
  document.querySelectorAll('[data-light]').forEach(button => button.addEventListener('click', () => {
    lightMode = button.dataset.light;
    const night = lightMode === 'night';
    document.body.dataset.light = lightMode;
    scene.background.set(night ? '#1b3027' : '#e9eee2');
    floor.material.color.set(night ? '#000000' : '#314735');
    pedestal.material.color.set(night ? '#354a3c' : '#cbd5bd');
    ambient.intensity = night ? .75 : 1.25;
    key.intensity = 2.05;
    fill.intensity = night ? .45 : .65;
    rim.intensity = night ? 1.8 : 1.4;
    document.querySelectorAll('[data-light]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
    announce(night ? '已切换夜间灯光' : '已切换日间灯光'); requestRender();
  }));
  $('#viewer').addEventListener('keydown', event => {
    if (event.key === '+' || event.key === '=') { zoom(.9); event.preventDefault(); }
    if (event.key === '-') { zoom(1.1); event.preventDefault(); }
    if (event.key === 'Home') { preset('front'); event.preventDefault(); }
    if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) {
      transition = null;
      const sphere = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
      if (event.key === 'ArrowLeft') sphere.theta -= .14;
      if (event.key === 'ArrowRight') sphere.theta += .14;
      if (event.key === 'ArrowUp') sphere.phi = Math.max(controls.minPolarAngle, sphere.phi - .1);
      if (event.key === 'ArrowDown') sphere.phi = Math.min(controls.maxPolarAngle, sphere.phi + .1);
      camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(sphere));
      event.preventDefault(); requestRender();
    }
  });
  document.addEventListener('visibilitychange', () => {
    active = !document.hidden;
    if (active) { previousFrameTime = performance.now(); requestRender(); }
    else if (frameId) { cancelAnimationFrame(frameId); frameId = 0; }
  });
  $('#viewer').addEventListener('webglcontextlost', event => {
    event.preventDefault(); fallback('3D 画面暂时中断，请刷新页面，或回到高清图片展示。');
  });

  // Used for export and local/online rendering verification; never shown as UI.
  window.__QINGSHAN_3D__ = {
    state: () => ({ camera: camera.position.toArray(), target: controls.target.toArray(), autoRotate, lightMode, meshes: renderer.info.render.calls, triangles: renderer.info.render.triangles, geometries: renderer.info.memory.geometries }),
    modelStats: () => {
      let meshes = 0, lines = 0, triangles = 0, vertices = 0;
      model.traverse(object => {
        if (object.isMesh) { meshes++; const g = object.geometry; vertices += g.attributes.position.count; triangles += (g.index ? g.index.count : g.attributes.position.count) / 3; }
        if (object.isLineSegments) lines++;
      });
      return { meshes, lines, triangles, vertices, bounds: new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3()).toArray() };
    },
    exportGLB: async () => {
      const exporter = new GLTFExporter();
      const buffer = await exporter.parseAsync(model, { binary: true, trs: false, onlyVisible: true, maxTextureSize: 1024 });
      const bytes = new Uint8Array(buffer);
      let value = '';
      for (let start = 0; start < bytes.length; start += 16384) value += String.fromCharCode(...bytes.subarray(start, start + 16384));
      return btoa(value);
    }
  };
  requestRender();
} catch (error) {
  console.error('3D initialization failed:', error);
  fallback('当前浏览器无法开启 3D 展示，请使用支持 WebGL 的浏览器，或回到高清图片版。');
}
