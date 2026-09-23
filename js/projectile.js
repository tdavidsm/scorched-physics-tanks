import * as THREE from 'three';

const GRAVITY = 9.81;
const SIM_DT = 0.02;
const TRAIL_LENGTH = 80;

export class Projectile {
  constructor(scene, startPos, velocity, weapon, wind, terrain, tanks) {
    this.scene = scene;
    this.terrain = terrain;
    this.tanks = tanks;
    this.weapon = weapon;
    this.wind = wind;
    this.alive = true;
    this.finished = false;
    this.time = 0;
    this.bouncesLeft = weapon.behavior === 'bouncer' ? weapon.bounces : 0;
    this.rolling = false;
    this.rollTime = 0;
    this.hasSplit = false;
    this.submunitions = [];

    this.pos = startPos.clone();
    this.vel = velocity.clone();

    // Visual — bright projectile with glow
    const geo = new THREE.SphereGeometry(0.5, 12, 12);
    const mat = new THREE.MeshBasicMaterial({ color: weapon.color });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.copy(this.pos);
    scene.add(this.mesh);

    const glowGeo = new THREE.SphereGeometry(1.2, 8, 8);
    const glowMat = new THREE.MeshBasicMaterial({
      color: weapon.color,
      transparent: true,
      opacity: 0.25,
    });
    this.glow = new THREE.Mesh(glowGeo, glowMat);
    this.mesh.add(this.glow);

    // Trail
    const trailGeo = new THREE.BufferGeometry();
    this.trailPositions = new Float32Array(TRAIL_LENGTH * 3);
    for (let i = 0; i < TRAIL_LENGTH; i++) {
      this.trailPositions[i * 3] = this.pos.x;
      this.trailPositions[i * 3 + 1] = this.pos.y;
      this.trailPositions[i * 3 + 2] = this.pos.z;
    }
    trailGeo.setAttribute('position', new THREE.BufferAttribute(this.trailPositions, 3));
    const trailMat = new THREE.LineBasicMaterial({ color: weapon.color, transparent: true, opacity: 0.6, linewidth: 2 });
    this.trail = new THREE.Line(trailGeo, trailMat);
    scene.add(this.trail);

    this.trailIndex = 0;
  }

  update(dt) {
    if (!this.alive) return null;

    const steps = Math.ceil(dt / SIM_DT);
    const stepDt = dt / steps;

    for (let s = 0; s < steps; s++) {
      this.time += stepDt;

      if (this.rolling) {
        return this.updateRolling(stepDt);
      }

      // Apply gravity and wind
      this.vel.y -= GRAVITY * stepDt;
      this.vel.x += this.wind.x * stepDt;
      this.vel.z += this.wind.z * stepDt;

      this.pos.x += this.vel.x * stepDt;
      this.pos.y += this.vel.y * stepDt;
      this.pos.z += this.vel.z * stepDt;

      // MIRV split at apex
      if (this.weapon.behavior === 'mirv' && !this.hasSplit && this.vel.y < 0) {
        this.hasSplit = true;
        return this.splitMIRV();
      }

      // Check terrain collision
      if (!this.terrain.isOutOfBounds(this.pos.x, this.pos.z)) {
        const groundH = this.terrain.getHeight(this.pos.x, this.pos.z);
        if (this.pos.y <= groundH) {
          this.pos.y = groundH;

          if (this.weapon.behavior === 'bouncer' && this.bouncesLeft > 0) {
            this.bouncesLeft--;
            const normal = this.terrain.getNormal(this.pos.x, this.pos.z);
            const dot = this.vel.dot(normal);
            this.vel.sub(normal.multiplyScalar(2 * dot));
            this.vel.multiplyScalar(this.weapon.bounceFactor);
            continue;
          }

          if (this.weapon.behavior === 'roller' && !this.rolling) {
            this.rolling = true;
            this.rollTime = 0;
            continue;
          }

          if (this.weapon.behavior === 'tunneler') {
            return this.tunnel();
          }

          return this.impact();
        }
      }

      // Check out of bounds (fell off map or too low)
      if (this.pos.y < -20 || this.terrain.isOutOfBounds(this.pos.x, this.pos.z)) {
        this.alive = false;
        this.cleanup();
        return { type: 'miss' };
      }

      // Check tank collision
      for (const tank of this.tanks) {
        if (!tank.alive) continue;
        const dist = this.pos.distanceTo(tank.position);
        if (dist < 2.5) {
          return this.impact();
        }
      }
    }

    // Update visual
    this.mesh.position.copy(this.pos);

    // Update trail
    this.trailPositions[this.trailIndex * 3] = this.pos.x;
    this.trailPositions[this.trailIndex * 3 + 1] = this.pos.y;
    this.trailPositions[this.trailIndex * 3 + 2] = this.pos.z;
    this.trailIndex = (this.trailIndex + 1) % TRAIL_LENGTH;
    this.trail.geometry.attributes.position.needsUpdate = true;

    return null;
  }

