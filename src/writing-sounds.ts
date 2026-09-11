// Dependency-free registry of selectable writing-sound palettes. These are listening-palette
// names for an original synthesis experiment, not claims about recorded or real pen materials.

export interface WritingSoundDescriptor {
  readonly id: string;
  readonly label: string;
  readonly description: string;
}

export const WRITING_SOUNDS = [
  {
    id: 'textured',
    label: 'Textured',
    description: 'An irregular contact texture that responds to pressure, paper and nib. The default.',
  },
  {
    id: 'original',
    label: 'Original',
    description: 'Original restores the previous pen sound, a single filtered friction layer.',
  },
  {
    id: 'soft-glide',
    label: 'Soft glide',
    description: 'A smoother glide with restrained fiber detail, softer and narrower than Textured.',
  },
  {
    id: 'fine-feedback',
    label: 'Fine feedback',
    description: 'Finer, pencil-like feedback: brighter and busier detail over a quieter body.',
  },
  {
    id: 'dry-fibers',
    label: 'Dry fibers',
    description: 'Coarser, clearly separated fiber drag with longer pauses between patches.',
  },
  {
    id: 'warm-paper',
    label: 'Warm paper',
    description: 'A darker, broad rubbing body with only faint fiber accents beneath it.',
  },
  {
    id: 'crisp-nib',
    label: 'Crisp nib',
    description: 'Compact, brighter fine-nib scratch detail over a restrained, narrow body.',
  },
] as const satisfies readonly WritingSoundDescriptor[];

export type WritingSoundId = (typeof WRITING_SOUNDS)[number]['id'];

/** Every contact-texture palette, i.e. every writing sound except the single-layer Original. */
export type ContactSoundId = Exclude<WritingSoundId, 'original'>;

export const WRITING_SOUND_IDS: readonly WritingSoundId[] = WRITING_SOUNDS.map((sound) => sound.id);

export function isWritingSoundId(value: string): value is WritingSoundId {
  return WRITING_SOUND_IDS.some((id) => id === value);
}

export function writingSoundDescriptor(id: WritingSoundId): WritingSoundDescriptor {
  const sound = WRITING_SOUNDS.find((entry) => entry.id === id);
  if (!sound) throw new Error(`Unknown writing sound: ${id}`);
  return sound;
}
