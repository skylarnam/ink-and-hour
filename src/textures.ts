import * as THREE from 'three';
import { PAGE, PAPER_COLORS } from './types.ts';
import type { InkSegment, PaperKind } from './types.ts';
import { fillInkSegment, inkPooling, WetInkMask } from './wet-ink.ts';

export function randomSource(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

export function canvas2D(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('A 2D canvas is needed to make this room\'s procedural textures.');
  return [canvas, context];
}

export function makeWoodTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = canvas2D(1024, 1024);
  const random = randomSource(28);
  ctx.fillStyle = '#c8bdae';
  ctx.fillRect(0, 0, 1024, 1024);
  for (let y = 0; y < 1024; y += 1.2) {
    const shade = Math.floor(85 + random() * 70);
    ctx.strokeStyle = `rgba(${shade},${shade - 8},${shade - 15},${0.06 + random() * 0.15})`;
    ctx.lineWidth = 0.5 + random() * 1.7;
    ctx.beginPath();
    for (let x = 0; x <= 1024; x += 8) {
      const wave = Math.sin(x * 0.008 + y * 0.043) * (2 + 6 * Math.sin(y / 120))
        + Math.sin(x * 0.019 + y * 0.017) * 2;
      if (x === 0) ctx.moveTo(x, y + wave);
      else ctx.lineTo(x, y + wave);
    }
    ctx.stroke();
  }
  for (const y of [254, 515, 774]) {
    ctx.fillStyle = 'rgba(50,38,27,.2)';
    ctx.fillRect(0, y, 1024, 2);
    ctx.fillStyle = 'rgba(255,250,224,.15)';
    ctx.fillRect(0, y + 2, 1024, 1);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1.3, 1.3);
  texture.anisotropy = 8;
  return texture;
}

export function makeLeatherTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = canvas2D(512, 512);
  const random = randomSource(103);
  ctx.fillStyle = '#b7aaa2';
  ctx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 20000; i++) {
    const x = random() * 512;
    const y = random() * 512;
    ctx.strokeStyle = random() > 0.5 ? 'rgba(45,30,24,.13)' : 'rgba(255,245,224,.16)';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 1 + random() * 3, y + random() * 2);
    ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2, 2);
  return texture;
}

