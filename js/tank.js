import * as THREE from 'three';
import { clamp, degToRad } from './utils.js';
import { WEAPONS } from './weapons.js';

const TANK_COLORS = [
  { body: 0x1565c0, turret: 0x1e88e5, accent: 0x42a5f5 },
  { body: 0xc62828, turret: 0xe53935, accent: 0xef5350 },
];

export class Tank {
  constructor(scene, terrain, playerIndex) {
    this.scene = scene;
    this.terrain = terrain;
    this.playerIndex = playerIndex;
    this.colors = TANK_COLORS[playerIndex];

    this.health = 100;
    this.maxHealth = 100;
    this.alive = true;

    this.turretAngle = playerIndex === 0 ? 0 : Math.PI;
    this.barrelElevation = degToRad(45);
    this.power = 50;
    this.fuel = 100;
    this.maxFuel = 100;

    this.burnDamagePerTick = 0;
    this.burnTicksRemaining = 0;

    this.weaponInventory = WEAPONS.map(w => ({
      ...w,
      currentAmmo: w.ammo,
    }));
    this.selectedWeaponIndex = 0;

    this.group = new THREE.Group();
    this.turretGroup = new THREE.Group();
    this.barrelGroup = new THREE.Group();
    this.buildModel();
    scene.add(this.group);
  }

  buildModel() {
    const c = this.colors;

    // Hull
    const hullGeo = new THREE.BoxGeometry(3.5, 1.2, 5);
    const hullMat = new THREE.MeshLambertMaterial({ color: c.body });
    const hull = new THREE.Mesh(hullGeo, hullMat);
    hull.castShadow = true;
    hull.position.y = 0.8;
    this.group.add(hull);

    // Tracks
    const trackGeo = new THREE.BoxGeometry(0.6, 1.0, 5.2);
    const trackMat = new THREE.MeshLambertMaterial({ color: 0x333333 });
    const trackL = new THREE.Mesh(trackGeo, trackMat);
    trackL.position.set(-1.8, 0.5, 0);
    trackL.castShadow = true;
    this.group.add(trackL);
    const trackR = trackL.clone();
    trackR.position.x = 1.8;
    this.group.add(trackR);

    // Track wheels
    const wheelGeo = new THREE.CylinderGeometry(0.4, 0.4, 0.5, 8);
    const wheelMat = new THREE.MeshLambertMaterial({ color: 0x444444 });
    for (const side of [-1.8, 1.8]) {
      for (const z of [-1.8, 0, 1.8]) {
        const wheel = new THREE.Mesh(wheelGeo, wheelMat);
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(side, 0.4, z);
        this.group.add(wheel);
      }
    }

    // Turret
    const turretGeo = new THREE.BoxGeometry(2.2, 1.0, 2.5);
    const turretMat = new THREE.MeshLambertMaterial({ color: c.turret });
    const turret = new THREE.Mesh(turretGeo, turretMat);
    turret.castShadow = true;
    turret.position.y = 0.5;
    this.turretGroup.add(turret);

    // Turret hatch
    const hatchGeo = new THREE.CylinderGeometry(0.4, 0.4, 0.3, 8);
    const hatchMat = new THREE.MeshLambertMaterial({ color: c.accent });
    const hatch = new THREE.Mesh(hatchGeo, hatchMat);
    hatch.position.set(0, 1.0, -0.3);
    this.turretGroup.add(hatch);

    this.turretGroup.position.y = 1.4;
    this.group.add(this.turretGroup);

    // Barrel
    const barrelGeo = new THREE.CylinderGeometry(0.15, 0.2, 4, 8);
    const barrelMat = new THREE.MeshLambertMaterial({ color: 0x555555 });
    const barrel = new THREE.Mesh(barrelGeo, barrelMat);
    barrel.castShadow = true;
    barrel.position.y = 2;
    this.barrelGroup.add(barrel);

    // Muzzle
    const muzzleGeo = new THREE.CylinderGeometry(0.25, 0.15, 0.4, 8);
    const muzzleMat = new THREE.MeshLambertMaterial({ color: 0x666666 });
    const muzzle = new THREE.Mesh(muzzleGeo, muzzleMat);
    muzzle.position.y = 4.1;
    this.barrelGroup.add(muzzle);

    this.barrelGroup.position.set(0, 0.5, 0);
    this.turretGroup.add(this.barrelGroup);

    this.updateTurretRotation();
  }

