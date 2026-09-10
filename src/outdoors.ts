import * as THREE from 'three';
import { canvas2D, randomSource } from './textures.ts';
import type { Settings, Weather } from './types.ts';

export const RAIN_COUNT = 420;
export const GLASS_DROP_COUNT = 92;
const GLASS_Z = -5.63;
const Y_AXIS = new THREE.Vector3(0, 1, 0);

export function terrainHeight(x: number, z: number): number {
  return 1.02 + Math.sin(x * 0.62 + z * 0.38) * 0.28
    + Math.cos(x * 1.15 - z * 0.22) * 0.2 + Math.sin(x * 0.24 + z * 0.85) * 0.14
    - Math.max(0, -z - 6.2) * 0.24;
}

export function forestLayout(): { x: number; y: number; z: number; height: number; seed: number }[] {
  const random = randomSource(4019);
  const trees = [];
  for (const [row, count, width] of [[0, 14, 9.2], [1, 21, 11.4], [2, 27, 14]]) {
    for (let i = 0; i < count; i++) {
      const x = -width / 2 + (i + 0.15 + random() * 0.7) / count * width;
      const z = -6.65 - row * 2.35 - random() * 1.1;
      trees.push({ x, z, y: terrainHeight(x, z), height: 0.95 + random() * 0.67 - row * 0.055, seed: Math.floor(random() * 100000) });
    }
  }
  return trees;
}

export function rainPositions(elapsed: number, weather: Weather, target: Float32Array): void {
  if (target.length !== RAIN_COUNT * 12) throw new RangeError('The rain buffer has the wrong size.');
  const random = randomSource(817);
  const storm = weather === 'storm';
  for (let i = 0; i < RAIN_COUNT; i++) {
    const startX = random() * 13.8 - 6.9;
    const phase = random() * 9;
    const z = -6.2 - random() * 4.4;
    const speed = (storm ? 5.7 : 3.9) * (0.65 + random() * 0.8);
    const length = (0.05 + random() * 0.14) * (storm ? 1.3 : 1);
    const width = 0.003 + random() * 0.005;
    const y = -1 + ((phase - elapsed * speed) % 9 + 9) % 9;
    const wind = (storm ? 0.32 : 0.11) + Math.sin(elapsed * 0.19) * 0.035;
    const x = startX + Math.sin(elapsed * 0.23 + phase) * 0.12;
    const lean = length * wind;
    const offset = i * 12;
    target.set([x - width, y, z, x + width, y, z,
      x - width - lean, y + length, z, x + width - lean, y + length, z], offset);
  }
}

