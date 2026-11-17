import * as THREE from 'three';
import { OrbitControls } from './vendor/addons/controls/OrbitControls.js';
import { RoomEnvironment } from './vendor/addons/environments/RoomEnvironment.js';
import { GLTFLoader } from './vendor/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from './vendor/meshopt_decoder.module.js';

const $ = selector => document.querySelector(selector);
const buttons = Array.from(document.querySelectorAll('button'));
const viewButtons = Array.from(document.querySelectorAll('[data-view]'));
const homeTarget = new THREE.Vector3(0, 1.75, 0);
const initialPosition = new THREE.Vector3(.15, 2.0, 8.3);
const initialOffset = initialPosition.clone().sub(homeTarget);
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let renderer, scene, camera, controls, model, modelBounds, modelSphere;
let frameId = 0, active = !document.hidden, ready = false, failed = false;
let autoRotate = false, lightMode = 'day', transition = null, fullBody = true;
let fitDistance = initialOffset.length(), previousFrameTime = performance.now();
let loadedBytes = 0, totalBytes = 0, stageWidth = 1, stageHeight = 1;

function announce(text) { $('#announcement').textContent = text; }
function setAutoRotate(value) {
  autoRotate = value;
  $('#auto-rotate').setAttribute('aria-checked', String(value));
  if (controls) controls.autoRotate = value;
}
function fallback(message) {
  ready = false; failed = true; transition = null; setAutoRotate(false);
  $('#loading').hidden = true; $('#fallback').hidden = false;
  $('#fallback-message').textContent = message; $('#viewer').hidden = true;
  $('#stage').setAttribute('aria-busy', 'false');
  buttons.forEach(button => { button.disabled = true; });
  $('#download-model').removeAttribute('href');
  $('#download-model').setAttribute('aria-disabled', 'true');
  $('#download-model').tabIndex = -1;
  if (controls) controls.enabled = false;
  document.body.dataset.ready = 'fallback';
  if (frameId) cancelAnimationFrame(frameId);
  frameId = 0; announce(message);
}