  updateRolling(dt) {
    this.rollTime += dt;
    if (this.rollTime > this.weapon.rollDuration) {
      return this.impact();
    }

    const normal = this.terrain.getNormal(this.pos.x, this.pos.z);
    const slopeForce = new THREE.Vector3(normal.x, 0, normal.z).normalize().multiplyScalar(15);
    const speed = 12;

    this.vel.x = this.vel.x * 0.95 + slopeForce.x * dt;
    this.vel.z = this.vel.z * 0.95 + slopeForce.z * dt;
    const mag = Math.sqrt(this.vel.x ** 2 + this.vel.z ** 2);
    if (mag > speed) {
      this.vel.x *= speed / mag;
      this.vel.z *= speed / mag;
    }

    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;

    if (this.terrain.isOutOfBounds(this.pos.x, this.pos.z)) {
      this.alive = false;
      this.cleanup();
      return { type: 'miss' };
    }

    this.pos.y = this.terrain.getHeight(this.pos.x, this.pos.z);
    this.vel.y = 0;

    this.mesh.position.copy(this.pos);
    this.trailPositions[this.trailIndex * 3] = this.pos.x;
    this.trailPositions[this.trailIndex * 3 + 1] = this.pos.y;
    this.trailPositions[this.trailIndex * 3 + 2] = this.pos.z;
    this.trailIndex = (this.trailIndex + 1) % TRAIL_LENGTH;
    this.trail.geometry.attributes.position.needsUpdate = true;

    // Check tank collision while rolling
    for (const tank of this.tanks) {
      if (!tank.alive) continue;
      const dx = this.pos.x - tank.position.x;
      const dz = this.pos.z - tank.position.z;
      if (Math.sqrt(dx * dx + dz * dz) < 3) {
        return this.impact();
      }
    }

    return null;
  }

  splitMIRV() {
    const results = [];
    const count = this.weapon.submunitions;
    const spread = this.weapon.spreadRadius;
    const golden = Math.PI * (3 - Math.sqrt(5));

    for (let i = 0; i < count; i++) {
      const r = spread * Math.sqrt((i + 0.5) / count);
      const angle = i * golden;
      const offsetX = Math.cos(angle) * r * (0.8 + Math.random() * 0.4);
      const offsetZ = Math.sin(angle) * r * (0.8 + Math.random() * 0.4);

      const subVel = new THREE.Vector3(
        this.vel.x * 0.3 + offsetX,
        this.vel.y * 0.2 - 2,
        this.vel.z * 0.3 + offsetZ
      );

      const sub = new Projectile(
        this.scene,
        this.pos.clone(),
        subVel,
        { ...this.weapon, behavior: 'standard', name: 'MIRV Warhead', damage: Math.round(this.weapon.damage * 5 / count) },
        this.wind,
        this.terrain,
        this.tanks
      );
      this.submunitions.push(sub);
    }

    this.alive = false;
    this.cleanup();
    return { type: 'split', submunitions: this.submunitions };
  }

  tunnel() {
    const results = [];
    const dir = this.vel.clone().normalize();
    const length = this.weapon.tunnelLength;
    const steps = 10;

    for (let i = 0; i < steps; i++) {
      const t = (i / steps) * length;
      const x = this.pos.x + dir.x * t;
      const z = this.pos.z + dir.z * t;
      this.terrain.deform(x, z, 3, 4);
    }

    return this.impact();
  }

  impact() {
    this.alive = false;
    const result = {
      type: 'impact',
      position: this.pos.clone(),
      weapon: this.weapon,
      launchAngleDeg: this.launchAngleDeg,
    };
    this.cleanup();
    return result;
  }

  cleanup() {
    this.scene.remove(this.mesh);
    this.scene.remove(this.trail);
    if (this.glow) {
      this.glow.geometry.dispose();
      this.glow.material.dispose();
    }
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.trail.geometry.dispose();
    this.trail.material.dispose();
  }
}

export function predictTrajectory(startPos, velocity, wind, terrain, maxTime = 15) {
  const points = [];
  const pos = startPos.clone();
  const vel = velocity.clone();
  const dt = 0.05;

  for (let t = 0; t < maxTime; t += dt) {
    points.push({ x: pos.x, y: pos.y, z: pos.z, t });

    vel.y -= GRAVITY * dt;
    vel.x += wind.x * dt;
    vel.z += wind.z * dt;

    pos.x += vel.x * dt;
    pos.y += vel.y * dt;
    pos.z += vel.z * dt;

    if (!terrain.isOutOfBounds(pos.x, pos.z)) {
      const groundH = terrain.getHeight(pos.x, pos.z);
      if (pos.y <= groundH) {
        points.push({ x: pos.x, y: groundH, z: pos.z, t });
        break;
      }
    }

    if (pos.y < -20 || terrain.isOutOfBounds(pos.x, pos.z)) {
      break;
    }
  }

  return points;
}
