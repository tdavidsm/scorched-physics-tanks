import * as THREE from 'three';
import { Terrain } from './terrain.js';
import { Tank } from './tank.js';
import { Projectile } from './projectile.js';
import { ExplosionManager } from './explosion.js';
import { CameraController } from './camera.js';
import { SideView } from './sideview.js';
import { UI } from './ui.js';
import { randRange, degToRad } from './utils.js';

const STATES = {
  MENU: 'menu',
  TURN_START: 'turn_start',
  AIM: 'aim',
  FIRING: 'firing',
  IMPACT: 'impact',
  GAME_OVER: 'game_over',
};

export class Game {
  constructor(renderer, scene, camera, canvas) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.canvas = canvas;

    this.state = STATES.MENU;
    this.currentPlayer = 0;
    this.turn = 0;

    this.terrain = null;
    this.tanks = [];
    this.projectile = null;
    this.activeProjectiles = [];
    this.explosions = new ExplosionManager(scene);
    this.cameraCtrl = new CameraController(camera, canvas);
    this.sideView = new SideView();
    this.ui = new UI();

    this.wind = { x: 0, z: 0 };
    this.keys = {};
    this.impactTimer = 0;
    this.napalmFlow = null;
    this.joystick = { dx: 0, dz: 0, active: false };

