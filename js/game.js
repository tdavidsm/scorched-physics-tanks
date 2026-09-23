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
    this.ui.btnSideView.addEventListener('click', () => {
      if (this.state === STATES.AIM && !this.sideView.active) {
        this.sideView.show(this.currentTank, this.terrain, this.wind);
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
    const speed = randRange(0, 15);
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
    this.cameraCtrl.returnToOrbit(this.currentTank.position, instant);

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
      const damages = this.explosions.createExplosion(
        result.position,
        result.weapon,
        this.terrain,
        this.tanks
      );
      this.cameraCtrl.showImpact(result.position);
      this.ui.updateHealth(this.tanks);
    } else if (result.type === 'split') {
      this.activeProjectiles = result.submunitions;
      return;
    }
    // 'miss' just ends the turn
  }

  gameOver(winnerIndex) {
    this.state = STATES.GAME_OVER;
    this.ui.hideHud();
    this.ui.showGameOver(winnerIndex);
  }

  handleInput(dt) {
    if (this.state !== STATES.AIM) return;
    const tank = this.currentTank;
    const aimSpeed = degToRad(60) * dt;
    const powerSpeed = 40 * dt;

    if (this.keys['KeyA']) tank.rotateTurret(aimSpeed);
    if (this.keys['KeyD']) tank.rotateTurret(-aimSpeed);
    if (this.keys['KeyW']) tank.adjustElevation(aimSpeed * 0.6);
    if (this.keys['KeyS']) tank.adjustElevation(-aimSpeed * 0.6);
    if (this.keys['KeyQ']) tank.adjustPower(-powerSpeed);
    if (this.keys['KeyE']) tank.adjustPower(powerSpeed);
    if (this.keys['ArrowLeft']) tank.move(1);
    if (this.keys['ArrowRight']) tank.move(-1);

    this.ui.updateAim(tank);
    this.ui.updateFuel(tank);
  }

  update(dt) {
    this.cameraCtrl.update(dt);
    this.explosions.update(dt);
    this.sideView.update(dt);

    if (this.state === STATES.AIM || this.state === STATES.TURN_START) {
      this.handleInput(dt);
    }

    if (this.state === STATES.FIRING) {
      let allDone = true;
      for (let i = this.activeProjectiles.length - 1; i >= 0; i--) {
        const proj = this.activeProjectiles[i];
        if (!proj.alive) continue;
        allDone = false;
        const result = proj.update(dt);
        if (result) {
          this.handleImpact(result);
          this.activeProjectiles.splice(i, 1);
          // Check if split created new projectiles
          if (result.type === 'split') {
            allDone = false;
          }
        }
      }

      if (allDone && !this.explosions.active) {
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
        this.wind.x += randRange(-2, 2);
        this.wind.z += randRange(-2, 2);
        this.startTurn();
      }
    }
  }
}
