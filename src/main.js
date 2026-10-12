import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { City, cityUniforms } from './city.js';
import { FlyControls } from './fly.js';
import { loadContributions, computeStats, isValidUsername } from './data.js';

const DEFAULT_USER = 'cfdgasman';
const INTRO_SECONDS = 3.4;

const $ = (id) => document.getElementById(id);
const canvas = $('scene');
const ui = {
  panel: $('panel'),
  collapse: $('btn-collapse'),
  form: $('user-form'),
  input: $('username'),
  status: $('status'),
  stats: $('stats'),
  total: $('stat-total'),
  best: $('stat-best'),
  streak: $('stat-streak'),
  active: $('stat-active'),
  night: $('btn-night'),
  fly: $('btn-fly'),
  shot: $('btn-shot'),
  replay: $('btn-replay'),
  help: $('help'),
  tooltip: $('tooltip'),
  touchpad: $('touchpad'),
};
const coarsePointer = window.matchMedia('(pointer: coarse)').matches;

// ---------------------------------------------------------------- scene

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 600);

const PALETTE = {
  day: { sky: new THREE.Color('#9ecbf0'), fog: new THREE.Color('#bcd9f2'), hemi: 1.1, sun: 2.4, sunColor: new THREE.Color('#fff2dd'), exposure: 1 },
  night: { sky: new THREE.Color('#070b19'), fog: new THREE.Color('#0b1124'), hemi: 0.18, sun: 0.35, sunColor: new THREE.Color('#9db4ff'), exposure: 1.15 },
};

scene.background = PALETTE.day.sky.clone();
scene.fog = new THREE.Fog(PALETTE.day.fog.clone(), 60, 220);

const hemi = new THREE.HemisphereLight('#dfefff', '#3a3f4f', PALETTE.day.hemi);
scene.add(hemi);

const sun = new THREE.DirectionalLight(PALETTE.day.sunColor.clone(), PALETTE.day.sun);
sun.position.set(-30, 50, 25);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 30, bottom: -30, near: 1, far: 140 });
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.02;
scene.add(sun);

const stars = makeStars();
scene.add(stars);

function makeStars() {
  const n = 900;
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(Math.random() * 0.9 + 0.08); // upper hemisphere only
    const r = 260;
    pos.set([r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta)], i * 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({ color: '#ffffff', size: 1.4, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false });
  return new THREE.Points(geo, mat);
}

// ------------------------------------------------------------- controls

const orbit = new OrbitControls(camera, canvas);
orbit.enableDamping = true;
orbit.dampingFactor = 0.08;
orbit.maxPolarAngle = Math.PI * 0.48;
orbit.minDistance = 4;
orbit.maxDistance = 200;
orbit.screenSpacePanning = false;

const fly = new FlyControls(camera, canvas);
fly.bindTouchPad(ui.touchpad);

let mode = 'orbit';

function setMode(next) {
  mode = next;
  const flying = mode === 'fly';
  ui.fly.setAttribute('aria-pressed', String(flying));
  fly.enabled = flying && !intro;
  orbit.enabled = !flying && !intro;
  ui.touchpad.hidden = !(flying && coarsePointer);
  document.body.classList.toggle('touch-fly', flying && coarsePointer);
  if (!flying) {
    // Orbit around the spot on the ground the camera is looking at.
    const dir = camera.getWorldDirection(new THREE.Vector3());
    const t = dir.y < -0.05 ? -camera.position.y / dir.y : 25;
    orbit.target.copy(camera.position).addScaledVector(dir, Math.min(t, 80));
    orbit.target.y = 0;
    orbit.update();
  }
  updateHelp();
}

function updateHelp() {
  const fly = mode === 'fly';
  if (coarsePointer) {
    ui.help.innerHTML = fly
      ? 'Drag to look, use the pad to fly. Tap a building for details.'
      : 'Drag to orbit, pinch to zoom, two fingers to pan. Tap a building for details.';
  } else {
    ui.help.innerHTML = fly
      ? 'Drag to look · <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> move · <kbd>Q</kbd>/<kbd>E</kbd> down/up · <kbd>Shift</kbd> boost'
      : 'Drag to orbit · scroll to zoom · right-drag to pan · <kbd>N</kbd> night · <kbd>F</kbd> fly · <kbd>P</kbd> photo';
  }
}

// ---------------------------------------------------------------- city

let city = null;
let current = null; // { username, days, source, stats }
let loadController = null;

// Camera framing for the current city and viewport.
function framing() {
  const aspect = camera.aspect;
  const w = city ? city.width : 64;
  const d = city ? city.depth : 9;
  const radius = Math.hypot(w, d) / 2;
  const vfov = THREE.MathUtils.degToRad(camera.fov);
  const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);
  const fit = radius / Math.sin(Math.min(vfov, hfov) / 2);
  // Landscape: look across the streets. Portrait: look down the avenue.
  const portrait = aspect < 0.9;
  const distance = fit * (portrait ? 0.6 : 0.62);
  const theta = portrait ? -1.05 : -0.32; // azimuth around the y axis
  const phi = portrait ? 1.0 : 1.02;      // angle from vertical
  return { distance, theta, phi, target: new THREE.Vector3(0, 1.2, 0) };
}

