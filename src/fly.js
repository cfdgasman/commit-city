// Fly camera: drag to look around, WASD to move, Q/E for down/up, Shift to go faster.
// On touch screens, one finger drags to look and the on-screen pad moves.

import * as THREE from 'three';

const LOOK_SPEED = 0.0042;
const MOVE_SPEED = 9;
const MIN_HEIGHT = 0.6;

export class FlyControls {
  constructor(camera, element) {
    this.camera = camera;
    this.element = element;
    this.enabled = false;
    this.keys = new Set();
    this.euler = new THREE.Euler(0, 0, 0, 'YXZ');
    this.dragging = null;

    this.onKeyDown = (e) => {
      if (!this.enabled || isTyping(e)) return;
      this.keys.add(e.code);
    };
    this.onKeyUp = (e) => this.keys.delete(e.code);
    this.onBlur = () => this.keys.clear();
    this.onPointerDown = (e) => {
      if (!this.enabled) return;
      this.dragging = { id: e.pointerId, x: e.clientX, y: e.clientY };
    };
    this.onPointerMove = (e) => {
      if (!this.enabled || !this.dragging || this.dragging.id !== e.pointerId) return;
      const dx = e.clientX - this.dragging.x;
      const dy = e.clientY - this.dragging.y;
      this.dragging.x = e.clientX;
      this.dragging.y = e.clientY;
      this.euler.setFromQuaternion(this.camera.quaternion);
      this.euler.y -= dx * LOOK_SPEED;
      this.euler.x = THREE.MathUtils.clamp(this.euler.x - dy * LOOK_SPEED, -1.5, 1.5);
      this.camera.quaternion.setFromEuler(this.euler);
    };
    this.onPointerUp = (e) => {
      if (this.dragging && this.dragging.id === e.pointerId) this.dragging = null;
    };

    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    element.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerUp);
  }

  /** Bind on-screen buttons that press virtual keys while held. */
  bindTouchPad(container) {
    for (const btn of container.querySelectorAll('[data-key]')) {
      const code = btn.dataset.key;
      const press = (e) => {
        e.preventDefault();
        btn.setPointerCapture?.(e.pointerId);
        this.keys.add(code);
        btn.classList.add('active');
      };
      const release = () => {
        this.keys.delete(code);
        btn.classList.remove('active');
      };
      btn.addEventListener('pointerdown', press);
      btn.addEventListener('pointerup', release);
      btn.addEventListener('pointercancel', release);
      btn.addEventListener('lostpointercapture', release);
      btn.addEventListener('contextmenu', (e) => e.preventDefault());
    }
  }

  /** Moves the camera; returns true if it moved. */
  update(dt) {
    if (!this.enabled) return false;
    const k = this.keys;
    const move = new THREE.Vector3(
      (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0),
      (k.has('KeyE') || k.has('Space') ? 1 : 0) - (k.has('KeyQ') || k.has('ControlLeft') ? 1 : 0),
      (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0) - (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0),
    );
    if (move.lengthSq() === 0) return false;
    const speed = MOVE_SPEED * (k.has('ShiftLeft') || k.has('ShiftRight') ? 2.5 : 1) * dt;
    const vertical = move.y;
    move.y = 0;
    move.normalize().applyQuaternion(this.camera.quaternion).multiplyScalar(speed);
    move.y += vertical * speed;
    this.camera.position.add(move);
    this.camera.position.y = Math.max(MIN_HEIGHT, this.camera.position.y);
    return true;
  }

  dispose() {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.element.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointercancel', this.onPointerUp);
  }
}

function isTyping(e) {
  const t = e.target;
  return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
}
