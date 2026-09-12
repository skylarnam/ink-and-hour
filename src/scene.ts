import * as THREE from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { makeLabelTexture, makeLeatherTexture, makeWoodTexture, randomSource } from './textures.ts';
import { configureCameraDrag, createCameraControls, panCameraWithKey } from './camera-controls.ts';
import { OutdoorView } from './outdoors.ts';
import { inkColor } from './ink.ts';
import { cameraRelativePan } from './spatial-audio.ts';
import type { CameraDragMode } from './camera-controls.ts';
import type { PaperSurface } from './textures.ts';
import { PAGE, PAPER_COLORS, PAPER_FINISH } from './types.ts';
import type { CameraPreset, Mood, PenSample, Settings } from './types.ts';

const PAPER_WIDTH = 3.8;
const PAPER_HEIGHT = PAPER_WIDTH * PAGE.height / PAGE.width;
const PAPER_Y = 0.064;
const CAP_SEAT_Y = 0.87;
const CAP_REVERSE = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI);
const PEN_REST_POSITION = new THREE.Vector3(2.08, 0.16, 1.4);
const PEN_REST_ROTATION = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0.35, 0.07, -0.95).normalize());
const PEN_RETURN_DURATION = 1.8;
const WINDOW_SOUND_POSITION = new THREE.Vector3(0, 3.94, -5.38);

export function writingPenOrientation(): THREE.Quaternion {
  const elevation = THREE.MathUtils.degToRad(42);
  const direction = new THREE.Vector3(0.51, 0, 0.31).normalize().multiplyScalar(Math.cos(elevation));
  direction.y = Math.sin(elevation);
  // Keep the cross-edge level and the nib face upward as the barrel leans.
  const across = new THREE.Vector3(-direction.z, 0, direction.x).normalize();
  const face = across.clone().cross(direction).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(across, direction, face));
}

const PALETTES: Record<Mood, {
  wood: string; wall: string; trim: string; leather: string; pen: string;
  ceramic: string; book: string; foliage: string;
}> = {
  study: {
    wood: '#745039', wall: '#686c5b', trim: '#443d2f', leather: '#733e40',
    pen: '#253a36', ceramic: '#b5ae8d', book: '#7a493d', foliage: '#56684c',
  },
  atelier: {
    wood: '#ded1ae', wall: '#e7e3d5', trim: '#c6b898', leather: '#af7954',
    pen: '#b8c5b6', ceramic: '#ddd9c4', book: '#9ba7a1', foliage: '#708068',
  },
  storybook: {
    wood: '#bfa082', wall: '#aaaabc', trim: '#73677b', leather: '#997781',
    pen: '#795d82', ceramic: '#dcb183', book: '#718d91', foliage: '#859a77',
  },
};

type Standard = THREE.MeshStandardMaterial;

function material(color: THREE.ColorRepresentation, roughness = 0.65, metalness = 0): Standard {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

function mesh(geometry: THREE.BufferGeometry, surface: THREE.Material, parent: THREE.Object3D,
  x = 0, y = 0, z = 0): THREE.Mesh {
  const object = new THREE.Mesh(geometry, surface);
  object.position.set(x, y, z);
  object.castShadow = true;
  object.receiveShadow = true;
  parent.add(object);
  return object;
}

function box(w: number, h: number, d: number, surface: THREE.Material, parent: THREE.Object3D,
  x = 0, y = 0, z = 0, radius = 0.035): THREE.Mesh {
  return mesh(new RoundedBoxGeometry(w, h, d, 2, Math.min(radius, h / 3, w / 3, d / 3)),
    surface, parent, x, y, z);
}

function cylinder(top: number, bottom: number, height: number, surface: THREE.Material,
  parent: THREE.Object3D, x = 0, y = 0, z = 0): THREE.Mesh {
  return mesh(new THREE.CylinderGeometry(top, bottom, height, 40), surface, parent, x, y, z);
}

function tube(points: THREE.Vector3[], radius: number, surface: THREE.Material,
  parent: THREE.Object3D): THREE.Mesh {
  return mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 40, radius, 8, false), surface, parent);
}

function disposeObject(object: THREE.Object3D, retained: ReadonlySet<THREE.Material>): void {
  const materials = new Set<THREE.Material>();
  object.traverse((child) => {
    if (child instanceof THREE.Mesh || child instanceof THREE.Line) {
      child.geometry.dispose();
      for (const surface of Array.isArray(child.material) ? child.material : [child.material]) {
        if (!retained.has(surface)) materials.add(surface);
      }
    }
  });
  for (const surface of materials) surface.dispose();
  object.clear();
}