function updateFitDistance() {
  if (!modelSphere || !model) return;
  const vertical = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const horizontal = vertical * camera.aspect;
  const marginX = .90;
  const marginY = Math.min(.86, Math.max(.70, (stageHeight - 100) / stageHeight));
  const direction = camera.position.clone().sub(controls.target).normalize();
  const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), direction).normalize();
  const up = new THREE.Vector3().crossVectors(direction, right).normalize();
  const point = new THREE.Vector3();
  let distance = 0;
  model.traverse(object => {
    if (!object.isMesh) return;
    const positions = object.geometry.attributes.position;
    for (let index = 0; index < positions.count; index++) {
      object.getVertexPosition(index, point); point.applyMatrix4(object.matrixWorld); point.sub(homeTarget);
      const depth = point.dot(direction);
      distance = Math.max(distance, depth + Math.abs(point.dot(right)) / (horizontal * marginX), depth + Math.abs(point.dot(up)) / (vertical * marginY));
    }
  });
  fitDistance = Math.max(6.2, distance + .12);
  controls.minDistance = Math.max(2.6, modelSphere.radius * 1.3);
  controls.maxDistance = Math.max(18, fitDistance * 2.2);
  camera.far = Math.max(100, controls.maxDistance * 3);
}
function resize() {
  if (!renderer || failed) return;
  const bounds = $('#stage').getBoundingClientRect();
  stageWidth = Math.max(1, bounds.width); stageHeight = Math.max(1, bounds.height);
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.setSize(stageWidth, stageHeight, false);
  camera.aspect = stageWidth / stageHeight;
  updateFitDistance();
  if (ready && fullBody) {
    transition = null;
    const direction = camera.position.clone().sub(controls.target).normalize();
    controls.target.copy(homeTarget);
    camera.position.copy(homeTarget).addScaledVector(direction, fitDistance);
  }
  camera.updateProjectionMatrix(); requestRender();
}
function requestRender() {
  if (!active || frameId || failed || !renderer) return;
  frameId = requestAnimationFrame(render);
}
function render(now) {
  frameId = 0;
  if (!active || failed || !renderer) return;
  const dt = Math.min((now - previousFrameTime) / 1000, .05);
  previousFrameTime = now;
  if (transition) {
    const t = Math.min(1, (now - transition.start) / transition.duration);
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
  controls.autoRotate = ready && autoRotate && !transition;
  const changed = controls.update(dt);
  renderer.render(scene, camera);
  if ((ready && autoRotate) || transition || changed) requestRender();
}
function freeView() {
  viewButtons.forEach(button => button.setAttribute('aria-pressed', 'false'));
  $('#angle-label').textContent = fullBody ? '青衫 · 自由视角' : '青衫 · 局部观察';
}
function preset(name) {
  if (!ready || !['front', 'side', 'back'].includes(name)) return;
  setAutoRotate(false); fullBody = true;
  // glTF +Z is the front, +Y is up. Never rotate the imported model.
  const direction = initialOffset.clone().normalize();
  if (name === 'side') direction.applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
  if (name === 'back') direction.applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
  const to = homeTarget.clone().addScaledVector(direction, fitDistance);
  // Flush residual pointer damping before beginning a deterministic preset.
  controls.enableDamping = false; controls.update();
  controls.enableDamping = !reducedMotion.matches;
  if (reducedMotion.matches) {
    camera.position.copy(to); controls.target.copy(homeTarget); transition = null;
  } else {
    const from = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
    const destination = new THREE.Spherical().setFromVector3(to.clone().sub(homeTarget));
    const thetaDelta = Math.atan2(Math.sin(destination.theta - from.theta), Math.cos(destination.theta - from.theta));
    transition = { from, to: destination, thetaDelta, fromTarget: controls.target.clone(), start: performance.now(), duration: 600 };
  }
  viewButtons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.view === name)));
  const label = { front: '正面', side: '侧面', back: '背面' }[name];
  $('#angle-label').textContent = '青衫 · 全身' + label;
  announce('已切换为全身' + label + '视角'); requestRender();
}
function zoom(factor) {
  if (!ready) return;
  transition = null; fullBody = false;
  const delta = camera.position.clone().sub(controls.target);
  delta.setLength(THREE.MathUtils.clamp(delta.length() * factor, controls.minDistance, controls.maxDistance));
  camera.position.copy(controls.target).add(delta);
  freeView(); requestRender();
}
function progress(event) {
  if (failed) return;
  loadedBytes = event.loaded; totalBytes = event.lengthComputable ? event.total : 0;
  const mb = bytes => (bytes / 1048576).toFixed(1) + ' MB';
  if (totalBytes > 0) {
    const percent = Math.min(100, loadedBytes / totalBytes * 100);
    $('#loading-progress').value = percent;
    $('#loading-status').textContent = percent >= 100 ? '正在整理绒面与衣饰…' : '青衫企鹅正在就位…';
    $('#loading-detail').textContent = `${Math.floor(percent)}% · ${mb(loadedBytes)} / ${mb(totalBytes)}`;
  } else {
    $('#loading-progress').removeAttribute('value');
    $('#loading-status').textContent = '青衫企鹅正在就位…';
    $('#loading-detail').textContent = '已收到 ' + mb(loadedBytes);
  }
}

window.__QINGSHAN_REFINED__ = {
  state: () => ({ ready, failed, camera: camera?.position.toArray() || null, target: controls?.target.toArray() || null, autoRotate, lightMode, active, fullBody, fitDistance, loadedBytes, totalBytes, rendering: Boolean(frameId), transitioning: Boolean(transition), reducedMotion: reducedMotion.matches, aspect: camera?.aspect || 0, meshes: renderer?.info.render.calls || 0, triangles: renderer?.info.render.triangles || 0 }),
  modelStats: () => {
    if (!model) return null;
    let meshes = 0, triangles = 0, vertices = 0;
    const materials = new Set(), textures = new Set();
    model.traverse(object => {
      if (!object.isMesh) return;
      meshes++; const geometry = object.geometry;
      vertices += geometry.attributes.position?.count || 0;
      triangles += (geometry.index?.count || geometry.attributes.position?.count || 0) / 3;
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        materials.add(material);
        for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
      }
    });
    return { meshes, triangles, vertices, materials: materials.size, textures: textures.size, bounds: modelBounds.getSize(new THREE.Vector3()).toArray(), min: modelBounds.min.toArray(), max: modelBounds.max.toArray(), boundingSphere: { center: modelSphere.center.toArray(), radius: modelSphere.radius } };
  }
};