  setPosition(x, z) {
    const y = this.terrain.getHeight(x, z);
    this.group.position.set(x, y, z);

    // Align tank to terrain slope
    const n = this.terrain.getNormal(x, z);
    const up = new THREE.Vector3(0, 1, 0);
    const q = new THREE.Quaternion().setFromUnitVectors(up, n);
    // Only apply partial slope alignment for stability
    const identity = new THREE.Quaternion();
    identity.slerp(q, 0.6);
    this.group.quaternion.copy(identity);
  }

  get position() {
    return this.group.position;
  }

  get muzzleWorldPosition() {
    const tip = new THREE.Vector3(0, 4.2, 0);
    this.barrelGroup.localToWorld(tip);
    return tip;
  }

  getFireDirection() {
    const dir = new THREE.Vector3(0, 1, 0);
    dir.applyQuaternion(this.barrelGroup.quaternion);
    dir.applyQuaternion(this.turretGroup.quaternion);
    return dir.normalize();
  }

  getFireVelocity() {
    const speed = (this.power / 100) * 60;
    const cosEl = Math.cos(this.barrelElevation);
    const sinEl = Math.sin(this.barrelElevation);
    const vx = speed * cosEl * Math.sin(this.turretAngle);
    const vy = speed * sinEl;
    const vz = speed * cosEl * Math.cos(this.turretAngle);
    return new THREE.Vector3(vx, vy, vz);
  }

  updateTurretRotation() {
    this.turretGroup.rotation.y = this.turretAngle;
    this.barrelGroup.rotation.x = -(Math.PI / 2 - this.barrelElevation);
  }

  rotateTurret(delta) {
    this.turretAngle += delta;
    this.updateTurretRotation();
  }

  adjustElevation(delta) {
    this.barrelElevation = clamp(this.barrelElevation + delta, degToRad(5), degToRad(85));
    this.updateTurretRotation();
  }

  adjustPower(delta) {
    this.power = clamp(this.power + delta, 5, 100);
  }

  move(direction) {
    if (this.fuel <= 0) return;
    const moveSpeed = 0.5;
    const cost = 2;

    const facing = this.turretAngle;
    const dx = Math.sin(facing) * direction * moveSpeed;
    const dz = Math.cos(facing) * direction * moveSpeed;

    const newX = this.group.position.x + dx;
    const newZ = this.group.position.z + dz;

    if (!this.terrain.isOutOfBounds(newX, newZ)) {
      this.setPosition(newX, newZ);
      this.fuel = Math.max(0, this.fuel - cost);
    }
  }

  resetFuel() {
    this.fuel = this.maxFuel;
  }

  cycleWeapon(dir = 1) {
    const available = this.weaponInventory;
    let idx = this.selectedWeaponIndex;
    for (let i = 0; i < available.length; i++) {
      idx = (idx + dir + available.length) % available.length;
      if (available[idx].currentAmmo > 0) {
        this.selectedWeaponIndex = idx;
        return;
      }
    }
  }

  get currentWeapon() {
    return this.weaponInventory[this.selectedWeaponIndex];
  }

  useAmmo() {
    const w = this.currentWeapon;
    if (w.currentAmmo !== Infinity) {
      w.currentAmmo--;
      if (w.currentAmmo <= 0) {
        this.cycleWeapon(1);
      }
    }
  }

  takeDamage(amount) {
    this.health = Math.max(0, this.health - amount);
    if (this.health <= 0) {
      this.alive = false;
    }
    return this.health;
  }

  applyBurnDamage() {
    if (this.burnTicksRemaining > 0) {
      this.takeDamage(this.burnDamagePerTick);
      this.burnTicksRemaining--;
      return this.burnDamagePerTick;
    }
    return 0;
  }

  setOnFire(damagePerTick, ticks) {
    this.burnDamagePerTick = damagePerTick;
    this.burnTicksRemaining = ticks;
  }

  destroy() {
    this.scene.remove(this.group);
  }
}