export class DeskScene {
  private readonly scene = new THREE.Scene();
  private readonly renderer: THREE.WebGLRenderer;
  private readonly camera = new THREE.PerspectiveCamera(39, 1, 0.05, 80);
  private readonly controls: OrbitControls;
  private readonly resizeObserver: ResizeObserver;
  private readonly tableMaterial = material('#745039', 0.48);
  private readonly wallMaterial = material('#686c5b', 0.95);
  private readonly trimMaterial = material('#443d2f', 0.65);
  private readonly leatherMaterial = material('#733e40', 0.87);
  private readonly penMaterial = material('#253a36', 0.19, 0.14);
  private readonly ceramicMaterial = material('#b5ae8d', 0.3);
  private readonly bookMaterial = material('#7a493d', 0.9);
  private readonly leafMaterial = material('#56684c', 0.92);
  private readonly brassMaterial = material('#c7a86b', 0.27, 0.78);
  private readonly steelMaterial = material('#b9bdc1', 0.24, 0.88);
  private readonly inkMaterial = material('#24384d', 0.23);
  private readonly pageEdgeMaterial = material('#ece3d0', 0.95);
  private readonly paperMaterial = new THREE.MeshStandardMaterial({ roughness: 0.76, side: THREE.DoubleSide });
  private readonly shadeMaterial = material('#ead7ae', 0.78);
  private readonly lampBulbMaterial = new THREE.MeshStandardMaterial({ color: '#ffe2a4', emissive: '#ffbe64', emissiveIntensity: 1.5 });
  private readonly outdoors = new OutdoorView();
  private readonly sun = new THREE.DirectionalLight('#ffdfab', 2.4);
  private readonly hemisphere = new THREE.HemisphereLight('#e9dcc9', '#675540', 1.6);
  private readonly lampLight = new THREE.SpotLight('#ffcf85', 18, 12, Math.PI / 3.6, 0.8, 1.4);
  private readonly flashLight = new THREE.PointLight('#cadbff', 0, 14, 1.4);
  private readonly pen = new THREE.Group();
  private readonly nib = new THREE.Group();
  private readonly cap = new THREE.Group();
  private readonly roll = new THREE.Group();
  private readonly rollOpenGroup = new THREE.Group();
  private readonly rollClosedGroup = new THREE.Group();
  private readonly dust: THREE.Points;
  private readonly storyStars = new THREE.Group();
  private readonly allTextures = new Set<THREE.Texture>();
  private readonly raycaster = new THREE.Raycaster();
  private readonly mouse = new THREE.Vector2();
  private readonly pointerStart = new THREE.Vector2();
  private readonly activePointers = new Set<number>();
  private readonly targetPosition = new THREE.Vector3();
  private readonly targetLook = new THREE.Vector3();
  private readonly penOrientation = new THREE.Quaternion();
  private readonly soundListener = new THREE.Vector3();
  private readonly soundRight = new THREE.Vector3();
  private readonly soundPen = new THREE.Vector3();
  private readonly environmentTarget: THREE.WebGLRenderTarget;
  private settings: Settings;
  private movingCamera = false;
  private rollOpen = false;
  private rollAmount = 0;
  private capped = true;
  private capAmount = 1;
  private currentPreset: CameraPreset = 'desk';
  private followNib = false;
  private dragMode: CameraDragMode = 'orbit';
  private pointerMoved = false;
  private pointerActionAllowed = false;
  private nextLightning = 18;
  private lightningRemaining = 0;
  private thunderAt: number | null = null;
  private reducedMotion = false;
  private lastTime = 0;
  private penReturn: { elapsed: number; start: THREE.Vector3; rotation: THREE.Quaternion } | null = null;
  private readonly interaction: (action: 'roll' | 'cap' | 'ink') => void;
  private readonly onThunder: () => void;