try {
  renderer = new THREE.WebGLRenderer({ canvas: $('#viewer'), antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = .98;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
  scene = new THREE.Scene(); scene.background = new THREE.Color('#e9eee2');
  camera = new THREE.PerspectiveCamera(32, 1, .05, 100); camera.position.copy(initialPosition);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enabled = false; controls.target.copy(homeTarget);
  controls.enableDamping = !reducedMotion.matches; controls.dampingFactor = .08;
  controls.enablePan = false; controls.minPolarAngle = .35; controls.maxPolarAngle = Math.PI / 2 + .06;
  controls.autoRotateSpeed = 1.1; controls.rotateSpeed = .65; controls.zoomSpeed = .7;
  controls.addEventListener('change', requestRender);
  controls.addEventListener('start', () => { transition = null; setAutoRotate(false); freeView(); });
  $('#viewer').addEventListener('wheel', () => { if (ready) { fullBody = false; freeView(); } }, { passive: true });
  $('#viewer').addEventListener('touchmove', event => { if (ready && event.touches.length > 1) { fullBody = false; freeView(); } }, { passive: true });
  const environment = new RoomEnvironment(), generator = new THREE.PMREMGenerator(renderer);
  scene.environment = generator.fromScene(environment, .04).texture; scene.environmentIntensity = .20;
  environment.dispose(); generator.dispose();
  const ambient = new THREE.HemisphereLight('#f7ffe9', '#88977d', 1.25); scene.add(ambient);
  const key = new THREE.DirectionalLight('#fff1da', 2.05); key.position.set(-3, 6, 4.5); key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048); key.shadow.camera.left = -4; key.shadow.camera.right = 4;
  key.shadow.camera.top = 5; key.shadow.camera.bottom = -3; key.shadow.camera.near = .1; key.shadow.camera.far = 18;
  key.shadow.bias = -.0002; key.shadow.normalBias = .025; key.shadow.radius = 4; scene.add(key);
  const fill = new THREE.DirectionalLight('#d3edf1', .65); fill.position.set(4, 3, 2); scene.add(fill);
  const rim = new THREE.DirectionalLight('#f9e7c4', 1.4); rim.position.set(1, 5, -3); scene.add(rim);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.ShadowMaterial({ color: '#314735', opacity: .20 }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -.015; floor.receiveShadow = true; scene.add(floor);
  controls.update(); new ResizeObserver(resize).observe($('#stage')); resize();

  viewButtons.forEach(button => button.addEventListener('click', () => preset(button.dataset.view)));
  $('#reset').addEventListener('click', () => preset('front'));
  $('#zoom-in').addEventListener('click', () => zoom(.85)); $('#zoom-out').addEventListener('click', () => zoom(1.17));
  $('#auto-rotate').addEventListener('click', () => { if (!ready) return; transition = null; setAutoRotate(!autoRotate); freeView(); requestRender(); });
  document.querySelectorAll('[data-light]').forEach(button => button.addEventListener('click', () => {
    if (!ready) return;
    lightMode = button.dataset.light; const night = lightMode === 'night';
    document.body.dataset.light = lightMode; scene.background.set(night ? '#1b3027' : '#e9eee2');
    floor.material.color.set(night ? '#000000' : '#314735'); ambient.intensity = night ? .75 : 1.25;
    fill.intensity = night ? .45 : .65; rim.intensity = night ? 1.8 : 1.4;
    document.querySelectorAll('[data-light]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
    announce(night ? '已切换夜间灯光' : '已切换日间灯光'); requestRender();
  }));
  $('#viewer').addEventListener('keydown', event => {
    if (!ready) return;
    if (['+', '=', '-', 'Home'].includes(event.key)) {
      event.preventDefault(); if (event.key === 'Home') preset('front'); else zoom(event.key === '-' ? 1.1 : .9);
    }
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
      transition = null; setAutoRotate(false);
      const sphere = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
      if (event.key === 'ArrowLeft') sphere.theta -= .14;
      if (event.key === 'ArrowRight') sphere.theta += .14;
      if (event.key === 'ArrowUp') sphere.phi = Math.max(controls.minPolarAngle, sphere.phi - .1);
      if (event.key === 'ArrowDown') sphere.phi = Math.min(controls.maxPolarAngle, sphere.phi + .1);
      camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(sphere));
      event.preventDefault(); freeView(); requestRender();
    }
  });
  document.addEventListener('visibilitychange', () => {
    active = !document.hidden;
    const now = performance.now();
    if (active) {
      previousFrameTime = now;
      if (transition?.pausedAt) { transition.start += now - transition.pausedAt; delete transition.pausedAt; }
      requestRender();
    } else {
      if (transition) transition.pausedAt = now;
      if (frameId) { cancelAnimationFrame(frameId); frameId = 0; }
    }
  });
  reducedMotion.addEventListener('change', () => {
    controls.enableDamping = !reducedMotion.matches;
    if (reducedMotion.matches) { setAutoRotate(false); if (transition) { camera.position.copy(homeTarget).add(new THREE.Vector3().setFromSpherical(transition.to)); controls.target.copy(homeTarget); transition = null; } }
    requestRender();
  });
  $('#viewer').addEventListener('webglcontextlost', event => { event.preventDefault(); fallback('三维画面暂时中断，请刷新页面，或回到高清图片展示。'); });

  new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).load('./qingshan-refined.glb', gltf => {
    if (failed) return;
    try {
      model = gltf.scene; model.updateMatrixWorld(true);
      modelBounds = new THREE.Box3().setFromObject(model, true);
      if (modelBounds.isEmpty()) throw new Error('Loaded model has no visible bounds');
      // Derive a real enclosing sphere from vertices; a box diagonal overestimates this rounded character.
      const center = modelBounds.getCenter(new THREE.Vector3()), point = new THREE.Vector3();
      let radiusSquared = 0;
      model.traverse(object => {
        if (!object.isMesh) return;
        object.castShadow = true; object.receiveShadow = true;
        const position = object.geometry.attributes.position;
        for (let index = 0; index < position.count; index++) {
          object.getVertexPosition(index, point); point.applyMatrix4(object.matrixWorld);
          radiusSquared = Math.max(radiusSquared, point.distanceToSquared(center));
        }
        // Imported materials, texture color spaces and normalMap scales remain as authored.
      });
      modelSphere = new THREE.Sphere(center, Math.sqrt(radiusSquared)); scene.add(model);
      floor.position.y = modelBounds.min.y - .012;
      ready = true; controls.enabled = true; resize(); controls.update();
      buttons.forEach(button => { button.disabled = false; });
      const download = $('#download-model'); download.href = './qingshan-refined.glb'; download.tabIndex = 0; download.setAttribute('aria-disabled', 'false');
      $('#loading-progress').value = 100; $('#loading').hidden = true; $('#stage').setAttribute('aria-busy', 'false');
      document.body.dataset.ready = 'true';
      announce('精修试稿已就位。可拖动旋转，滚轮或双指缩放，也可使用视角按钮。'); requestRender();
    } catch (error) {
      console.error('Model preparation failed:', error); fallback('模型暂时没有准备好，请刷新重试，或先看看高清图片。');
    }
  }, progress, error => {
    console.error('Model loading failed:', error); fallback('模型暂时没有加载成功，请检查网络后刷新，或先看看高清图片。');
  });
} catch (error) {
  console.error('Viewer initialization failed:', error);
  fallback('当前浏览器无法开启三维展示，请换用支持三维画面的浏览器，或先看看高清图片。');
}
