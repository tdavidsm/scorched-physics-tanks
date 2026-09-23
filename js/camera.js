import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { lerp } from './utils.js';

export class CameraController {
  constructor(camera, canvas) {
    this.camera = camera;
    this.canvas = canvas;

    this.orbit = new OrbitControls(camera, canvas);
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = 0.08;
    this.orbit.maxPolarAngle = Math.PI * 0.48;
    this.orbit.minDistance = 10;
    this.orbit.maxDistance = 120;
    this.orbit.enablePan = false;

    this.mode = 'orbit'; // 'orbit', 'follow', 'impact'
    this.followTarget = null;
    this.impactTarget = null;
    this.transitionSpeed = 3;
  }

  focusOn(position, instant = false) {
    if (instant) {
      this.orbit.target.copy(position);
      this.camera.position.set(
        position.x - 20,
        position.y + 25,
        position.z + 30
      );
      this.orbit.update();
    } else {
      this._targetPos = position.clone();
      this._transitioning = true;
    }
  }

  startFollow(projectile) {
    this.mode = 'follow';
    this.followTarget = projectile;
    this.orbit.enabled = false;
  }

  showImpact(position) {
    this.mode = 'impact';
    this.impactTarget = position.clone();
    this.orbit.enabled = false;
  }

  returnToOrbit(tankPosition) {
    this.mode = 'orbit';
    this.orbit.enabled = true;
    this.followTarget = null;
    this.impactTarget = null;
    this.focusOn(tankPosition);
  }

  update(dt) {
    if (this.mode === 'follow' && this.followTarget) {
      const target = this.followTarget.pos || this.followTarget;

      // Position camera behind and above the projectile
      let camOffset;
      if (this.followTarget.vel) {
        const vel = this.followTarget.vel;
        const dir = new THREE.Vector3(vel.x, 0, vel.z).normalize();
        camOffset = dir.multiplyScalar(-15).add(new THREE.Vector3(0, 10, 0));
      } else {
        camOffset = new THREE.Vector3(-10, 10, 10);
      }
      const desiredPos = target.clone().add(camOffset);

      this.camera.position.lerp(desiredPos, dt * this.transitionSpeed);
      this.orbit.target.lerp(target, dt * this.transitionSpeed);
      this.orbit.update();
    } else if (this.mode === 'impact' && this.impactTarget) {
      this.orbit.target.lerp(this.impactTarget, dt * 3);
      this.orbit.update();
    } else {
      if (this._transitioning && this._targetPos) {
        this.orbit.target.lerp(this._targetPos, dt * 3);
        if (this.orbit.target.distanceTo(this._targetPos) < 0.5) {
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
