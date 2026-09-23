import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const ORBIT_DISTANCE = 35;
const ORBIT_HEIGHT = 20;

export class CameraController {
  constructor(camera, canvas) {
    this.camera = camera;
    this.canvas = canvas;

    this.orbit = new OrbitControls(camera, canvas);
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = 0.08;
    this.orbit.maxPolarAngle = Math.PI * 0.48;
    this.orbit.minPolarAngle = Math.PI * 0.05;
    this.orbit.minDistance = 8;
    this.orbit.maxDistance = 150;
    this.orbit.enablePan = false;
    this.orbit.enableZoom = true;
    this.orbit.zoomSpeed = 1.2;

    this.mode = 'orbit';
    this.followTarget = null;
    this.impactTarget = null;
    this.transitionSpeed = 3;
    this._transitioning = false;
    this._targetPos = null;
    this._targetCamPos = null;
  }

  focusOn(position, instant = false) {
    const target = position.clone();
    const camPos = new THREE.Vector3(
      position.x - ORBIT_DISTANCE * 0.5,
      position.y + ORBIT_HEIGHT,
      position.z + ORBIT_DISTANCE
    );

    if (instant) {
      this.orbit.target.copy(target);
      this.camera.position.copy(camPos);
      this.orbit.update();
      this._transitioning = false;
    } else {
      this._targetPos = target;
      this._targetCamPos = camPos;
      this._transitioning = true;
    }
  }

  startFollow(projectile) {
    this.mode = 'follow';
    this.followTarget = projectile;
    this.orbit.enabled = false;
    this._transitioning = false;
  }

  showImpact(position) {
    this.mode = 'impact';
    this.impactTarget = position.clone();
    this.orbit.enabled = false;
  }

  returnToOrbit(tankPosition, instant = false) {
    this.mode = 'orbit';
    this.orbit.enabled = true;
    this.followTarget = null;
    this.impactTarget = null;
    this.focusOn(tankPosition, instant);
  }

  update(dt) {
    if (this.mode === 'follow' && this.followTarget) {
      const target = this.followTarget.pos || this.followTarget;

      let camOffset;
      if (this.followTarget.vel) {
        const vel = this.followTarget.vel;
        const hLen = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
        if (hLen > 0.1) {
          const dir = new THREE.Vector3(-vel.x / hLen, 0, -vel.z / hLen);
          camOffset = dir.multiplyScalar(18).add(new THREE.Vector3(0, 10, 0));
        } else {
          camOffset = new THREE.Vector3(0, 15, 18);
        }
      } else {
        camOffset = new THREE.Vector3(0, 15, 18);
      }
      const desiredPos = target.clone().add(camOffset);

      this.camera.position.lerp(desiredPos, dt * this.transitionSpeed);
      this.orbit.target.lerp(target, dt * this.transitionSpeed);
      this.orbit.update();
    } else if (this.mode === 'impact' && this.impactTarget) {
      this.orbit.target.lerp(this.impactTarget, dt * 3);
      this.orbit.update();
    } else {
      if (this._transitioning && this._targetPos && this._targetCamPos) {
        this.orbit.target.lerp(this._targetPos, dt * 4);
        this.camera.position.lerp(this._targetCamPos, dt * 4);
        if (this.orbit.target.distanceTo(this._targetPos) < 0.3) {
          this._transitioning = false;
        }
      }
      this.orbit.update();
    }
  }

  dispose() {
    this.orbit.dispose();
  }
}