function placeCamera(distance, theta, phi, target) {
  camera.position.setFromSphericalCoords(distance, phi, theta).add(target);
  camera.lookAt(target);
}

let intro = null; // { t }

function startIntro() {
  intro = { t: 0 };
  orbit.enabled = false;
  fly.enabled = false;
  hideTooltip();
  if (mode === 'fly') ui.touchpad.hidden = true;
}

function updateIntro(dt) {
  if (!intro || !city) return;
  intro.t = Math.min(1, intro.t + dt / INTRO_SECONDS);
  const t = intro.t;
  city.setProgress(Math.min(1, t * 1.15));

  const f = framing();
  const e = 1 - Math.pow(1 - t, 3); // ease-out cubic
  const distance = THREE.MathUtils.lerp(f.distance * 2.3, f.distance, e);
  const theta = f.theta + (1 - e) * 1.6;
  const phi = THREE.MathUtils.lerp(0.35, f.phi, e);
  placeCamera(distance, theta, phi, f.target);

  if (t >= 1) {
    intro = null;
    orbit.target.copy(f.target);
    orbit.update();
    setMode(mode);
  }
}

async function build(username) {
  loadController?.abort();
  const controller = (loadController = new AbortController());
  setStatus(`Fetching ${username}'s contributions…`);
  ui.input.value = username;

  let result;
  try {
    result = await loadContributions(username, { signal: controller.signal });
  } catch (err) {
    if (err.name === 'AbortError') return;
    setStatus(`Something went wrong: ${err.message}`, 'error');
    return;
  }
  if (controller.signal.aborted) return;

  if (city) {
    scene.remove(city.group);
    city.dispose();
  }
  city = new City(result.days);
  city.setProgress(0);
  scene.add(city.group);

  const stats = computeStats(result.days);
  current = { ...result, requested: username, stats };
  showStats(stats);

  if (result.source === 'api') {
    setStatus(`${username}'s city: ${result.days.length} days of contributions.`);
    setUserParam(username);
  } else {
    setStatus(`Couldn't load ${username} (${result.error}). Showing a demo city instead.`, 'warn');
  }
  startIntro();
}

function showStats(s) {
  const fmt = (n) => n.toLocaleString();
  ui.total.textContent = fmt(s.total);
  ui.best.textContent = s.best.count ? `${fmt(s.best.count)}` : '0';
  ui.best.title = s.best.date ? formatDate(s.best.date) : '';
  ui.streak.textContent = `${fmt(s.longest)} d`;
  ui.active.textContent = fmt(s.active);
  ui.stats.hidden = false;
}

function setStatus(text, kind = '') {
  ui.status.textContent = text;
  ui.status.className = `status ${kind}`;
}

function setUserParam(username) {
  const url = new URL(window.location.href);
  url.searchParams.set('user', username);
  window.history.replaceState(null, '', url);
}

