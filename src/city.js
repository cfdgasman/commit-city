// City generator: one plot per day on a weeks x weekdays grid.
// Active days become towers (height and color by count), empty days become parks.

import * as THREE from 'three';

export const CELL = 1.2;          // distance between plot centers
const TOWER_WIDTH = 0.78;
const PARK_SIZE = 0.96;
const MIN_HEIGHT = 0.35;
const MAX_HEIGHT = 9;
const RISE_SPREAD = 0.55;         // fraction of the intro spent staggering weeks

// Color ramp from quiet days to busy days.
const RAMP = ['#2f6f73', '#2fa37a', '#7bc96f', '#f2b134', '#ff7b54', '#ff4f8b'].map((c) => new THREE.Color(c));

function rampColor(t, target) {
  const x = Math.min(0.9999, Math.max(0, t)) * (RAMP.length - 1);
  const i = Math.floor(x);
  return target.copy(RAMP[i]).lerp(RAMP[i + 1], x - i);
}

// Shared uniforms so the day/night toggle is a single value change.
export const cityUniforms = {
  uNight: { value: 0 },
};

/** A MeshStandardMaterial with procedurally lit windows that only show at night. */
function makeTowerMaterial() {
  const material = new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.15 });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = cityUniforms.uNight;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vCCLocal;
        varying vec3 vCCWorld;
        varying vec3 vCCNormal;
        varying vec2 vCCSeed;
        varying float vCCHeight;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vCCLocal = position;
        vCCNormal = normal;
        vec4 ccWorld = vec4(position, 1.0);
        #ifdef USE_INSTANCING
          ccWorld = instanceMatrix * ccWorld;
          vCCSeed = instanceMatrix[3].xz;
          vCCHeight = instanceMatrix[1].y;
        #else
          vCCSeed = vec2(0.0);
          vCCHeight = 1.0;
        #endif
        vCCWorld = (modelMatrix * ccWorld).xyz;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uNight;
        varying vec3 vCCLocal;
        varying vec3 vCCWorld;
        varying vec3 vCCNormal;
        varying vec2 vCCSeed;
        varying float vCCHeight;
        float ccHash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        if (uNight > 0.001 && abs(vCCNormal.y) < 0.5) {
          // Three window columns per face, rows every 0.32 world units.
          float u = abs(vCCNormal.x) > 0.5 ? vCCLocal.z : vCCLocal.x;
          vec2 cell = vec2((u + 0.5) * 3.0, vCCWorld.y / 0.32);
          vec2 g = fract(cell);
          float win = step(0.22, g.x) * step(g.x, 0.78) * step(0.3, g.y) * step(g.y, 0.78);
          float faceId = vCCNormal.x + vCCNormal.z * 2.0;
          float rnd = ccHash(floor(cell) + vCCSeed * 7.13 + faceId * 3.7);
          float lit = step(0.42, rnd);
          float top = vCCHeight - 0.18;
          float inside = step(0.22, vCCWorld.y) * step(vCCWorld.y, top);
          vec3 warm = mix(vec3(1.0, 0.72, 0.38), vec3(0.75, 0.88, 1.0), step(0.9, rnd));
          totalEmissiveRadiance += uNight * win * lit * inside * warm * 1.6;
        }`,
      );
  };
  return material;
}

const towerMaterial = makeTowerMaterial();
const parkMaterial = new THREE.MeshStandardMaterial({ color: '#3f7d4a', roughness: 1 });
const treeMaterial = new THREE.MeshStandardMaterial({ color: '#2e6b3a', roughness: 0.9, flatShading: true });
const trunkMaterial = new THREE.MeshStandardMaterial({ color: '#6b4f3a', roughness: 1 });

/** Map each day to a (week, weekday) slot, GitHub-calendar style. */
function layout(days) {
  if (!days.length) return { slots: [], weeks: 0 };
  const first = new Date(`${days[0].date}T00:00:00Z`);
  const offset = first.getUTCDay(); // first column starts on Sunday
  const slots = days.map((d) => {
    const t = new Date(`${d.date}T00:00:00Z`);
    const idx = Math.round((t - first) / 86400000) + offset;
    return { ...d, week: Math.floor(idx / 7), weekday: idx % 7 };
  });
  return { slots, weeks: slots[slots.length - 1].week + 1 };
}

// Log scale keeps one huge launch day from flattening the rest of the skyline.
export function heightFor(count, max) {
  if (count <= 0 || max <= 0) return 0;
  return MIN_HEIGHT + (MAX_HEIGHT - MIN_HEIGHT) * (Math.log1p(count) / Math.log1p(max));
}

// Colors scale against the 90th percentile so typical days still get variety.
function colorScale(slots) {
  const counts = slots.map((d) => d.count).filter((c) => c > 0).sort((a, b) => a - b);
  if (!counts.length) return 1;
  return Math.max(1, counts[Math.floor((counts.length - 1) * 0.9)]);
}

export class City {
  constructor(days) {
    const { slots, weeks } = layout(days);
    this.slots = slots;
    this.weeks = weeks;
    this.max = slots.reduce((m, d) => Math.max(m, d.count), 0);
    this.colorMax = colorScale(slots);
    this.group = new THREE.Group();
    this.width = weeks * CELL;
    this.depth = 7 * CELL;
    this.progress = 1;
    this.highlighted = -1;

    this.towerSlots = slots.filter((d) => d.count > 0);
    this.parkSlots = slots.filter((d) => d.count === 0);

    this.#buildGround();
    this.#buildTowers();
    this.#buildParks();
    this.setProgress(1);
  }

  position(slot, target = new THREE.Vector3()) {
    return target.set(
      (slot.week + 0.5) * CELL - this.width / 2,
      0,
      (slot.weekday + 0.5) * CELL - this.depth / 2,
    );
  }

  #buildGround() {
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(400, 64),
      new THREE.MeshStandardMaterial({ color: '#6d8a63', roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.group.add(ground);

    // Sidewalk blocks under each plot leave dark "streets" between them.
    const block = new THREE.Mesh(
      new THREE.BoxGeometry(this.width + 1.6, 0.06, this.depth + 1.6),
      new THREE.MeshStandardMaterial({ color: '#3b4357', roughness: 0.95 }),
    );
    block.position.y = 0.03;
    block.receiveShadow = true;
    this.group.add(block);

    // Lane markings along each week street.
    const lineGeo = new THREE.PlaneGeometry(0.04, this.depth + 0.4);
    const lineMat = new THREE.MeshStandardMaterial({ color: '#59627a', roughness: 1 });
    const lines = new THREE.InstancedMesh(lineGeo, lineMat, Math.max(1, this.weeks - 1));
    const m = new THREE.Matrix4();
    const rot = new THREE.Matrix4().makeRotationX(-Math.PI / 2);
    for (let w = 1; w < this.weeks; w++) {
      m.makeTranslation(w * CELL - this.width / 2, 0.065, 0).multiply(rot);
      lines.setMatrixAt(w - 1, m);
    }
    lines.count = Math.max(0, this.weeks - 1);
    this.group.add(lines);
  }

  #buildTowers() {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    geo.translate(0, 0.5, 0); // origin at the base so scaling y grows upward
    const n = Math.max(1, this.towerSlots.length);
    const mesh = new THREE.InstancedMesh(geo, towerMaterial, n);
    mesh.count = this.towerSlots.length;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const color = new THREE.Color();
    this.towerSlots.forEach((slot, i) => {
      slot.height = heightFor(slot.count, this.max);
      slot.baseColor = rampColor(Math.sqrt(slot.count / this.colorMax) * 0.85 + (slot.count > this.colorMax ? 0.15 : 0), new THREE.Color());
      mesh.setColorAt(i, color.copy(slot.baseColor));
    });
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this.towers = mesh;
    this.group.add(mesh);

    // Roof caps: a slightly inset slab on top of each tower.
    const capGeo = new THREE.BoxGeometry(1, 1, 1);
    capGeo.translate(0, 0.5, 0);
    this.caps = new THREE.InstancedMesh(capGeo, new THREE.MeshStandardMaterial({ color: '#d9dee8', roughness: 0.5 }), n);
    this.caps.count = this.towerSlots.length;
    this.caps.castShadow = true;
    this.group.add(this.caps);
  }

  #buildParks() {
    const n = Math.max(1, this.parkSlots.length);
    const plotGeo = new THREE.BoxGeometry(PARK_SIZE, 0.08, PARK_SIZE);
    plotGeo.translate(0, 0.04, 0);
    this.parks = new THREE.InstancedMesh(plotGeo, parkMaterial, n);
    this.parks.count = this.parkSlots.length;
    this.parks.receiveShadow = true;

    const crownGeo = new THREE.ConeGeometry(0.22, 0.5, 6);
    crownGeo.translate(0, 0.45, 0);
    const trunkGeo = new THREE.CylinderGeometry(0.04, 0.05, 0.22, 5);
    trunkGeo.translate(0, 0.11, 0);
    this.crowns = new THREE.InstancedMesh(crownGeo, treeMaterial, n * 2);
    this.trunks = new THREE.InstancedMesh(trunkGeo, trunkMaterial, n * 2);
    this.crowns.castShadow = true;
    this.crowns.count = this.trunks.count = this.parkSlots.length * 2;

    // Deterministic per-plot tree placement.
    this.treeOffsets = this.parkSlots.flatMap((slot) => {
      const h = hash(slot.date);
      return [
        { x: -0.2 + (h % 7) * 0.02, z: -0.18, s: 0.8 + (h % 5) * 0.08 },
        { x: 0.22, z: 0.16 - (h % 3) * 0.04, s: 0.7 + (h % 4) * 0.1 },
      ];
    });

    this.group.add(this.parks, this.crowns, this.trunks);
  }

  /** Animate the skyline rising: t goes 0 -> 1, each week starts a little later. */
  setProgress(t) {
    this.progress = t;
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const local = (week) => {
      const startAt = (week / Math.max(1, this.weeks)) * RISE_SPREAD;
      const x = Math.min(1, Math.max(0, (t - startAt) / (1 - RISE_SPREAD)));
      return easeOutBack(x);
    };

    this.towerSlots.forEach((slot, i) => {
      const k = local(slot.week);
      const h = Math.max(0.0001, slot.height * k);
      this.position(slot, p);
      m.compose(p, q, s.set(TOWER_WIDTH, h, TOWER_WIDTH));
      this.towers.setMatrixAt(i, m);
      p.y = h;
      m.compose(p, q, s.set(TOWER_WIDTH * 0.8, k > 0 ? 0.08 : 0.0001, TOWER_WIDTH * 0.8));
      this.caps.setMatrixAt(i, m);
    });
    this.towers.instanceMatrix.needsUpdate = true;
    this.caps.instanceMatrix.needsUpdate = true;
    this.towers.computeBoundingSphere();

    this.parkSlots.forEach((slot, i) => {
      const k = Math.min(1, local(slot.week));
      this.position(slot, p);
      m.compose(p, q, s.set(1, Math.max(0.0001, k), 1));
      this.parks.setMatrixAt(i, m);
      for (let j = 0; j < 2; j++) {
        const o = this.treeOffsets[i * 2 + j];
        const ts = Math.max(0.0001, o.s * k);
        m.compose(p.clone().add(new THREE.Vector3(o.x, 0.08, o.z)), q, s.set(ts, ts, ts));
        this.crowns.setMatrixAt(i * 2 + j, m);
        this.trunks.setMatrixAt(i * 2 + j, m);
      }
    });
    this.parks.instanceMatrix.needsUpdate = true;
    this.crowns.instanceMatrix.needsUpdate = true;
    this.trunks.instanceMatrix.needsUpdate = true;
    this.parks.computeBoundingSphere();
  }

  /** Raycast towers and parks; returns { slot, kind, index } or null. */
  pick(raycaster) {
    const hits = raycaster.intersectObjects([this.towers, this.parks], false);
    const hit = hits.find((h) => h.instanceId !== undefined);
    if (!hit) return null;
    if (hit.object === this.towers) return { slot: this.towerSlots[hit.instanceId], kind: 'tower', index: hit.instanceId };
    return { slot: this.parkSlots[hit.instanceId], kind: 'park', index: hit.instanceId };
  }

  /** Brighten one tower (or none, with index = -1). */
  highlight(index) {
    if (this.highlighted === index) return;
    const c = new THREE.Color();
    if (this.highlighted >= 0) {
      this.towers.setColorAt(this.highlighted, this.towerSlots[this.highlighted].baseColor);
    }
    if (index >= 0) {
      this.towers.setColorAt(index, c.copy(this.towerSlots[index].baseColor).lerp(new THREE.Color('#ffffff'), 0.55));
    }
    this.highlighted = index;
    if (this.towers.instanceColor) this.towers.instanceColor.needsUpdate = true;
  }

  dispose() {
    this.group.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      const shared = [towerMaterial, parkMaterial, treeMaterial, trunkMaterial];
      if (obj.material && !shared.includes(obj.material)) obj.material.dispose();
    });
  }
}

function easeOutBack(x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const c1 = 1.4;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}
