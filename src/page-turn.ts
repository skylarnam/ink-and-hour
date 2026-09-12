export interface PageTurnPose {
  lift: number;
  slide: number;
  rotation: number;
  opacity: number;
}

const rest = (): PageTurnPose => ({ lift: 0, slide: 0, rotation: 0, opacity: 1 });
const ease = (value: number): number => value * value * (3 - 2 * value);

export function pageTurnPose(progress: number | null, reducedMotion = false): PageTurnPose {
  if (progress !== null && !Number.isFinite(progress)) throw new RangeError('Page turning needs finite progress.');
  if (progress === null || reducedMotion) return rest();
  const p = Math.max(0, Math.min(1, progress));
  if (p === 0 || p === 1) return rest();
  if (p < 0.5) {
    const amount = ease(p * 2);
    return { lift: 0.05 * Math.sin(Math.PI * amount), slide: 0.6 * amount, rotation: -0.035 * amount, opacity: 1 - amount };
  }
  const amount = ease((p - 0.5) * 2);
  return { lift: 0.03 * Math.sin(Math.PI * amount), slide: -0.5 * (1 - amount), rotation: 0.025 * (1 - amount), opacity: amount };
}