export function makeLabelTexture(title: string, subtitle: string): THREE.CanvasTexture {
  const [canvas, ctx] = canvas2D(512, 320);
  ctx.fillStyle = '#e9dcc1';
  ctx.fillRect(0, 0, 512, 320);
  ctx.strokeStyle = '#9b845e';
  ctx.lineWidth = 2;
  ctx.strokeRect(18, 18, 476, 284);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#4d493b';
  ctx.font = '28px Georgia';
  ctx.fillText('INK & HOUR', 256, 86);
  ctx.font = 'italic 48px Georgia';
  ctx.fillText(title, 256, 170);
  ctx.font = '19px sans-serif';
  ctx.fillText(subtitle, 256, 246);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export interface PaperSnapshot {
  readonly paper: PaperKind;
  readonly ink: string;
}

export class PaperSurface {
  readonly canvas: HTMLCanvasElement;
  readonly texture: THREE.CanvasTexture;
  readonly heightTexture: THREE.CanvasTexture;
  readonly roughnessTexture: THREE.CanvasTexture;
  private readonly context: CanvasRenderingContext2D;
  private readonly paperCanvas: HTMLCanvasElement;
  private readonly paperContext: CanvasRenderingContext2D;
  private readonly inkCanvas: HTMLCanvasElement;
  private readonly inkContext: CanvasRenderingContext2D;
  private readonly heightCanvas: HTMLCanvasElement;
  private readonly heightContext: CanvasRenderingContext2D;
  private readonly wetInk: WetInkMask;
  private paper: PaperKind = 'smooth';
  private readonly scale = 2;
  private dirty = false;
  private disposed = false;
  private restoreRevision = 0;

  constructor() {
    [this.canvas, this.context] = canvas2D(PAGE.width * this.scale, PAGE.height * this.scale);
    [this.paperCanvas, this.paperContext] = canvas2D(PAGE.width * this.scale, PAGE.height * this.scale);
    [this.inkCanvas, this.inkContext] = canvas2D(PAGE.width * this.scale, PAGE.height * this.scale);
    [this.heightCanvas, this.heightContext] = canvas2D(780, 1040);
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 8;
    this.texture.generateMipmaps = true;
    this.heightTexture = new THREE.CanvasTexture(this.heightCanvas);
    this.heightTexture.anisotropy = 8;
    const [roughnessCanvas, roughnessContext] = canvas2D(PAGE.width, PAGE.height);
    this.wetInk = new WetInkMask(roughnessContext);
    this.roughnessTexture = new THREE.CanvasTexture(roughnessCanvas);
    this.roughnessTexture.anisotropy = 4;
    this.roughnessTexture.generateMipmaps = false;
    this.roughnessTexture.minFilter = THREE.LinearFilter;
    this.preparePaper();
    this.compose();
  }

  get diagnostics() {
    return {
      ...this.wetInk.diagnostics,
      roughnessVersion: this.roughnessTexture.version,
      colorVersion: this.texture.version,
    } as const;
  }

  get kind(): PaperKind { return this.paper; }

  snapshot(): PaperSnapshot {
    if (this.disposed) throw new Error('This paper surface has closed.');
    return Object.freeze({ paper: this.paper, ink: this.inkCanvas.toDataURL('image/png') });
  }

  async restore(snapshot: PaperSnapshot): Promise<boolean> {
    if (this.disposed) return false;
    if (!snapshot || typeof snapshot.ink !== 'string' || !snapshot.ink.startsWith('data:image/png;base64,')
      || !Object.hasOwn(PAPER_COLORS, snapshot.paper)) {
      throw new Error('This saved page is not a valid local ink snapshot.');
    }
    const revision = ++this.restoreRevision;
    const image = document.createElement('img');
    image.src = snapshot.ink;
    await image.decode();
    if (this.disposed || revision !== this.restoreRevision) return false;
    if (image.naturalWidth !== this.inkCanvas.width || image.naturalHeight !== this.inkCanvas.height) {
      throw new Error('This saved page has an unexpected paper size.');
    }
    this.setPaper(snapshot.paper);
    this.clear();
    this.inkContext.drawImage(image, 0, 0);
    this.compose();
    return true;
  }

  setReducedMotion(reduced: boolean): void {
    if (this.disposed) return;
    if (this.wetInk.setReducedMotion(reduced)) this.roughnessTexture.needsUpdate = true;
  }

  setPaper(paper: PaperKind): void {
    if (this.disposed || paper === this.paper) return;
    this.restoreRevision++;
    this.paper = paper;
    if (this.wetInk.clear()) this.roughnessTexture.needsUpdate = true;
    this.preparePaper();
    this.compose();
  }

  clear(): void {
    if (this.disposed) return;
    this.restoreRevision++;
    if (this.wetInk.clear()) this.roughnessTexture.needsUpdate = true;
    this.inkContext.clearRect(0, 0, this.inkCanvas.width, this.inkCanvas.height);
    this.compose();
  }

  draw(segments: InkSegment[], color: string): void {
    if (this.disposed || !segments.length) return;
    this.restoreRevision++;
    const ctx = this.inkContext;
    ctx.save();
    ctx.scale(this.scale, this.scale);
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const segment of segments) {
      const absorption = this.paper === 'cotton' ? 1.08 : 1;
      const pooling = inkPooling(segment);
      ctx.globalAlpha = (this.paper === 'cotton' ? 0.9 : 0.96) + pooling * 0.032;
      fillInkSegment(ctx, segment, absorption);
      this.wetInk.add(segment, absorption, pooling);
    }
    ctx.restore();
    this.dirty = true;
  }

  flush(deltaSeconds = 0): void {
    if (this.disposed) return;
    if (this.dirty) this.compose();
    if (this.wetInk.flush(deltaSeconds)) this.roughnessTexture.needsUpdate = true;
  }

  private preparePaper(): void {
    const ctx = this.paperContext;
    const w = this.canvas.width;
    const h = this.canvas.height;
    ctx.fillStyle = PAPER_COLORS[this.paper];
    ctx.fillRect(0, 0, w, h);
    const random = randomSource(84);
    const height = this.heightContext;
    height.fillStyle = '#808080';
    height.fillRect(0, 0, this.heightCanvas.width, this.heightCanvas.height);
    if (this.paper === 'cotton') {
      for (let i = 0; i < 1900; i++) {
        const x = random() * w;
        const y = random() * h;
        const radius = 5 + random() * 24;
        const shade = random() > 0.5;
        const patch = ctx.createRadialGradient(x, y, 0, x, y, radius);
        patch.addColorStop(0, shade ? 'rgba(119,108,84,.13)' : 'rgba(255,254,241,.32)');
        patch.addColorStop(1, 'rgba(180,166,138,0)');
        ctx.fillStyle = patch;
        ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
        const relief = height.createRadialGradient(x / 2, y / 2, 0, x / 2, y / 2, radius / 2);
        relief.addColorStop(0, shade ? 'rgba(20,20,20,.32)' : 'rgba(245,245,245,.32)');
        relief.addColorStop(1, 'rgba(128,128,128,0)');
        height.fillStyle = relief;
        height.fillRect((x - radius) / 2, (y - radius) / 2, radius, radius);
      }
    }
    const grain = this.paper === 'smooth' ? 0.025 : this.paper === 'cotton' ? 0.18 : 0.065;
    for (let i = 0; i < 22000; i++) {
      const x = random() * w;
      const y = random() * h;
      ctx.fillStyle = `rgba(101,80,51,${random() * grain})`;
      const fiber = this.paper === 'cotton' ? 3 + random() * 13 : 1 + random() * 2;
      if (this.paper === 'cotton') {
        const angle = random() * Math.PI * 2;
        ctx.strokeStyle = random() > 0.5 ? `rgba(111,101,79,${random() * grain})` : 'rgba(255,255,244,.4)';
        ctx.lineWidth = 0.6 + random() * 1.3;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.quadraticCurveTo(x + fiber * 0.6, y - 2, x + Math.cos(angle) * fiber, y + Math.sin(angle) * fiber);
        ctx.stroke();
        height.strokeStyle = i % 2 ? 'rgba(244,244,244,.3)' : 'rgba(24,24,24,.18)';
        height.lineWidth = 0.6;
        height.beginPath();
        height.moveTo(x / 2, y / 2);
        height.lineTo((x + Math.cos(angle) * fiber) / 2, (y + Math.sin(angle) * fiber) / 2);
        height.stroke();
      } else ctx.fillRect(x, y, fiber, 0.6 + random() * 1.2);
    }
    const vignette = ctx.createRadialGradient(w / 2, h / 2, w / 3, w / 2, h / 2, h * 0.72);
    vignette.addColorStop(0, 'rgba(157,114,58,0)');
    vignette.addColorStop(1, this.paper === 'parchment' ? 'rgba(139,96,39,.13)' : 'rgba(139,96,39,.045)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, w, h);
    ctx.save();
    ctx.scale(this.scale, this.scale);
    ctx.strokeStyle = 'rgba(112,100,77,.09)';
    ctx.lineWidth = 0.65;
    ctx.beginPath();
    ctx.moveTo(78, 93);
    ctx.lineTo(PAGE.width - 78, 93);
    ctx.stroke();
    ctx.fillStyle = 'rgba(102,91,73,.52)';
    ctx.font = '10px Georgia';
    ctx.fillText('INK & HOUR', 80, 76);
    ctx.textAlign = 'right';
    ctx.font = 'italic 11px Georgia';
    ctx.fillText('a moment, kept.', PAGE.width - 80, PAGE.height - 65);
    ctx.restore();
    this.heightTexture.needsUpdate = true;
  }

  private compose(): void {
    this.context.drawImage(this.paperCanvas, 0, 0);
    this.context.drawImage(this.inkCanvas, 0, 0);
    this.texture.needsUpdate = true;
    this.dirty = false;
  }

  exportPNG(filename = 'ink-and-hour.png'): void {
    this.flush();
    const link = document.createElement('a');
    link.download = filename;
    link.href = this.canvas.toDataURL('image/png');
    link.click();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.restoreRevision++;
    this.wetInk.dispose();
    this.texture.dispose();
    this.heightTexture.dispose();
    this.roughnessTexture.dispose();
  }
}