function formatDate(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

// ------------------------------------------------------------- hover

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let tooltipTimer = 0;

function pickAt(clientX, clientY) {
  if (!city || intro) return null;
  const rect = canvas.getBoundingClientRect();
  pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  return city.pick(raycaster);
}

function showTooltip(hit, x, y) {
  if (!hit) return hideTooltip();
  const { slot } = hit;
  const n = slot.count;
  ui.tooltip.innerHTML = `${formatDate(slot.date)} · ${
    n ? `<strong>${n.toLocaleString()}</strong> contribution${n === 1 ? '' : 's'}` : 'no contributions, just a park 🌳'
  }`;
  ui.tooltip.style.left = `${x}px`;
  ui.tooltip.style.top = `${y}px`;
  ui.tooltip.hidden = false;
  city.highlight(hit.kind === 'tower' ? hit.index : -1);
}

function hideTooltip() {
  ui.tooltip.hidden = true;
  city?.highlight(-1);
}

canvas.addEventListener('pointermove', (e) => {
  if (e.pointerType !== 'mouse') return;
  if (e.buttons) return hideTooltip();
  showTooltip(pickAt(e.clientX, e.clientY), e.clientX, e.clientY);
});
// Touch pointers "leave" right after every tap, so only mouse leaves hide the tooltip.
canvas.addEventListener('pointerleave', (e) => e.pointerType === 'mouse' && hideTooltip());

// Taps (no drag) show the tooltip on touch screens.
let tap = null;
canvas.addEventListener('pointerdown', (e) => {
  tap = { x: e.clientX, y: e.clientY, time: performance.now(), type: e.pointerType };
});
canvas.addEventListener('pointerup', (e) => {
  if (!tap || tap.type === 'mouse') return;
  const moved = Math.hypot(e.clientX - tap.x, e.clientY - tap.y);
  if (moved < 8 && performance.now() - tap.time < 400) {
    showTooltip(pickAt(e.clientX, e.clientY), e.clientX, e.clientY);
    clearTimeout(tooltipTimer);
    tooltipTimer = setTimeout(hideTooltip, 2600);
  } else {
    hideTooltip();
  }
  tap = null;
});

// ---------------------------------------------------------- day / night

let night = false;
let nightMix = 0;

function setNight(on) {
  night = on;
  ui.night.setAttribute('aria-pressed', String(on));
  ui.night.textContent = on ? '☀️ Day' : '🌙 Night';
}

function updateNight(dt) {
  const target = night ? 1 : 0;
  if (nightMix === target) return;
  nightMix = THREE.MathUtils.clamp(nightMix + Math.sign(target - nightMix) * dt * 1.4, 0, 1);
  const k = nightMix;
  const { day, night: n } = PALETTE;
  scene.background.copy(day.sky).lerp(n.sky, k);
  scene.fog.color.copy(day.fog).lerp(n.fog, k);
  hemi.intensity = THREE.MathUtils.lerp(day.hemi, n.hemi, k);
  sun.intensity = THREE.MathUtils.lerp(day.sun, n.sun, k);
  sun.color.copy(day.sunColor).lerp(n.sunColor, k);
  renderer.toneMappingExposure = THREE.MathUtils.lerp(day.exposure, n.exposure, k);
  stars.material.opacity = k;
  cityUniforms.uNight.value = k;
}

// ------------------------------------------------------------ screenshot

function screenshot() {
  renderer.render(scene, camera);
  const src = renderer.domElement;
  const out = document.createElement('canvas');
  out.width = src.width;
  out.height = src.height;
  const ctx = out.getContext('2d');
  ctx.drawImage(src, 0, 0);

  // Caption strip in the corner.
  const scale = Math.max(1, out.width / 1200);
  const pad = 18 * scale;
  const who = current ? (current.source === 'api' ? current.username : 'demo city') : '';
  const total = current ? current.stats.total.toLocaleString() : '';
  const line1 = 'COMMIT CITY';
  const line2 = `${who} · ${total} contributions in the last year`;
  ctx.font = `600 ${22 * scale}px system-ui, sans-serif`;
  const w = Math.max(ctx.measureText(line1).width, (ctx.font = `${16 * scale}px system-ui, sans-serif`, ctx.measureText(line2).width));
  ctx.fillStyle = 'rgba(8, 12, 24, 0.72)';
  ctx.fillRect(pad, out.height - pad - 66 * scale, w + 28 * scale, 56 * scale);
  ctx.fillStyle = '#39d353';
  ctx.font = `700 ${18 * scale}px system-ui, sans-serif`;
  ctx.fillText(line1, pad + 14 * scale, out.height - pad - 42 * scale);
  ctx.fillStyle = '#e8ecf5';
  ctx.font = `${15 * scale}px system-ui, sans-serif`;
  ctx.fillText(line2, pad + 14 * scale, out.height - pad - 20 * scale);

  out.toBlob((blob) => {
    if (!blob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `commit-city-${who.replace(/\W+/g, '-') || 'city'}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }, 'image/png');
}

// ---------------------------------------------------------------- wiring

ui.form.addEventListener('submit', (e) => {
  e.preventDefault();
  const name = ui.input.value.trim().replace(/^@/, '');
  if (!isValidUsername(name)) {
    setStatus('That doesn’t look like a GitHub username.', 'error');
    return;
  }
  ui.input.blur();
  build(name);
});
ui.night.addEventListener('click', () => setNight(!night));
function setCollapsed(on) {
  ui.panel.classList.toggle('collapsed', on);
  ui.collapse.setAttribute('aria-expanded', String(!on));
  resize();
}
ui.collapse.addEventListener('click', () => setCollapsed(!ui.panel.classList.contains('collapsed')));
ui.fly.addEventListener('click', () => setMode(mode === 'fly' ? 'orbit' : 'fly'));
ui.shot.addEventListener('click', screenshot);
ui.replay.addEventListener('click', () => city && startIntro());

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.code === 'KeyN') setNight(!night);
  else if (e.code === 'KeyF') setMode(mode === 'fly' ? 'orbit' : 'fly');
  else if (e.code === 'KeyP') screenshot();
  else if (e.code === 'KeyR' && city) startIntro();
});

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  // Center the city in the space the panel leaves free: beside it on wide
  // screens, below it on narrow ones.
  const rect = ui.panel.getBoundingClientRect();
  const dx = w > 900 ? Math.round(rect.right / 2) : 0;
  const dy = w > 900 ? 0 : Math.round(rect.bottom / 2);
  camera.setViewOffset(w, h, -dx, -dy, w, h);
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
new ResizeObserver(resize).observe(ui.panel);
if (window.innerWidth <= 600) setCollapsed(true);
else resize();
updateHelp();

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);
  updateIntro(dt);
  updateNight(dt);
  if (!intro) {
    if (mode === 'fly') fly.update(dt);
    else orbit.update();
  }
  renderer.render(scene, camera);
});

const params = new URLSearchParams(window.location.search);
if (params.get('night') === '1') setNight(true);
build((params.get('user') || DEFAULT_USER).trim());