    this.setupScene();
    this.setupInput();
    this.ui.showStart();
  }

  setupScene() {
    this.scene.background = new THREE.Color(0x87ceeb);
    this.scene.fog = new THREE.Fog(0x87ceeb, 80, 200);

    // Lighting
    const ambient = new THREE.AmbientLight(0x6688aa, 0.6);
    this.scene.add(ambient);

    const sun = new THREE.DirectionalLight(0xfff5e0, 1.2);
    sun.position.set(40, 60, 30);
    sun.castShadow = true;
    sun.shadow.mapSize.width = 2048;
    sun.shadow.mapSize.height = 2048;
    sun.shadow.camera.left = -100;
    sun.shadow.camera.right = 100;
    sun.shadow.camera.top = 100;
    sun.shadow.camera.bottom = -100;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 200;
    this.scene.add(sun);

    // Water plane
    const waterGeo = new THREE.PlaneGeometry(300, 300);
    const waterMat = new THREE.MeshLambertMaterial({
      color: 0x2196f3,
      transparent: true,
      opacity: 0.6,
    });
    const water = new THREE.Mesh(waterGeo, waterMat);
    water.rotation.x = -Math.PI / 2;
    water.position.y = -0.5;
    this.scene.add(water);
  }

  setupInput() {
    window.addEventListener('keydown', (e) => {
      this.keys[e.code] = true;
      if (e.code === 'Tab') {
        e.preventDefault();
        if (this.state === STATES.AIM) {
          this.currentTank.cycleWeapon(e.shiftKey ? -1 : 1);
          this.ui.updateWeapon(this.currentTank);
        }
      }
      if (e.code === 'Enter' && this.state === STATES.AIM) {
        this.fire();
      }
      if (e.code === 'Space') {
        e.preventDefault();
        if (this.state === STATES.AIM && !this.sideView.active) {
          this.sideView.show(this.currentTank, this.terrain, this.wind);
        }
      }
    });
    window.addEventListener('keyup', (e) => {
      this.keys[e.code] = false;
    });

    this.ui.btnStart.addEventListener('click', () => this.startGame());
    this.ui.btnRestart.addEventListener('click', () => this.startGame());

    this.setupTouchControls();
  }

  setupTouchControls() {
    const holdButtons = document.querySelectorAll('[data-key]');
    for (const btn of holdButtons) {
      const key = btn.dataset.key;
      const onDown = (e) => {
        e.preventDefault();
        this.keys[key] = true;
        btn.classList.add('pressed');
      };
      const onUp = (e) => {
        e.preventDefault();
        this.keys[key] = false;
        btn.classList.remove('pressed');
      };
      btn.addEventListener('touchstart', onDown, { passive: false });
      btn.addEventListener('touchend', onUp, { passive: false });
      btn.addEventListener('touchcancel', onUp, { passive: false });
      btn.addEventListener('mousedown', onDown);
      btn.addEventListener('mouseup', onUp);
      btn.addEventListener('mouseleave', onUp);
    }

    document.getElementById('btnFire').addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (this.state === STATES.AIM) this.fire();
    }, { passive: false });
    document.getElementById('btnFire').addEventListener('click', () => {
      if (this.state === STATES.AIM) this.fire();
    });

    document.getElementById('btnWeaponNext').addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (this.state === STATES.AIM) {
        this.currentTank.cycleWeapon(1);
        this.ui.updateWeapon(this.currentTank);
      }
    }, { passive: false });
    document.getElementById('btnWeaponNext').addEventListener('click', () => {
      if (this.state === STATES.AIM) {
        this.currentTank.cycleWeapon(1);
        this.ui.updateWeapon(this.currentTank);
      }
    });

    document.getElementById('btnWeaponPrev').addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (this.state === STATES.AIM) {
        this.currentTank.cycleWeapon(-1);
        this.ui.updateWeapon(this.currentTank);
      }
    }, { passive: false });
    document.getElementById('btnWeaponPrev').addEventListener('click', () => {
      if (this.state === STATES.AIM) {
        this.currentTank.cycleWeapon(-1);
        this.ui.updateWeapon(this.currentTank);
      }
    });

    const sideViewBtn = document.getElementById('btnSideView');
    const showSideView = (e) => {
      if (e) e.preventDefault();
      if (this.state === STATES.AIM && !this.sideView.active) {
        this.sideView.show(this.currentTank, this.terrain, this.wind);
      }
    };
    sideViewBtn.addEventListener('touchstart', showSideView, { passive: false });
    sideViewBtn.addEventListener('click', showSideView);

    this.setupJoystick();
  }

  setupJoystick() {
    const base = document.getElementById('joystickBase');
    const knob = document.getElementById('joystickKnob');
    const maxDist = 30;
    let touchId = null;
    let centerX = 0;
    let centerY = 0;

    const getCenter = () => {
      const rect = base.getBoundingClientRect();
      centerX = rect.left + rect.width / 2;
      centerY = rect.top + rect.height / 2;
    };

    const updateKnob = (clientX, clientY) => {
      let offX = clientX - centerX;
      let offY = clientY - centerY;
      const dist = Math.sqrt(offX * offX + offY * offY);
      const clamped = Math.min(dist, maxDist);
      if (dist > 0) {
        offX = (offX / dist) * clamped;
        offY = (offY / dist) * clamped;
      }
      knob.style.transform = `translate(calc(-50% + ${offX}px), calc(-50% + ${offY}px))`;
      knob.classList.add('active');

      const magnitude = clamped / maxDist;
      if (dist > 0) {
        this.joystick.dx = (offX / clamped) * magnitude;
        this.joystick.dz = (offY / clamped) * magnitude;
      } else {
        this.joystick.dx = 0;
        this.joystick.dz = 0;
      }
      this.joystick.active = magnitude > 0.1;
    };

    const resetKnob = () => {
      knob.style.transform = 'translate(-50%, -50%)';
      knob.classList.remove('active');
      this.joystick.dx = 0;
      this.joystick.dz = 0;
      this.joystick.active = false;
      touchId = null;
    };

    base.addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (touchId !== null) return;
      const touch = e.changedTouches[0];
      touchId = touch.identifier;
      getCenter();
      updateKnob(touch.clientX, touch.clientY);
    }, { passive: false });

    window.addEventListener('touchmove', (e) => {
      if (touchId === null) return;
      for (const touch of e.changedTouches) {
        if (touch.identifier === touchId) {
          e.preventDefault();
          updateKnob(touch.clientX, touch.clientY);
          break;
        }
      }
    }, { passive: false });

    window.addEventListener('touchend', (e) => {
      for (const touch of e.changedTouches) {
        if (touch.identifier === touchId) {
          resetKnob();
          break;
        }
      }
    });

    window.addEventListener('touchcancel', (e) => {
      for (const touch of e.changedTouches) {
        if (touch.identifier === touchId) {
          resetKnob();
          break;
        }
      }
    });

    // Mouse fallback
    let mouseDown = false;
    base.addEventListener('mousedown', (e) => {
      mouseDown = true;
      getCenter();
      updateKnob(e.clientX, e.clientY);
    });
    window.addEventListener('mousemove', (e) => {
      if (!mouseDown) return;
      updateKnob(e.clientX, e.clientY);
    });
    window.addEventListener('mouseup', () => {
      if (mouseDown) {
        mouseDown = false;
        resetKnob();
      }
    });
  }

  startGame() {
    // Clean up previous game
    if (this.terrain) {
      this.scene.remove(this.terrain.mesh);
    }
    for (const t of this.tanks) {
      t.destroy();
    }
    this.tanks = [];
    this.activeProjectiles = [];

    this.ui.hideStart();
    this.ui.hideGameOver();
    this.ui.showHud();

    // Generate terrain
    this.terrain = new Terrain(this.scene);

    // Place tanks at offset z positions for distinct terrain views
    const t1 = new Tank(this.scene, this.terrain, 0);
    t1.setPosition(-70, randRange(-20, 20));
    t1.turretAngle = Math.PI / 2;
    t1.updateTurretRotation();

    const t2 = new Tank(this.scene, this.terrain, 1);
    t2.setPosition(70, randRange(-20, 20));
    t2.turretAngle = -Math.PI / 2;
    t2.updateTurretRotation();

    this.tanks = [t1, t2];

    // Set wind
    this.randomizeWind();

    // Start first turn — instant camera snap on game start
    this.currentPlayer = 0;
    this.turn = 0;
    this.firstTurn = true;
    this.startTurn();
  }

  get currentTank() {
    return this.tanks[this.currentPlayer];
  }

  get otherTank() {
    return this.tanks[1 - this.currentPlayer];
  }

  randomizeWind() {
    const angle = Math.random() * Math.PI * 2;
    const speed = randRange(0, 3);
    this.wind = {
      x: Math.cos(angle) * speed,
      z: Math.sin(angle) * speed,
    };
  }

  startTurn() {
    this.state = STATES.TURN_START;
    this.turn++;
    this.currentTank.resetFuel();
    this.ui.showTurnBanner(this.currentPlayer);
    this.ui.updateAll(this.currentTank, this.tanks, this.wind);
    const instant = this.firstTurn || false;
    this.firstTurn = false;
    const mid = this.tanks[0].position.clone().add(this.tanks[1].position).multiplyScalar(0.5);
    this.cameraCtrl.returnToOrbit(mid, instant);

    // Apply burn damage
    const burnDmg = this.currentTank.applyBurnDamage();
    if (burnDmg > 0) {
      this.ui.updateHealth(this.tanks);
      if (!this.currentTank.alive) {
        this.gameOver(1 - this.currentPlayer);
        return;
      }
    }

    setTimeout(() => {
      if (this.state === STATES.TURN_START) {
        this.state = STATES.AIM;
      }
    }, 1600);
  }

  fire() {
    if (this.state !== STATES.AIM) return;
    this.sideView.hide();

    const tank = this.currentTank;
    const weapon = tank.currentWeapon;
    if (weapon.currentAmmo <= 0) return;

    tank.useAmmo();
    this.state = STATES.FIRING;

    const startPos = tank.muzzleWorldPosition;
    const velocity = tank.getFireVelocity();

    const projectile = new Projectile(
      this.scene,
      startPos,
      velocity,
      weapon,
      this.wind,
      this.terrain,
      this.tanks
    );
    this.activeProjectiles = [projectile];
    this.cameraCtrl.startFollow(projectile);
  }

  handleImpact(result) {
    if (result.type === 'impact') {
      if (result.weapon.behavior === 'napalm') {
        this.startNapalmFlow(result.position, result.weapon);
        return;
      }
      this.explosions.createExplosion(
        result.position,
        result.weapon,
        this.terrain,
        this.tanks
      );
      this.cameraCtrl.showImpact(result.position);
      this.ui.updateHealth(this.tanks);
    }
  }

  startNapalmFlow(position, weapon) {
    this.cameraCtrl.showImpact(position);
    const DROPLET_COUNT = 40;
    const droplets = [];
    for (let i = 0; i < DROPLET_COUNT; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 2 + Math.random() * 6;
      droplets.push({
        x: position.x,
        y: position.y + 1,
        z: position.z,
        vx: Math.cos(angle) * speed,
        vy: 3 + Math.random() * 5,
        vz: Math.sin(angle) * speed,
        grounded: false,
        settled: false,
      });
    }

    const geo = new THREE.BufferGeometry();
    const posArr = new Float32Array(DROPLET_COUNT * 3);
    const colors = new Float32Array(DROPLET_COUNT * 3);
    for (let i = 0; i < DROPLET_COUNT; i++) {
      posArr[i * 3] = position.x;
      posArr[i * 3 + 1] = position.y;
      posArr[i * 3 + 2] = position.z;
      colors[i * 3] = 1.0;
      colors[i * 3 + 1] = 0.4 + Math.random() * 0.2;
      colors[i * 3 + 2] = 0;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const mat = new THREE.PointsMaterial({
      size: 1.5,
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      sizeAttenuation: true,
    });
    const points = new THREE.Points(geo, mat);
    this.scene.add(points);

    this.napalmFlow = {
      droplets,
      points,
      geo,
      mat,
      posArr,
      weapon,
      phase: 'flow',
      flowTime: 0,
      flowDuration: 2.5,
      burnTime: 0,
      burnDuration: 2.0,
      fireVisuals: [],
    };
  }

  updateNapalmFlow(dt) {
    const nf = this.napalmFlow;
    if (!nf) return;

    if (nf.phase === 'flow') {
      nf.flowTime += dt;
      let allSettled = true;

      for (let i = 0; i < nf.droplets.length; i++) {
        const d = nf.droplets[i];
        if (d.settled) continue;

        if (!d.grounded) {
          d.vy -= 9.81 * dt;
          d.x += d.vx * dt;
          d.y += d.vy * dt;
          d.z += d.vz * dt;
          if (!this.terrain.isOutOfBounds(d.x, d.z)) {
            const gh = this.terrain.getHeight(d.x, d.z);
            if (d.y <= gh) {
              d.y = gh;
              d.grounded = true;
              d.vy = 0;
            }
          }
          allSettled = false;
        } else {
          const n = this.terrain.getNormal(d.x, d.z);
          const slopeX = -n.x / n.y;
          const slopeZ = -n.z / n.y;
          const slopeMag = Math.sqrt(slopeX * slopeX + slopeZ * slopeZ);

          if (slopeMag > 0.02) {
            const flowSpeed = slopeMag * 18;
            d.vx = d.vx * 0.9 + slopeX / slopeMag * flowSpeed * 0.1;
            d.vz = d.vz * 0.9 + slopeZ / slopeMag * flowSpeed * 0.1;
            const mag = Math.sqrt(d.vx * d.vx + d.vz * d.vz);
            const maxSpeed = 15;
            if (mag > maxSpeed) {
              d.vx *= maxSpeed / mag;
              d.vz *= maxSpeed / mag;
            }
            d.x += d.vx * dt;
            d.z += d.vz * dt;
            if (!this.terrain.isOutOfBounds(d.x, d.z)) {
              d.y = this.terrain.getHeight(d.x, d.z);
            }
            allSettled = false;
          } else {
            d.vx *= 0.85;
            d.vz *= 0.85;
            if (Math.abs(d.vx) + Math.abs(d.vz) < 0.3) {
              d.settled = true;
            } else {
              d.x += d.vx * dt;
              d.z += d.vz * dt;
              if (!this.terrain.isOutOfBounds(d.x, d.z)) {
                d.y = this.terrain.getHeight(d.x, d.z);
              }
              allSettled = false;
            }
          }
        }

        nf.posArr[i * 3] = d.x;
        nf.posArr[i * 3 + 1] = d.y + 0.2;
        nf.posArr[i * 3 + 2] = d.z;
      }
      nf.geo.attributes.position.needsUpdate = true;

      if (allSettled || nf.flowTime > nf.flowDuration) {
        nf.phase = 'ignite';
        this.igniteNapalm(nf);
      }
    } else if (nf.phase === 'ignite') {
      nf.burnTime += dt;
      const t = nf.burnTime / nf.burnDuration;

      for (const fv of nf.fireVisuals) {
        const flicker = 0.8 + Math.random() * 0.4;
        const scaleY = (1 - t * 0.5) * flicker;
        fv.mesh.scale.set(1, Math.max(0.1, scaleY), 1);
        fv.mat.opacity = Math.max(0, (1 - t) * 0.7);
        fv.light.intensity = Math.max(0, (1 - t) * 8 * flicker);
      }
      nf.mat.opacity = Math.max(0, 0.9 - t);

      if (nf.burnTime > nf.burnDuration) {
        this.cleanupNapalm(nf);
        this.napalmFlow = null;
      }
    }
  }

  igniteNapalm(nf) {
    const clusterRadius = 3;
    const clusters = [];

    for (const d of nf.droplets) {
      let added = false;
      for (const c of clusters) {
        const dx = d.x - c.x;
        const dz = d.z - c.z;
        if (dx * dx + dz * dz < clusterRadius * clusterRadius) {
          c.x = (c.x * c.count + d.x) / (c.count + 1);
          c.z = (c.z * c.count + d.z) / (c.count + 1);
          c.count++;
          added = true;
          break;
        }
      }
      if (!added) {
        clusters.push({ x: d.x, z: d.z, count: 1 });
      }
    }

    for (const c of clusters) {
      const intensity = Math.min(c.count / 5, 1);
      const radius = nf.weapon.blastRadius * (0.3 + intensity * 0.7);
      const y = this.terrain.getHeight(c.x, c.z);

      const fireGeo = new THREE.ConeGeometry(radius * 0.5, radius * 1.2, 8);
      const fireMat = new THREE.MeshBasicMaterial({
        color: 0xff4400,
        transparent: true,
        opacity: 0.7,
      });
      const fire = new THREE.Mesh(fireGeo, fireMat);
      fire.position.set(c.x, y + radius * 0.6, c.z);
      this.scene.add(fire);

      const light = new THREE.PointLight(0xff6600, 8, radius * 4);
      light.position.set(c.x, y + 2, c.z);
      this.scene.add(light);

      nf.fireVisuals.push({ mesh: fire, geo: fireGeo, mat: fireMat, light });

      for (const tank of this.tanks) {
        if (!tank.alive) continue;
        const dist = Math.sqrt(
          (tank.position.x - c.x) ** 2 + (tank.position.z - c.z) ** 2
        );
        if (dist < radius) {
          const falloff = 1 - dist / radius;
          tank.takeDamage(Math.round(nf.weapon.damage * falloff * intensity));
          tank.setOnFire(nf.weapon.burnDamage, nf.weapon.burnTicks);
        }
      }
    }

    this.ui.updateHealth(this.tanks);
  }

  cleanupNapalm(nf) {
    this.scene.remove(nf.points);
    nf.geo.dispose();
    nf.mat.dispose();
    for (const fv of nf.fireVisuals) {
      this.scene.remove(fv.mesh);
      this.scene.remove(fv.light);
      fv.geo.dispose();
      fv.mat.dispose();
    }
  }

  gameOver(winnerIndex) {
    this.state = STATES.GAME_OVER;
    this.ui.hideHud();
    this.ui.showGameOver(winnerIndex);
  }

  handleInput(dt) {
    if (this.state !== STATES.AIM) return;
    const tank = this.currentTank;
    const aimSpeed = degToRad(25) * dt;
    const powerSpeed = 15 * dt;

    if (this.keys['KeyA']) tank.rotateTurret(aimSpeed);
    if (this.keys['KeyD']) tank.rotateTurret(-aimSpeed);
    if (this.keys['KeyW']) tank.adjustElevation(aimSpeed * 0.6);
    if (this.keys['KeyS']) tank.adjustElevation(-aimSpeed * 0.6);
    if (this.keys['KeyQ']) tank.adjustPower(-powerSpeed);
    if (this.keys['KeyE']) tank.adjustPower(powerSpeed);
    if (this.keys['ArrowLeft']) tank.move(1);
    if (this.keys['ArrowRight']) tank.move(-1);

    if (this.joystick.active) {
      const mag = Math.sqrt(this.joystick.dx ** 2 + this.joystick.dz ** 2);
      if (mag > 0.1) {
        tank.moveXZ(this.joystick.dx, this.joystick.dz, mag);
      }
    }

    this.ui.updateAim(tank);
    this.ui.updateFuel(tank);
  }

  update(dt) {
    this.cameraCtrl.update(dt);
    this.explosions.update(dt);
    this.sideView.update(dt);

    for (const tank of this.tanks) {
      tank.update(dt);
    }
    this.updateNapalmFlow(dt);

    if (this.state === STATES.AIM || this.state === STATES.TURN_START) {
      this.handleInput(dt);
    }

    if (this.state === STATES.FIRING) {
      let allDone = true;
      let newProjectiles = [];
      for (let i = this.activeProjectiles.length - 1; i >= 0; i--) {
        const proj = this.activeProjectiles[i];
        if (!proj.alive) continue;
        allDone = false;
        const result = proj.update(dt);
        if (result) {
          if (result.type === 'split') {
            newProjectiles.push(...result.submunitions);
          } else {
            this.handleImpact(result);
          }
          this.activeProjectiles.splice(i, 1);
        }
      }
      if (newProjectiles.length > 0) {
        this.activeProjectiles.push(...newProjectiles);
        allDone = false;
      }

      if (allDone && !this.explosions.active && !this.napalmFlow) {
        this.state = STATES.IMPACT;
        this.impactTimer = 0;
      }
    }

    if (this.state === STATES.IMPACT) {
      this.impactTimer += dt;
      if (this.impactTimer > 1.5) {
        // Check for game over
        for (let i = 0; i < this.tanks.length; i++) {
          if (!this.tanks[i].alive) {
            this.gameOver(1 - i);
            return;
          }
        }
        // Next turn
        this.currentPlayer = 1 - this.currentPlayer;
        // Slight wind variation each turn
        this.wind.x += randRange(-0.5, 0.5);
        this.wind.z += randRange(-0.5, 0.5);
        this.startTurn();
      }
    }
  }
}