  constructor(canvas: HTMLCanvasElement, paper: PaperSurface, settings: Settings,
    interaction: (action: 'roll' | 'cap' | 'ink') => void, onThunder: () => void) {
    this.settings = { ...settings };
    this.interaction = interaction;
    this.onThunder = onThunder;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.scene.background = new THREE.Color('#727364');
    this.scene.fog = new THREE.Fog('#888578', 20, 40);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const environment = new RoomEnvironment();
    this.environmentTarget = pmrem.fromScene(environment, 0.06);
    this.scene.environment = this.environmentTarget.texture;
    this.scene.environmentIntensity = 0.33;
    environment.dispose();
    pmrem.dispose();
    const woodTexture = makeWoodTexture();
    const leatherTexture = makeLeatherTexture();
    this.allTextures.add(woodTexture);
    this.allTextures.add(leatherTexture);
    for (const texture of this.outdoors.textures) this.allTextures.add(texture);
    this.tableMaterial.map = woodTexture;
    this.tableMaterial.bumpMap = woodTexture;
    this.tableMaterial.bumpScale = 0.018;
    this.leatherMaterial.map = leatherTexture;
    this.leatherMaterial.bumpMap = leatherTexture;
    this.leatherMaterial.bumpScale = 0.022;
    this.buildRoom();
    this.buildDesk(paper);
    this.buildLamp();
    this.buildBottle();
    this.buildRoll();
    this.buildProps();
    this.buildPen();
    this.scene.add(this.pen, this.cap);
    this.penOrientation.copy(writingPenOrientation());
    this.pen.quaternion.copy(this.penOrientation);
    this.scene.add(this.hemisphere, this.sun, this.lampLight, this.flashLight);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.left = -9;
    this.sun.shadow.camera.right = 9;
    this.sun.shadow.camera.top = 9;
    this.sun.shadow.camera.bottom = -9;
    this.sun.shadow.normalBias = 0.025;
    this.sun.shadow.bias = -0.0003;
    this.sun.shadow.radius = 3;
    this.sun.target.position.set(0, 0, 0);
    this.scene.add(this.sun.target);
    this.lampLight.position.set(3.1, 3.08, -2.3);
    this.lampLight.target.position.set(0.7, 0, 0);
    this.scene.add(this.lampLight.target);
    this.lampLight.castShadow = true;
    this.lampLight.shadow.mapSize.set(1024, 1024);
    this.lampLight.shadow.normalBias = 0.018;
    this.flashLight.position.set(-1, 4, -4.8);
    const random = randomSource(921);
    const dustPositions = new Float32Array(38 * 3);
    for (let i = 0; i < dustPositions.length; i += 3) {
      dustPositions[i] = random() * 10 - 5;
      dustPositions[i + 1] = random() * 4 + 0.7;
      dustPositions[i + 2] = random() * 6 - 3.6;
    }
    const dustGeometry = new THREE.BufferGeometry();
    dustGeometry.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3));
    this.dust = new THREE.Points(dustGeometry, new THREE.PointsMaterial({
      color: '#ffdfa5', size: 0.019, transparent: true, opacity: 0.35, depthWrite: false,
    }));
    this.scene.add(this.dust);
    this.controls = createCameraControls(this.camera, canvas);
    this.controls.addEventListener('start', () => { this.movingCamera = false; this.followNib = false; });
    canvas.addEventListener('pointerdown', this.pointerDown, { capture: true });
    canvas.addEventListener('pointermove', this.pointerMove);
    canvas.addEventListener('pointerup', this.pointerUp);
    canvas.addEventListener('pointercancel', this.pointerCancel);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement ?? canvas);
    this.resize();
    this.configure(settings);
    this.setCamera('desk', true);
  }

  private buildRoom(): void {
    box(16, 1.65, 0.22, this.wallMaterial, this.scene, 0, 0.83, -5.5);
    box(16, 2.2, 0.22, this.wallMaterial, this.scene, 0, 7.3, -5.5);
    box(4.7, 4.55, 0.22, this.wallMaterial, this.scene, -5.65, 3.92, -5.5);
    box(4.7, 4.55, 0.22, this.wallMaterial, this.scene, 5.65, 3.92, -5.5);
    this.scene.add(this.outdoors.root);
    for (const x of [-3.27, 0, 3.27]) box(x === 0 ? 0.12 : 0.19, 4.65, 0.21, this.trimMaterial, this.scene, x, 3.95, -5.38);
    for (const y of [1.65, 3.94, 6.24]) box(6.7, 0.14, 0.24, this.trimMaterial, this.scene, 0, y, -5.38);
    box(7.08, 0.17, 0.7, this.trimMaterial, this.scene, 0, 1.6, -5.22);
    this.scene.add(this.storyStars);
    const starMaterial = new THREE.MeshStandardMaterial({ color: '#e1c587', emissive: '#c39c60', emissiveIntensity: 0.2, metalness: 0.3 });
    for (let i = 0; i < 5; i++) {
      const x = -2.5 + i * 1.18;
      const length = 0.22 + (i % 3) * 0.16;
      cylinder(0.008, 0.008, length, this.brassMaterial, this.storyStars, x, 6.05 - length / 2, -5.07);
      const shape = new THREE.Shape();
      for (let j = 0; j < 10; j++) {
        const a = Math.PI / 2 + j * Math.PI / 5;
        const r = j % 2 === 0 ? 0.13 : 0.06;
        if (j === 0) shape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
        else shape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      shape.closePath();
      mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.015, bevelEnabled: false }), starMaterial, this.storyStars, x, 5.99 - length, -5.06);
    }
  }

  private buildDesk(paper: PaperSurface): void {
    box(13.6, 0.35, 10, this.tableMaterial, this.scene, 0, -0.2, -0.3, 0.09);
    box(13.4, 0.13, 0.12, this.trimMaterial, this.scene, 0, -0.26, 4.71);
    const blotter = box(PAPER_WIDTH + 0.65, 0.03, PAPER_HEIGHT + 0.56,
      material('#443e35', 0.98), this.scene, 0, 0.005, 0.05, 0.03);
    blotter.rotation.y = -0.012;
    for (let i = 0; i < 3; i++) {
      const page = box(PAPER_WIDTH, 0.009, PAPER_HEIGHT, this.pageEdgeMaterial, this.scene, (i - 1) * 0.014, 0.028 + i * 0.008, -i * 0.014, 0.003);
      page.rotation.y = (i - 1) * 0.002;
    }
    this.paperMaterial.map = paper.texture;
    this.paperMaterial.bumpMap = paper.heightTexture;
    this.paperMaterial.roughnessMap = paper.roughnessTexture;
    const surface = mesh(new THREE.PlaneGeometry(PAPER_WIDTH, PAPER_HEIGHT),
      this.paperMaterial, this.scene, 0, PAPER_Y, 0);
    surface.name = 'writing-paper';
    surface.rotation.x = -Math.PI / 2;
    surface.castShadow = false;
  }

  private buildLamp(): void {
    const group = new THREE.Group();
    group.position.set(3.55, 0, -2.7);
    this.scene.add(group);
    cylinder(0.6, 0.65, 0.11, this.brassMaterial, group, 0, 0.055);
    cylinder(0.39, 0.5, 0.075, this.trimMaterial, group, 0, 0.135);
    cylinder(0.055, 0.065, 2.64, this.brassMaterial, group, 0, 1.48);
    mesh(new THREE.SphereGeometry(0.1, 20, 12), this.brassMaterial, group, 0, 2.87);
    this.shadeMaterial.side = THREE.DoubleSide;
    mesh(new THREE.CylinderGeometry(0.43, 0.92, 0.82, 64, 1, true),
      this.shadeMaterial, group, -0.22, 3.12, 0);
    for (const [r, y] of [[0.435, 3.53], [0.918, 2.71]]) {
      const ring = mesh(new THREE.TorusGeometry(r, 0.025, 8, 64), this.brassMaterial, group, -0.22, y);
      ring.rotation.x = Math.PI / 2;
    }
    mesh(new THREE.SphereGeometry(0.16, 24, 12), this.lampBulbMaterial, group, -0.22, 2.91);
    tube([new THREE.Vector3(0.3, 0.045, -0.1), new THREE.Vector3(0.8, 0.04, -0.3),
      new THREE.Vector3(1.2, 0.04, -1), new THREE.Vector3(1.5, 0.04, -2.7)],
    0.02, material('#34332c', 0.9), group);
  }

  private buildBottle(): void {
    const bottle = new THREE.Group();
    bottle.position.set(2.68, 0.03, -0.84);
    bottle.rotation.y = -0.13;
    bottle.userData.interaction = 'ink';
    this.scene.add(bottle);
    const glass = new THREE.MeshPhysicalMaterial({
      color: '#88969a', roughness: 0.14, metalness: 0.05, transmission: 0.22,
      transparent: true, opacity: 0.85, thickness: 0.24, ior: 1.45,
    });
    box(0.87, 0.77, 0.7, glass, bottle, 0, 0.41, 0, 0.11);
    box(0.71, 0.48, 0.55, this.inkMaterial, bottle, 0, 0.29, 0, 0.07);
    cylinder(0.235, 0.24, 0.19, this.inkMaterial, bottle, 0, 0.88);
    cylinder(0.266, 0.27, 0.055, this.brassMaterial, bottle, 0, 0.99);
    const label = makeLabelTexture('No. 01', 'FOUNTAIN PEN INK  /  30 ml');
    this.allTextures.add(label);
    mesh(new THREE.PlaneGeometry(0.65, 0.41), new THREE.MeshStandardMaterial({ map: label, roughness: 0.8 }),
      bottle, 0, 0.45, 0.358);
    const lid = cylinder(0.28, 0.28, 0.2, this.trimMaterial, this.scene, 3.25, 0.12, -0.28);
    const rim = cylinder(0.282, 0.282, 0.035, this.brassMaterial, this.scene, 3.25, 0.22, -0.28);
    lid.userData.interaction = rim.userData.interaction = 'ink';
  }

  private buildRoll(): void {
    this.roll.name = 'leather-roll';
    this.roll.position.set(-3.18, 0.07, 0.03);
    this.roll.rotation.y = -0.16;
    this.roll.userData.interaction = 'roll';
    this.roll.add(this.rollOpenGroup, this.rollClosedGroup);
    this.scene.add(this.roll);
    const stitching = material('#c09976', 0.96);
    box(2.1, 0.042, 2.86, this.leatherMaterial, this.rollOpenGroup, 0, 0, 0, 0.03);
    for (let i = 0; i < 4; i++) {
      const x = -0.7 + i * 0.45;
      box(0.4, 0.055, 1.66, this.leatherMaterial, this.rollOpenGroup, x, 0.075, 0.52, 0.023);
      const spare = cylinder(0.057, 0.063, 1.87, i % 2 === 0 ? this.penMaterial : this.trimMaterial,
        this.rollOpenGroup, x, 0.105, -0.23);
      spare.rotation.x = Math.PI / 2;
      const ring = cylinder(0.065, 0.065, 0.05, this.brassMaterial, this.rollOpenGroup, x, 0.105, -0.74);
      ring.rotation.x = Math.PI / 2;
      for (let j = 0; j < 12; j++) {
        box(0.014, 0.007, 0.036, stitching, this.rollOpenGroup, x - 0.186, 0.106, -0.24 + j * 0.123, 0.002);
      }
    }
    const fold = cylinder(0.13, 0.13, 2.84, this.leatherMaterial, this.rollOpenGroup, 1.03, 0.125);
    fold.rotation.x = Math.PI / 2;
    tube([new THREE.Vector3(1.05, 0.06, 0.65), new THREE.Vector3(1.48, 0.04, 0.83),
      new THREE.Vector3(1.33, 0.04, 1.2), new THREE.Vector3(1.65, 0.04, 1.36)],
    0.022, this.leatherMaterial, this.rollOpenGroup);
    const closed = cylinder(0.4, 0.43, 2.7, this.leatherMaterial, this.rollClosedGroup, 0, 0.4);
    closed.rotation.x = Math.PI / 2;
    for (const z of [-0.22, 0.12]) {
      mesh(new THREE.TorusGeometry(0.433, 0.026, 8, 64), material('#473127', 0.9), this.rollClosedGroup, 0, 0.4, z);
    }
    tube([new THREE.Vector3(0.32, 0.66, 0.02), new THREE.Vector3(0.55, 0.52, 0.2),
      new THREE.Vector3(0.72, 0.17, 0.55), new THREE.Vector3(0.96, 0.05, 0.73)],
    0.025, this.trimMaterial, this.rollClosedGroup);
    tube([new THREE.Vector3(0.32, 0.66, 0.02), new THREE.Vector3(0.55, 0.67, -0.25),
      new THREE.Vector3(0.66, 0.31, -0.12), new THREE.Vector3(0.91, 0.06, 0.16)],
    0.023, this.trimMaterial, this.rollClosedGroup);
  }

  private buildProps(): void {
    const books = new THREE.Group();
    books.name = 'desk-books';
    books.position.set(-3.05, 0.03, -3.42);
    books.rotation.y = 0.23 + THREE.MathUtils.degToRad(20);
    this.scene.add(books);
    for (let i = 0; i < 2; i++) {
      const w = 2.1 - i * 0.13;
      const d = 1.53 - i * 0.1;
      const y = 0.22 + i * 0.4;
      box(w, 0.29, d, this.pageEdgeMaterial, books, 0, y, 0, 0.014);
      for (const h of [-0.18, 0.18]) box(w + 0.1, 0.045, d + 0.08, this.bookMaterial, books, 0, y + h, 0, 0.016);
      box(0.09, 0.35, d, this.bookMaterial, books, -w / 2, y, 0, 0.025);
      for (const z of [-0.54, 0.5]) box(0.01, 0.33, 0.05, this.brassMaterial, books, -w / 2 - 0.047, y, z, 0.002);
    }
    const cup = new THREE.Group();
    cup.name = 'coffee-cup';
    cup.position.set(-0.55, 0.04, -3.5);
    this.scene.add(cup);
    cylinder(0.58, 0.55, 0.05, this.ceramicMaterial, cup, 0, 0.035);
    const profile = [new THREE.Vector2(0.21, 0.08), new THREE.Vector2(0.3, 0.11),
      new THREE.Vector2(0.38, 0.45), new THREE.Vector2(0.39, 0.65),
      new THREE.Vector2(0.36, 0.67), new THREE.Vector2(0.34, 0.45),
      new THREE.Vector2(0.26, 0.15)];
    mesh(new THREE.LatheGeometry(profile, 48), this.ceramicMaterial, cup);
    cylinder(0.341, 0.341, 0.012, material('#573b27', 0.2), cup, 0, 0.535);
    const handleAnchor = new THREE.Vector3(-0.35, 0.3915, 0);
    const handlePath = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.381, 0.576, 0), new THREE.Vector3(-0.535, 0.596, 0),
      new THREE.Vector3(-0.685, 0.542, 0), new THREE.Vector3(-0.758, 0.438, 0),
      new THREE.Vector3(-0.755, 0.31, 0), new THREE.Vector3(-0.66, 0.208, 0),
      new THREE.Vector3(-0.5, 0.183, 0), new THREE.Vector3(-0.319, 0.207, 0),
    ].map((point) => point.lerp(handleAnchor, 0.1)));
    const handle = mesh(new THREE.TubeGeometry(handlePath, 48, 0.052 * 0.9, 16, false), this.ceramicMaterial, cup);
    handle.name = 'cup-handle';
    for (const [x, y] of [[-0.397, 0.576], [-0.337, 0.207]]) {
      const joint = mesh(new THREE.SphereGeometry(1, 20, 12), this.ceramicMaterial, cup, x, y);
      joint.name = 'handle-attachment';
      joint.position.lerp(handleAnchor, 0.1);
      joint.scale.set(0.028, 0.062, 0.06).multiplyScalar(0.9);
    }
    const plant = new THREE.Group();
    plant.position.set(4.97, 0, -3.83);
    this.scene.add(plant);
    cylinder(0.43, 0.31, 0.68, this.ceramicMaterial, plant, 0, 0.35);
    cylinder(0.397, 0.397, 0.035, material('#453c2c', 1), plant, 0, 0.68);
    const branch = material('#665d41', 0.9);
    for (let i = 0; i < 8; i++) {
      const angle = i * 2.4;
      const height = 0.8 + (i % 3) * 0.24;
      const x = Math.cos(angle) * 0.36;
      const z = Math.sin(angle) * 0.36;
      tube([new THREE.Vector3(0, 0.66, 0), new THREE.Vector3(x * 0.5, 0.98, z * 0.5),
        new THREE.Vector3(x, height + 0.7, z)], 0.018, branch, plant);
      for (let j = 0; j < 2; j++) {
        const leaf = mesh(new THREE.SphereGeometry(1, 16, 8), this.leafMaterial, plant,
          x + Math.cos(angle + j * Math.PI) * 0.13, height + 0.4 + j * 0.2, z + Math.sin(angle) * 0.15);
        leaf.scale.set(0.16, 0.3, 0.042);
        leaf.rotation.set(0.3, angle, Math.cos(angle) * 0.65);
      }
    }
    const ruler = box(0.34, 0.035, 2.28, this.brassMaterial, this.scene, 2.65, 0.06, 2.22, 0.013);
    ruler.rotation.y = 0.09;
    const marks = material('#786647', 0.75);
    for (let i = 0; i < 18; i++) {
      box(i % 5 === 0 ? 0.19 : 0.09, 0.004, 0.008, marks, ruler, -0.045, 0.02, -0.97 + i * 0.113, 0.001);
    }
  }

  private buildPen(): void {
    const retained = new Set<THREE.Material>([this.brassMaterial, this.steelMaterial, this.penMaterial, this.tableMaterial]);
    this.pen.remove(this.nib);
    disposeObject(this.pen, retained);
    disposeObject(this.nib, retained);
    disposeObject(this.cap, retained);
    const fountain = this.settings.pen === 'fountain';
    const metal = fountain ? this.brassMaterial : this.steelMaterial;
    const broad = this.settings.nib === 'broad';
    const shape = new THREE.Shape();
    shape.moveTo(broad ? -0.035 : -0.003, 0);
    shape.lineTo(broad ? 0.035 : 0.003, 0);
    shape.bezierCurveTo(0.032, 0.115, 0.087, 0.195, 0.098, 0.28);
    shape.quadraticCurveTo(0.078, 0.35, 0.059, 0.41);
    shape.lineTo(-0.059, 0.41);
    shape.quadraticCurveTo(-0.078, 0.35, -0.098, 0.28);
    shape.bezierCurveTo(-0.087, 0.195, -0.032, 0.115, broad ? -0.035 : -0.003, 0);
    const nibBlade = mesh(new THREE.ExtrudeGeometry(shape, {
      depth: 0.015, bevelEnabled: true, bevelSegments: 2, steps: 1, bevelSize: 0.0035, bevelThickness: 0.0035,
    }), metal, this.nib);
    nibBlade.castShadow = false;
    const slitMaterial = material('#262521', 0.9);
    box(0.006, 0.267, 0.004, slitMaterial, this.nib, 0, 0.136, 0.024, 0.001);
    const hole = mesh(new THREE.CircleGeometry(0.016, 20), slitMaterial, this.nib, 0, 0.282, 0.024);
    hole.castShadow = false;
    const nibDecoration = new THREE.Line(new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-0.062, 0.286, 0.024), new THREE.Vector3(-0.043, 0.23, 0.024),
      new THREE.Vector3(-0.018, 0.206, 0.024),
    ]), new THREE.LineBasicMaterial({ color: '#92713c' }));
    this.nib.add(nibDecoration);
    this.pen.add(this.nib);
    if (fountain) {
      cylinder(0.098, 0.068, 0.43, material('#24312e', 0.29), this.pen, 0, 0.61);
      cylinder(0.121, 0.12, 0.045, metal, this.pen, 0, 0.84);
      cylinder(0.108, 0.12, 1.26, this.penMaterial, this.pen, 0, 1.49);
      mesh(new THREE.SphereGeometry(0.108, 28, 16), this.penMaterial, this.pen, 0, 2.12);
      cylinder(0.111, 0.111, 0.035, metal, this.pen, 0, 2.02);
      const shellProfile = [
        [0.153, 0.02], [0.151, 0.7], [0.148, 0.79], [0.14, 0.855],
        [0.115, 0.91], [0.075, 0.951], [0.03, 0.97], [0, 0.974],
        [0, 0.951], [0.032, 0.948], [0.07, 0.93], [0.1, 0.896],
        [0.127, 0.851], [0.131, 0.79], [0.134, 0.7], [0.139, 0.02], [0.153, 0.02],
      ].map(([radius, height]) => new THREE.Vector2(radius, height));
      mesh(new THREE.LatheGeometry(shellProfile, 48), this.penMaterial, this.cap);
      // Offset the metal lip from the shell's end face to avoid flickering at the open rim.
      const rimProfile = [[0.139, 0.018], [0.157, 0.018], [0.157, 0.09], [0.152, 0.09]]
        .map(([radius, height]) => new THREE.Vector2(radius, height));
      mesh(new THREE.LatheGeometry(rimProfile, 48), metal, this.cap);
      tube([new THREE.Vector3(0, 0.78, 0.145), new THREE.Vector3(0, 0.75, 0.19),
        new THREE.Vector3(0, 0.28, 0.19), new THREE.Vector3(0, 0.22, 0.165)],
      0.021, metal, this.cap);
    } else {
      cylinder(0.07, 0.082, 0.18, metal, this.pen, 0, 0.46);
      cylinder(0.036, 0.092, 1.67, this.tableMaterial, this.pen, 0, 1.345);
      mesh(new THREE.SphereGeometry(0.037, 20, 12), this.tableMaterial, this.pen, 0, 2.18);
    }
    this.cap.userData.interaction = 'cap';
    this.pen.userData.interaction = 'cap';
  }

  configure(settings: Settings): void {
    const rebuild = settings.pen !== this.settings.pen || settings.nib !== this.settings.nib;
    const weatherChanged = settings.weather !== this.settings.weather;
    this.settings = { ...settings };
    const palette = PALETTES[settings.mood];
    this.tableMaterial.color.set(palette.wood);
    this.wallMaterial.color.set(palette.wall);
    this.trimMaterial.color.set(palette.trim);
    this.leatherMaterial.color.set(palette.leather);
    this.penMaterial.color.set(palette.pen);
    this.ceramicMaterial.color.set(palette.ceramic);
    this.bookMaterial.color.set(palette.book);
    this.leafMaterial.color.set(palette.foliage);
    this.inkMaterial.color.set(inkColor(settings));
    this.pageEdgeMaterial.color.set(PAPER_COLORS[settings.paper]);
    this.paperMaterial.roughness = PAPER_FINISH[settings.paper].roughness;
    this.paperMaterial.bumpScale = PAPER_FINISH[settings.paper].bumpScale;
    this.shadeMaterial.color.set(settings.mood === 'storybook' ? '#e3beaf' : settings.mood === 'atelier' ? '#f4ead5' : '#e4c997');
    this.storyStars.visible = settings.mood === 'storybook';
    const daylight = Math.max(0, Math.sin((settings.time - 6) / 12 * Math.PI));
    const overcast = settings.weather === 'clear' ? 1 : settings.weather === 'rain' ? 0.59 : 0.39;
    const warmth = Math.max(0, 1 - Math.abs(settings.time - 17) / 3.5);
    this.outdoors.configure(settings, daylight, warmth);
    this.scene.fog?.color.copy(this.outdoors.hazeColor);
    this.sun.position.set(Math.cos((settings.time - 6) / 12 * Math.PI) * 6.5, 2.8 + daylight * 7, -4);
    this.sun.color.set(new THREE.Color('#fff0d3').lerp(new THREE.Color('#ffc88b'), warmth));
    this.sun.intensity = 0.18 + daylight * 2.45 * overcast;
    this.hemisphere.intensity = 0.78 + daylight * 0.85 * overcast;
    this.hemisphere.color.set(settings.mood === 'storybook' ? '#e6daef' : '#e9e4d3');
    this.lampLight.intensity = (1 - daylight * 0.82) * (settings.mood === 'study' ? 23 : 18) + (1 - overcast) * 5;
    this.lampBulbMaterial.emissiveIntensity = 0.3 + (1 - daylight) * 1.5;
    this.shadeMaterial.emissive.set('#d9a559');
    this.shadeMaterial.emissiveIntensity = (1 - daylight) * 0.1;
    this.scene.background = new THREE.Color(palette.wall).multiplyScalar(0.8);
    if (weatherChanged) {
      this.thunderAt = null;
      this.lightningRemaining = 0;
      this.flashLight.intensity = 0;
      this.nextLightning = this.lastTime + 16 + Math.random() * 12;
    }
    if (rebuild) this.buildPen();
    this.cap.visible = settings.pen === 'fountain';
  }

  setReducedMotion(reduced: boolean): void {
    this.reducedMotion = reduced;
    this.controls.enableDamping = !reduced;
    this.dust.visible = !reduced;
    if (reduced) {
      this.flashLight.intensity = 0;
      this.lightningRemaining = 0;
    }
  }

  setCamera(preset: CameraPreset, immediate = false): void {
    const damping = this.controls.enableDamping;
    this.controls.enableDamping = false;
    this.controls.update();
    this.controls.enableDamping = damping;
    this.currentPreset = preset;
    this.followNib = preset === 'detail';
    const narrow = this.camera.aspect < 0.9;
    if (preset === 'desk') {
      this.targetPosition.set(4.1, narrow ? 12.5 : 9.2, narrow ? 12 : 9.4);
      this.targetLook.set(-0.15, 0.65, -0.45);
    } else if (preset === 'detail') {
      this.targetLook.copy(this.pen.position);
      this.targetLook.y = 0.4;
      this.targetPosition.copy(this.targetLook).add(new THREE.Vector3(2.05, 3.45, 3.1));
    } else {
      this.targetPosition.set(0, narrow ? 12.2 : 10.4, 0.7);
      this.targetLook.set(0, 0, 0);
    }
    this.targetPosition.sub(this.targetLook)
      .clampLength(this.controls.minDistance, this.controls.maxDistance).add(this.targetLook);
    if (immediate || this.reducedMotion) {
      this.camera.position.copy(this.targetPosition);
      this.controls.target.copy(this.targetLook);
      this.controls.cursor.copy(this.targetLook);
      this.controls.update();
      this.movingCamera = false;
    } else this.movingCamera = true;
  }

  setDragMode(mode: CameraDragMode): void {
    this.dragMode = mode;
    configureCameraDrag(this.controls, mode);
    this.renderer.domElement.dataset.dragMode = mode;
  }

  holdCamera(): void {
    this.movingCamera = false;
    this.followNib = false;
  }

  get soundPlacement(): { pen: number; window: number } {
    this.camera.getWorldPosition(this.soundListener);
    this.soundRight.setFromMatrixColumn(this.camera.matrixWorld, 0);
    this.pen.getWorldPosition(this.soundPen);
    return {
      pen: cameraRelativePan(this.soundPen, this.soundListener, this.soundRight),
      window: cameraRelativePan(WINDOW_SOUND_POSITION, this.soundListener, this.soundRight),
    };
  }

  adjustCamera(key: string, pan = false): boolean {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-', '_'].includes(key)) return false;
    this.movingCamera = false;
    this.followNib = false;
    if ((pan || this.dragMode === 'pan') && panCameraWithKey(this.camera, this.controls, key)) return true;
    const offset = this.camera.position.clone().sub(this.controls.target);
    const spherical = new THREE.Spherical().setFromVector3(offset);
    if (key === 'ArrowLeft') spherical.theta -= 0.09;
    if (key === 'ArrowRight') spherical.theta += 0.09;
    if (key === 'ArrowUp') spherical.phi -= 0.07;
    if (key === 'ArrowDown') spherical.phi += 0.07;
    if (key === '+' || key === '=') spherical.radius *= 0.9;
    if (key === '-' || key === '_') spherical.radius *= 1.1;
    spherical.theta = THREE.MathUtils.clamp(spherical.theta, this.controls.minAzimuthAngle, this.controls.maxAzimuthAngle);
    spherical.phi = THREE.MathUtils.clamp(spherical.phi, this.controls.minPolarAngle, this.controls.maxPolarAngle);
    spherical.radius = THREE.MathUtils.clamp(spherical.radius, this.controls.minDistance, this.controls.maxDistance);
    this.camera.position.setFromSpherical(spherical).add(this.controls.target);
    this.controls.update();
    return true;
  }

  setRoll(open: boolean): void {
    this.rollOpen = open;
    if (this.reducedMotion) this.rollAmount = open ? 1 : 0;
  }

  setCapped(capped: boolean): void {
    this.capped = capped;
    if (this.reducedMotion) this.capAmount = capped ? 1 : 0;
  }

  updatePen(sample: PenSample, delta = 0): void {
    const x = (sample.x / PAGE.width - 0.5) * PAPER_WIDTH;
    const z = (sample.y / PAGE.height - 0.5) * PAPER_HEIGHT;
    const idle = sample.status === 'idle';
    if (sample.status !== 'complete') this.penReturn = null;
    if (idle) {
      this.pen.position.copy(PEN_REST_POSITION);
      this.pen.quaternion.copy(PEN_REST_ROTATION);
    } else if (sample.status === 'complete') {
      if (!this.penReturn) {
        this.penReturn = {
          elapsed: 0,
          start: new THREE.Vector3(x, PAPER_Y + 0.018 + (this.capped ? this.capAmount * 0.11 : 0), z),
          rotation: this.pen.quaternion.clone(),
        };
        this.followNib = false;
      }
      const motion = this.penReturn;
      motion.elapsed = this.reducedMotion ? PEN_RETURN_DURATION
        : Math.min(PEN_RETURN_DURATION, motion.elapsed + (Number.isFinite(delta) ? Math.max(0, delta) : 0));
      const lift = THREE.MathUtils.smoothstep(motion.elapsed, 0.18, 0.5);
      const travel = THREE.MathUtils.smoothstep(motion.elapsed, 0.5, 1.45);
      const lower = THREE.MathUtils.smoothstep(motion.elapsed, 1.45, PEN_RETURN_DURATION);
      this.pen.position.copy(motion.start).lerp(PEN_REST_POSITION, travel);
      const startHeight = Math.max(motion.start.y, PAPER_Y + 0.018 + (this.capped ? this.capAmount * 0.11 : 0));
      this.pen.position.y = THREE.MathUtils.lerp(
        THREE.MathUtils.lerp(startHeight, 1.32, lift),
        PEN_REST_POSITION.y, lower);
      this.pen.quaternion.copy(motion.rotation).slerp(PEN_REST_ROTATION, travel);
      if (motion.elapsed === PEN_RETURN_DURATION) {
        this.pen.position.copy(PEN_REST_POSITION);
        this.pen.quaternion.copy(PEN_REST_ROTATION);
      }
    } else {
      const capClearance = this.capped && !sample.contact ? this.capAmount * 0.11 : 0;
      this.pen.position.set(x, PAPER_Y + (sample.contact ? 0.004 : Math.max(0.018, sample.lift * 0.48)) + capClearance, z);
      this.pen.quaternion.copy(this.penOrientation);
      this.pen.rotateY(Math.sin(sample.angle) * 0.045);
    }
    this.nib.scale.x = this.settings.nib === 'flex' && sample.contact ? 1 + sample.pressure * 0.14 : 1;
    const parked = new THREE.Vector3(2.61, 0.16, 0.93);
    const attached = this.pen.localToWorld(new THREE.Vector3(0, CAP_SEAT_Y, 0));
    this.cap.position.copy(parked).lerp(attached, this.capAmount);
    const parkedRotation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0.31, 0, -0.95).normalize());
    // The mouth seats at the barrel; the closed crown faces the nib, with the clip still on top.
    const attachedRotation = this.pen.quaternion.clone().multiply(CAP_REVERSE);
    this.cap.quaternion.copy(parkedRotation).slerp(attachedRotation, this.capAmount);
    if (this.followNib && !this.movingCamera) {
      const look = this.pen.position.clone();
      look.y = 0.4;
      this.camera.position.add(look.clone().sub(this.controls.target));
      this.controls.target.copy(look);
      this.controls.cursor.copy(look);
    }
  }

  update(delta: number, elapsed: number): void {
    this.lastTime = elapsed;
    const factor = this.reducedMotion ? 1 : 1 - Math.exp(-delta * 6);
    this.rollAmount = THREE.MathUtils.lerp(this.rollAmount, this.rollOpen ? 1 : 0, factor);
    this.capAmount = THREE.MathUtils.lerp(this.capAmount, this.capped ? 1 : 0, factor);
    this.rollOpenGroup.visible = this.rollAmount > 0.025;
    this.rollOpenGroup.scale.x = Math.max(0.01, this.rollAmount);
    this.rollClosedGroup.visible = this.rollAmount < 0.975;
    this.rollClosedGroup.scale.setScalar(Math.max(0.01, 1 - this.rollAmount));
    if (this.movingCamera) {
      this.camera.position.lerp(this.targetPosition, factor * 0.7);
      this.controls.target.lerp(this.targetLook, factor * 0.7);
      if (this.camera.position.distanceTo(this.targetPosition) < 0.01) this.movingCamera = false;
      this.controls.cursor.copy(this.movingCamera ? this.controls.target : this.targetLook);
    }
    this.controls.update();
    this.outdoors.update(elapsed, this.reducedMotion);
    if (this.settings.weather === 'storm' && elapsed > this.nextLightning) {
      this.nextLightning = elapsed + 24 + Math.random() * 25;
      this.lightningRemaining = this.reducedMotion ? 0 : 0.7;
      this.thunderAt = elapsed + 1.8 + Math.random() * 1.3;
    }
    if (this.lightningRemaining > 0) {
      this.lightningRemaining = Math.max(0, this.lightningRemaining - delta);
      this.flashLight.intensity = Math.sin(this.lightningRemaining / 0.7 * Math.PI) * 5;
    } else this.flashLight.intensity = 0;
    if (this.thunderAt !== null && elapsed >= this.thunderAt) {
      this.thunderAt = null;
      if (this.settings.weather === 'storm') this.onThunder();
    }
    if (!this.reducedMotion) {
      this.dust.position.y = Math.sin(elapsed * 0.08) * 0.08;
      this.dust.rotation.y = Math.sin(elapsed * 0.025) * 0.025;
    }
    this.renderer.render(this.scene, this.camera);
  }

  get diagnostics(): Record<string, unknown> {
    return {
      mood: this.settings.mood, time: this.settings.time, weather: this.settings.weather,
      ...this.outdoors.diagnostics, sunIntensity: this.sun.intensity,
      lampIntensity: this.lampLight.intensity, sunPosition: this.sun.position.toArray(),
      tableColor: this.tableMaterial.color.getHexString(), pen: this.settings.pen, nib: this.settings.nib,
      rollOpen: this.rollOpen, capped: this.capped, camera: this.currentPreset,
      capAmount: this.capAmount, capVisible: this.cap.visible,
      nibInCap: this.cap.worldToLocal(this.pen.getWorldPosition(new THREE.Vector3())).toArray(),
      capAxisAlignment: new THREE.Vector3(0, 1, 0).applyQuaternion(this.pen.quaternion)
        .dot(new THREE.Vector3(0, 1, 0).applyQuaternion(this.cap.quaternion)),
      dragMode: this.dragMode, cameraPosition: this.camera.position.toArray(),
      cameraTarget: this.controls.target.toArray(), panAnchor: this.controls.cursor.toArray(),
      panRadius: this.controls.maxTargetRadius, followingNib: this.followNib,
      cameraTransitioning: this.movingCamera,
      penPosition: this.pen.position.toArray(),
      penReturning: this.penReturn !== null && this.penReturn.elapsed < PEN_RETURN_DURATION,
      penResting: this.pen.position.distanceTo(PEN_REST_POSITION) < 0.001,
      reducedMotion: this.reducedMotion, lightningIntensity: this.flashLight.intensity,
      paperRoughnessMapped: this.paperMaterial.roughnessMap !== null,
      paperRoughnessVersion: this.paperMaterial.roughnessMap?.version ?? 0,
      soundPlacement: this.soundPlacement,
      canvas: { width: this.renderer.domElement.width, height: this.renderer.domElement.height },
      drawCalls: this.renderer.info.render.calls,
    };
  }

  private resize(): void {
    const parent = this.renderer.domElement.parentElement;
    if (!parent) return;
    const { width, height } = parent.getBoundingClientRect();
    this.camera.aspect = Math.max(1, width) / Math.max(1, height);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  private pointerDown = (event: PointerEvent): void => {
    const modified = event.shiftKey || event.ctrlKey || event.metaKey;
    configureCameraDrag(this.controls, this.dragMode, modified);
    this.activePointers.add(event.pointerId);
    if (this.activePointers.size === 1) {
      this.pointerStart.set(event.clientX, event.clientY);
      this.pointerMoved = false;
      this.pointerActionAllowed = this.dragMode === 'orbit' && event.button === 0 && !modified;
    } else this.pointerMoved = true;
  };

  private pointerMove = (event: PointerEvent): void => {
    if (this.activePointers.has(event.pointerId)
      && this.pointerStart.distanceTo(new THREE.Vector2(event.clientX, event.clientY)) > 6) this.pointerMoved = true;
  };

  private pointerCancel = (event: PointerEvent): void => {
    this.activePointers.delete(event.pointerId);
    this.pointerActionAllowed = false;
  };

  private pointerUp = (event: PointerEvent): void => {
    this.activePointers.delete(event.pointerId);
    if (!this.pointerActionAllowed || this.pointerMoved || this.activePointers.size > 0
      || this.pointerStart.distanceTo(new THREE.Vector2(event.clientX, event.clientY)) > 6) return;
    const bounds = this.renderer.domElement.getBoundingClientRect();
    this.mouse.set((event.clientX - bounds.left) / bounds.width * 2 - 1, -(event.clientY - bounds.top) / bounds.height * 2 + 1);
    this.raycaster.setFromCamera(this.mouse, this.camera);
    for (const hit of this.raycaster.intersectObjects([this.roll, this.cap, this.pen, ...this.scene.children.filter((child) => child.userData.interaction === 'ink')], true)) {
      let ancestor: THREE.Object3D | null = hit.object;
      let visible = true;
      while (ancestor) {
        if (!ancestor.visible) { visible = false; break; }
        ancestor = ancestor.parent;
      }
      if (!visible) continue;
      let current: THREE.Object3D | null = hit.object;
      while (current) {
        const action: unknown = current.userData.interaction;
        if (action === 'roll' || action === 'cap' || action === 'ink') {
          if (action === 'cap' && this.settings.pen === 'dip') break;
          this.interaction(action);
          return;
        }
        current = current.parent;
      }
    }
  };

  dispose(): void {
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.renderer.domElement.removeEventListener('pointerdown', this.pointerDown, { capture: true });
    this.renderer.domElement.removeEventListener('pointermove', this.pointerMove);
    this.renderer.domElement.removeEventListener('pointerup', this.pointerUp);
    this.renderer.domElement.removeEventListener('pointercancel', this.pointerCancel);
    const materials = new Set<THREE.Material>();
    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Points) {
        object.geometry.dispose();
        for (const entry of Array.isArray(object.material) ? object.material : [object.material]) materials.add(entry);
      }
    });
    for (const entry of materials) entry.dispose();
    for (const texture of this.allTextures) texture.dispose();
    this.environmentTarget.dispose();
    this.renderer.dispose();
  }
}