function foliageTexture(): THREE.CanvasTexture {
  const [canvas, context] = canvas2D(256, 256);
  const random = randomSource(313);
  for (let i = 0; i < 64; i++) {
    const angle = random() * Math.PI * 2;
    const radius = Math.sqrt(random()) * 92;
    const x = 128 + Math.cos(angle) * radius;
    const y = 126 + Math.sin(angle) * radius * 0.92;
    context.strokeStyle = 'rgba(95,104,83,.62)';
    context.lineWidth = 1.4;
    context.beginPath();
    context.moveTo(127, 157);
    context.quadraticCurveTo(125 + (x - 125) * 0.3, y + 15, x, y);
    context.stroke();
    context.save();
    context.translate(x, y);
    context.rotate(angle + random() * 0.9);
    const length = 14 + random() * 20;
    const breadth = 8 + random() * 8;
    const shade = Math.floor(156 + random() * 85);
    const gradient = context.createLinearGradient(0, -breadth, 0, breadth);
    gradient.addColorStop(0, `rgb(${shade},${shade},${shade - 10})`);
    gradient.addColorStop(1, `rgb(${shade * 0.64},${shade * 0.68},${shade * 0.6})`);
    context.fillStyle = gradient;
    context.beginPath();
    context.moveTo(-length / 2, 0);
    context.quadraticCurveTo(0, breadth, length / 2, 0);
    context.quadraticCurveTo(0, -breadth, -length / 2, 0);
    context.fill();
    context.restore();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function waterTexture(): THREE.CanvasTexture {
  const [canvas, context] = canvas2D(128, 128);
  const lens = context.createRadialGradient(64, 61, 7, 64, 65, 44);
  lens.addColorStop(0, 'rgba(194,221,229,0)');
  lens.addColorStop(0.7, 'rgba(129,169,184,.05)');
  lens.addColorStop(0.88, 'rgba(31,52,60,.36)');
  lens.addColorStop(1, 'rgba(64,84,91,0)');
  context.fillStyle = lens;
  context.fillRect(0, 0, 128, 128);
  context.strokeStyle = 'rgba(240,251,249,.82)';
  context.lineWidth = 3;
  context.beginPath();
  context.ellipse(63, 64, 36, 40, -0.17, Math.PI * 1.07, Math.PI * 1.57);
  context.stroke();
  context.fillStyle = 'rgba(235,248,247,.72)';
  context.beginPath();
  context.ellipse(72, 96, 7, 2.3, -0.3, 0, Math.PI * 2);
  context.fill();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export class OutdoorView {
  readonly root = new THREE.Group();
  readonly textures: readonly THREE.Texture[];
  readonly hazeColor = new THREE.Color();
  private readonly groundMaterial = new THREE.MeshStandardMaterial({ color: '#819071', roughness: 1, vertexColors: true });
  private readonly foliageMaterial: THREE.MeshStandardMaterial;
  private readonly barkMaterial = new THREE.MeshStandardMaterial({ color: '#665b49', roughness: 1 });
  private readonly wind = { value: 0 };
  private readonly haze = { value: 0.45 };
  private readonly sky = new THREE.ShaderMaterial({
    uniforms: {
      top: { value: new THREE.Color('#93acbc') }, bottom: { value: new THREE.Color('#d6dbc9') },
      cloudLight: { value: new THREE.Color('#e3e7df') }, cloudShade: { value: new THREE.Color('#9babb0') },
      cover: { value: 0.7 }, time: { value: 0 },
    },
    vertexShader: 'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader: `
      varying vec2 vUv;
      uniform vec3 top, bottom, cloudLight, cloudShade;
      uniform float cover, time;
      float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float noise(vec2 p){
        vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
        return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);
      }
      float cloud(vec2 p){
        float n=0.0,a=.55;
        for(int i=0;i<4;i++){n+=noise(p)*a;p=p*2.07+vec2(3.2,7.1);a*=.48;}
        return n;
      }
      void main(){
        vec2 p=vUv*vec2(5.8,3.8)+vec2(time*.006,0);
        float n=cloud(p+vec2(cloud(p*.6),0));
        float mask=smoothstep(.66-cover*.31,.87-cover*.22,n);
        vec3 sky=mix(bottom,top,smoothstep(.1,.95,vUv.y));
        vec3 clouds=mix(cloudShade,cloudLight,smoothstep(.27,.72,n));
        gl_FragColor=vec4(mix(sky,clouds,mask*.88),1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    depthWrite: false,
  });
  private readonly sun = new THREE.Mesh(new THREE.SphereGeometry(0.43, 24, 16),
    new THREE.MeshBasicMaterial({ color: '#fff0ce', depthWrite: false, fog: false }));
  private readonly rain = new THREE.Group();
  private readonly fallPositions = new Float32Array(RAIN_COUNT * 12);
  private readonly falling: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private readonly beads: THREE.InstancedMesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private readonly trails: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  private readonly trailPositions = new Float32Array(18 * 6 * 3);
  private treeCount = 0;
  private weather: Weather = 'rain';

  constructor() {
    this.root.name = 'outside-the-window';
    const leaves = foliageTexture();
    const drops = waterTexture();
    this.textures = [leaves, drops];
    this.foliageMaterial = new THREE.MeshStandardMaterial({
      map: leaves, color: '#657f50', alphaTest: 0.38, alphaToCoverage: true,
      side: THREE.DoubleSide, roughness: 1, envMapIntensity: 0.12,
    });
    this.addAtmosphere(this.foliageMaterial, true);
    this.addAtmosphere(this.groundMaterial);
    this.addAtmosphere(this.barkMaterial);
    const sky = new THREE.Mesh(new THREE.PlaneGeometry(18, 12), this.sky);
    sky.position.set(0, 3.6, -12.5);
    sky.renderOrder = -20;
    this.sun.renderOrder = -19;
    this.root.add(sky, this.sun);
    this.buildLandscape();

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.fallPositions, 3).setUsage(THREE.DynamicDrawUsage));
    const colors = new Float32Array(RAIN_COUNT * 16);
    const indices = [];
    const random = randomSource(619);
    for (let i = 0; i < RAIN_COUNT; i++) {
      const alpha = 0.2 + random() * 0.5;
      colors.set([1, 1, 1, alpha, 1, 1, 1, alpha, 1, 1, 1, 0, 1, 1, 1, 0], i * 16);
      indices.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 1, i * 4 + 3, i * 4 + 2);
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 4));
    geometry.setIndex(indices);
    this.falling = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
      color: '#d3e1e6', vertexColors: true, transparent: true, opacity: 0.48, depthWrite: false, side: THREE.DoubleSide,
    }));
    this.falling.frustumCulled = false;
    this.beads = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
      map: drops, transparent: true, opacity: 0.6, depthWrite: false, fog: false,
    }), GLASS_DROP_COUNT);
    this.beads.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.beads.frustumCulled = false;
    const trailGeometry = new THREE.BufferGeometry();
    trailGeometry.setAttribute('position', new THREE.BufferAttribute(this.trailPositions, 3).setUsage(THREE.DynamicDrawUsage));
    this.trails = new THREE.LineSegments(trailGeometry, new THREE.LineBasicMaterial({
      color: '#bfced0', transparent: true, opacity: 0.17, depthWrite: false, fog: false,
    }));
    this.trails.frustumCulled = false;
    this.rain.add(this.falling, this.beads, this.trails);
    this.root.add(this.rain);
    this.update(0, false);
  }

  private addAtmosphere(surface: THREE.MeshStandardMaterial, sway = false): void {
    surface.onBeforeCompile = (shader) => {
      shader.uniforms.leafTime = this.wind;
      shader.uniforms.outdoorHaze = this.haze;
      shader.uniforms.horizonColor = { value: this.hazeColor };
      shader.vertexShader = `uniform float leafTime;\nvarying float vOutdoorDepth;\n${shader.vertexShader}`.replace('#include <begin_vertex>', `
        #include <begin_vertex>
        ${sway ? 'transformed.x += sin(leafTime*.8+instanceMatrix[3].x*6.3+instanceMatrix[3].z)*.025*uv.y*uv.y;' : ''}
        vec4 outdoorPosition=vec4(transformed,1.0);
        #ifdef USE_INSTANCING
          outdoorPosition=instanceMatrix*outdoorPosition;
        #endif
        vOutdoorDepth=smoothstep(6.8,13.0,-(modelMatrix*outdoorPosition).z);`);
      shader.fragmentShader = `uniform float outdoorHaze;\nuniform vec3 horizonColor;\nvarying float vOutdoorDepth;\n${shader.fragmentShader}`
        .replace('#include <tonemapping_fragment>', `
          gl_FragColor.rgb=mix(gl_FragColor.rgb,horizonColor,vOutdoorDepth*outdoorHaze);
          #include <tonemapping_fragment>`);
    };
    surface.customProgramCacheKey = () => `quiet-corner-atmosphere-${sway ? 'foliage' : 'ground'}`;
  }

  private buildLandscape(): void {
    const terrain = new THREE.PlaneGeometry(16.5, 8.5, 72, 38);
    terrain.rotateX(-Math.PI / 2);
    terrain.translate(0, 0, -10.3);
    const positions = terrain.getAttribute('position');
    const colors = new Float32Array(positions.count * 3);
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i);
      const z = positions.getZ(i);
      const height = terrainHeight(x, z);
      positions.setY(i, height);
      const shade = 0.7 + height * 0.12 + Math.sin(x * 3 + z * 4) * 0.04;
      colors.set([shade, shade, shade * 0.9], i * 3);
    }
    terrain.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    terrain.computeVertexNormals();
    this.root.add(new THREE.Mesh(terrain, this.groundMaterial));
    const trees = forestLayout();
    this.treeCount = trees.length;
    const foliage = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), this.foliageMaterial, trees.length * 80);
    const branches = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.65, 1, 1, 7), this.barkMaterial, trees.length * 5);
    let leafIndex = 0;
    let branchIndex = 0;
    const transform = new THREE.Object3D();
    const color = new THREE.Color();
    for (const tree of trees) {
      const random = randomSource(tree.seed);
      const base = new THREE.Vector3(tree.x, tree.y, tree.z);
      const h = tree.height;
      const lean = new THREE.Vector3((random() - 0.5) * h * 0.13, 0, (random() - 0.5) * h * 0.08);
      const crownWidth = tree.seed % 4 === 0 ? 0.17 : 0.25;
      for (let branch = 0; branch < 5; branch++) {
        const angle = branch * 2.4 + random() * 0.6;
        const end = base.clone().add(lean).add(new THREE.Vector3(
          branch === 0 ? 0 : Math.cos(angle) * h * crownWidth,
          h * (branch === 0 ? 0.86 : 0.55 + random() * 0.25),
          branch === 0 ? 0 : Math.sin(angle) * h * 0.19));
        const junction = branch === 0 ? 0 : 0.24 + random() * 0.28;
        const start = base.clone().addScaledVector(lean, junction / 0.86).add(new THREE.Vector3(0, h * junction, 0));
        const direction = end.clone().sub(start);
        transform.position.copy(start).addScaledVector(direction, 0.5);
        transform.quaternion.setFromUnitVectors(Y_AXIS, direction.clone().normalize());
        const thickness = h * (branch === 0 ? 0.024 : 0.012);
        transform.scale.set(thickness, direction.length(), thickness);
        transform.updateMatrix();
        branches.setMatrixAt(branchIndex++, transform.matrix);
        for (let leaf = 0; leaf < 16; leaf++) {
          const a = random() * Math.PI * 2;
          const radius = Math.sqrt(random()) * h * 0.22;
          transform.position.copy(end).add(new THREE.Vector3(Math.cos(a) * radius,
            (random() - 0.35) * h * 0.37, Math.sin(a) * radius * 0.75));
          transform.rotation.set((random() - 0.5) * 1.5, (random() - 0.5) * 2.8, random() * Math.PI * 2);
          const size = h * (0.2 + random() * 0.17);
          transform.scale.set(size, size * (0.7 + random() * 0.5), 1);
          transform.updateMatrix();
          foliage.setMatrixAt(leafIndex, transform.matrix);
          const shade = 0.72 + random() * 0.4;
          color.setRGB(shade, shade, shade * (0.83 + random() * 0.14));
          foliage.setColorAt(leafIndex++, color);
        }
      }
    }
    foliage.computeBoundingSphere();
    branches.computeBoundingSphere();
    this.root.add(branches, foliage);
  }

  configure(settings: Settings, daylight: number, warmth: number): void {
    this.weather = settings.weather;
    this.rain.visible = settings.weather !== 'clear';
    this.haze.value = settings.weather === 'clear' ? 0.25 : settings.weather === 'rain' ? 0.48 : 0.62;
    const storybook = settings.mood === 'storybook';
    const daySky = settings.weather === 'clear' ? '#8faebe' : settings.weather === 'rain' ? '#8a9eaa' : '#617887';
    const horizon = settings.weather === 'clear' ? '#d7dece' : settings.weather === 'rain' ? '#b8c3bf' : '#94a6ae';
    this.sky.uniforms.top.value.set(storybook ? '#263250' : '#192d43').lerp(new THREE.Color(storybook ? '#afb9cd' : daySky), daylight);
    this.hazeColor.set('#3b4d61').lerp(new THREE.Color(horizon), daylight);
    if (settings.weather === 'clear') this.hazeColor.lerp(new THREE.Color('#dfb993'), warmth * daylight * 0.28);
    this.sky.uniforms.bottom.value.copy(this.hazeColor);
    this.sky.uniforms.cloudLight.value.set('#465971').lerp(new THREE.Color('#e6e9df'), daylight);
    this.sky.uniforms.cloudShade.value.set('#293b50').lerp(new THREE.Color('#869da5'), daylight);
    this.sky.uniforms.cover.value = settings.weather === 'clear' ? 0.15 : settings.weather === 'rain' ? 0.8 : 1.2;
    this.foliageMaterial.color.set(storybook ? '#7d987b' : '#708b57').multiplyScalar(0.46 + daylight * 0.54);
    this.groundMaterial.color.set(storybook ? '#92a48b' : '#97a37c').multiplyScalar(0.47 + daylight * 0.53);
    this.barkMaterial.color.set('#736654').multiplyScalar(0.55 + daylight * 0.45);
    this.sun.visible = settings.weather === 'clear';
    const phase = (settings.time - 6) / 12 * Math.PI;
    const isDay = daylight > 0.05;
    const altitude = isDay ? daylight : Math.max(0, -Math.sin(phase));
    this.sun.position.set(Math.cos(phase) * (isDay ? 3.6 : -3.6), 2.8 + altitude * 2.2, -12.25);
    this.sun.material.color.set(daylight > 0.05 ? '#fff0ca' : '#c4d3e4');
    this.sun.scale.setScalar(daylight > 0.05 ? 1 : 0.65);
    this.falling.material.opacity = (settings.weather === 'storm' ? 0.62 : 0.44) * (0.55 + daylight * 0.45);
    this.beads.material.opacity = 0.33 + daylight * 0.3;
    this.trails.material.opacity = 0.08 + daylight * 0.09;
  }

  update(elapsed: number, reducedMotion: boolean): void {
    if (!reducedMotion) {
      this.sky.uniforms.time.value = elapsed;
      this.wind.value = elapsed;
    }
    if (!this.rain.visible) return;
    rainPositions(elapsed, this.weather, this.fallPositions);
    this.falling.geometry.attributes.position.needsUpdate = true;
    const random = randomSource(9123);
    const matrix = new THREE.Matrix4();
    const rotation = new THREE.Quaternion();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();
    for (let i = 0; i < GLASS_DROP_COUNT; i++) {
      const x = random() * 6.1 - 3.05;
      const phase = random() * 4.07;
      const speed = i < 18 ? 0.035 + random() * 0.045 : 0;
      const size = 0.025 + random() * 0.039;
      const y = 1.9 + ((phase - elapsed * speed) % 4.07 + 4.07) % 4.07;
      const drift = i < 18 ? Math.sin(elapsed * 0.45 + i) * 0.009 : 0;
      position.set(x + drift, y, GLASS_Z);
      scale.set(size, size * (i < 18 ? 1.8 : 1.2), 1);
      matrix.compose(position, rotation, scale);
      this.beads.setMatrixAt(i, matrix);
      if (i < 18) {
        for (let segment = 0; segment < 3; segment++) {
          const tail = Math.min(6.07 - y, 0.14 + size * 3.5);
          const a = segment / 3;
          const b = (segment + 1) / 3;
          this.trailPositions.set([
            x + drift * (1 - a), y + tail * a, GLASS_Z - 0.002,
            x + drift * (1 - b), y + tail * b, GLASS_Z - 0.002,
          ], i * 18 + segment * 6);
        }
      }
    }
    this.beads.instanceMatrix.needsUpdate = true;
    this.trails.geometry.attributes.position.needsUpdate = true;
  }

  get diagnostics(): { rainVisible: boolean; rainCount: number; windowDroplets: number; trees: number } {
    return { rainVisible: this.rain.visible, rainCount: RAIN_COUNT, windowDroplets: GLASS_DROP_COUNT, trees: this.treeCount };
  }
}
