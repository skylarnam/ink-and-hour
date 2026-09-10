import * as THREE from 'three';
import { INKS, PAGE, PAPER_COLORS } from './types.ts';
import type { InkId, InkSegment, PaperKind } from './types.ts';

export function randomSource(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function canvas2D(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('A 2D canvas is needed to make the paper and ink.');
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

export class PaperSurface {
  readonly canvas: HTMLCanvasElement;
  readonly texture: THREE.CanvasTexture;
  private readonly context: CanvasRenderingContext2D;
  private readonly paperCanvas: HTMLCanvasElement;
  private readonly paperContext: CanvasRenderingContext2D;
  private readonly inkCanvas: HTMLCanvasElement;
  private readonly inkContext: CanvasRenderingContext2D;
  private paper: PaperKind = 'smooth';
  private readonly scale = 2;
  private dirty = false;

  constructor() {
    [this.canvas, this.context] = canvas2D(PAGE.width * this.scale, PAGE.height * this.scale);
    [this.paperCanvas, this.paperContext] = canvas2D(PAGE.width * this.scale, PAGE.height * this.scale);
    [this.inkCanvas, this.inkContext] = canvas2D(PAGE.width * this.scale, PAGE.height * this.scale);
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 8;
    this.texture.generateMipmaps = true;
    this.preparePaper();
    this.compose();
  }

  setPaper(paper: PaperKind): void {
    if (paper === this.paper) return;
    this.paper = paper;
    this.preparePaper();
    this.compose();
  }

  clear(): void {
    this.inkContext.clearRect(0, 0, this.inkCanvas.width, this.inkCanvas.height);
    this.compose();
  }

  draw(segments: InkSegment[], ink: InkId): void {
    if (!segments.length) return;
    const ctx = this.inkContext;
    ctx.save();
    ctx.scale(this.scale, this.scale);
    ctx.fillStyle = INKS[ink].color;
    ctx.strokeStyle = INKS[ink].color;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const segment of segments) {
      const { from, to, fromWidth, toWidth } = segment;
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const length = Math.hypot(dx, dy);
      const nx = length > 0 ? -dy / length : 0;
      const ny = length > 0 ? dx / length : 1;
      const w0 = Math.max(0.4, fromWidth) / 2;
      const w1 = Math.max(0.4, toWidth) / 2;
      ctx.globalAlpha = this.paper === 'cotton' ? 0.9 : 0.96;
      ctx.beginPath();
      ctx.moveTo(from.x + nx * w0, from.y + ny * w0);
      ctx.lineTo(to.x + nx * w1, to.y + ny * w1);
      ctx.lineTo(to.x - nx * w1, to.y - ny * w1);
      ctx.lineTo(from.x - nx * w0, from.y - ny * w0);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.arc(to.x, to.y, w1, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    this.dirty = true;
  }

  flush(): void {
    if (this.dirty) this.compose();
  }

  private preparePaper(): void {
    const ctx = this.paperContext;
    const w = this.canvas.width;
    const h = this.canvas.height;
    ctx.fillStyle = PAPER_COLORS[this.paper];
    ctx.fillRect(0, 0, w, h);
    const random = randomSource(84);
    const grain = this.paper === 'smooth' ? 0.035 : this.paper === 'cotton' ? 0.08 : 0.065;
    for (let i = 0; i < 22000; i++) {
      const x = random() * w;
      const y = random() * h;
      ctx.fillStyle = `rgba(101,80,51,${random() * grain})`;
      const fiber = this.paper === 'cotton' ? 1 + random() * 5 : 1 + random() * 2;
      ctx.fillRect(x, y, fiber, 0.6 + random() * 1.2);
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
  }

  private compose(): void {
    this.context.drawImage(this.paperCanvas, 0, 0);
    this.context.drawImage(this.inkCanvas, 0, 0);
    this.texture.needsUpdate = true;
    this.dirty = false;
  }

  exportPNG(): void {
    this.flush();
    const link = document.createElement('a');
    link.download = 'ink-and-hour.png';
    link.href = this.canvas.toDataURL('image/png');
    link.click();
  }

  dispose(): void {
    this.texture.dispose();
  }
}
