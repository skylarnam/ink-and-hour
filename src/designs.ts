import type { Settings } from './types.ts';

export interface DesignDirection {
  id: string;
  number: string;
  name: string;
  theme: string;
  description: string;
  headline: string;
  detail: string;
  tags: string[];
  colors: string[];
  settings: Partial<Settings>;
  initialTab: 'tools' | 'room' | 'sound';
}

export const DESIGN_DIRECTIONS: readonly DesignDirection[] = [
  {
    id: 'nocturne', number: '01', name: 'Nocturne', theme: 'A room after the world goes quiet.',
    description: 'An almost-black cinematic room, oversized literary type, and a slim floating console. The scene takes the whole screen; the interface feels like the credits of a very quiet film.',
    headline: 'For the\nquiet hours.', detail: 'AN AFTER-HOURS WRITING ROOM',
    tags: ['Cinematic', 'Immersive', 'Nightfall'], colors: ['#111a22', '#bcb9a8', '#d5a577'],
    settings: { mood: 'study', time: 22, weather: 'rain', ink: 'sepia' }, initialTab: 'tools',
  },
  {
    id: 'airmail', number: '02', name: 'The Airmail Club', theme: 'A postcard to nobody in particular.',
    description: 'Vermilion ink, postal marks, paper edges, and a generous newspaper masthead. A slightly off-kilter desk photograph sits beside your note, like things collected in a travel journal.',
    headline: 'Dear\nanywhere,', detail: 'NO ADDRESS. NO DEADLINE.',
    tags: ['Editorial', 'Collected', 'Paper-first'], colors: ['#f1e6cf', '#a53629', '#253e64'],
    settings: { mood: 'atelier', time: 16.5, weather: 'clear', ink: 'burgundy', paper: 'parchment' }, initialTab: 'tools',
  },
  {
    id: 'atelier', number: '03', name: 'Atelier 04', theme: 'A small practice in paying attention.',
    description: 'Gallery-white space, acid-yellow labels, hard rules, and confident sans-serif typography. Tools live in a horizontal workbench instead of a sidebar. Precise without feeling like software.',
    headline: 'Less doing.\nMore noticing.', detail: 'OBJECT STUDY / PEN, PAPER, TIME',
    tags: ['Graphic', 'Architectural', 'Daylight'], colors: ['#eceee5', '#20251e', '#d7ec49'],
    settings: { mood: 'atelier', time: 11, weather: 'clear', ink: 'midnight', style: 'print' }, initialTab: 'tools',
  },
  {
    id: 'daydream', number: '04', name: 'Daydream Department', theme: 'Officially out of office. Emotionally here.',
    description: 'Powder blue, apricot, grape-colored ink, hand-drawn flowers, and friendly rounded shapes. The desk is a little diorama inside a playful window, not a panel in a dashboard.',
    headline: 'Make room\nfor a daydream.', detail: 'DEPARTMENT OF VERY LITTLE PLANS',
    tags: ['Playful', 'Tactile', 'Storybook'], colors: ['#c9dfe9', '#574163', '#f4a975'],
    settings: { mood: 'storybook', time: 14, weather: 'clear', ink: 'burgundy', paper: 'smooth' }, initialTab: 'tools',
  },
  {
    id: 'listening', number: '05', name: 'The Listening Room', theme: 'Put a record on. Or just the pen.',
    description: 'A warm analog instrument: walnut edges, brushed-metal controls, amber meter faces, and tactile transport buttons. The mixer is the starting point. ASMR is the identity, not an extra tab.',
    headline: 'Ink has\na sound.', detail: 'HIGH FIDELITY / LOW EXPECTATIONS',
    tags: ['Analog', 'Sound-first', 'Warm'], colors: ['#34281f', '#c8c2aa', '#dcab59'],
    settings: { mood: 'study', time: 18.5, weather: 'rain', ink: 'sepia' }, initialTab: 'sound',
  },
];

export function findDesign(id: string | null): DesignDirection | undefined {
  return DESIGN_DIRECTIONS.find((design) => design.id === id);
}

export function presentDesign(design: DesignDirection): void {
  document.documentElement.dataset.design = design.id;
  document.title = `${design.name} - Ink & Hour design study`;
  const index = DESIGN_DIRECTIONS.indexOf(design);
  const previous = DESIGN_DIRECTIONS[(index + DESIGN_DIRECTIONS.length - 1) % DESIGN_DIRECTIONS.length];
  const next = DESIGN_DIRECTIONS[(index + 1) % DESIGN_DIRECTIONS.length];
  const review = document.createElement('nav');
  review.className = 'design-review';
  review.setAttribute('aria-label', 'Design study navigation');
  review.innerHTML = `<a href="/designs.html">All five directions</a><span>DESIGN STUDY ${design.number} / ${design.name}</span><div><a href="/?design=${previous.id}" aria-label="Previous design: ${previous.name}">Previous</a><a href="/?design=${next.id}" aria-label="Next design: ${next.name}">Next</a><a href="/">Original site</a></div>`;
  document.body.prepend(review);
  const stage = document.querySelector('.stage');
  const title = document.createElement('div');
  title.className = 'design-title';
  const eyebrow = document.createElement('span');
  eyebrow.textContent = design.detail;
  const heading = document.createElement('h2');
  heading.textContent = design.headline;
  title.append(eyebrow, heading);
  stage?.prepend(title);
  const thought = document.querySelector('.header-thought');
  if (thought) thought.textContent = design.theme;
  const mark = document.createElement('div');
  mark.className = 'design-object';
  mark.setAttribute('aria-hidden', 'true');
  if (design.id === 'airmail') {
    mark.innerHTML = '<span>THE AIRMAIL CLUB</span><strong>NO<br>RUSH</strong><small>INK & HOUR / 2026</small>';
  } else if (design.id === 'daydream') {
    mark.innerHTML = '<svg viewBox="0 0 120 120"><path d="M60 29C76 0 96 17 83 42c31-7 40 19 12 28 21 21 1 42-22 23-2 32-32 32-35 1C14 114-5 91 18 72-12 59 1 33 29 42 19 12 46 4 60 29Z"/><circle cx="58" cy="62" r="20"/><path d="M51 62h1m12 0h1m-14 8q7 8 14 0"/></svg><span>No big plans.</span>';
  } else if (design.id === 'listening') {
    mark.innerHTML = '<span>STEREOPHONIC WRITING SYSTEM</span><div class="analog-meters"><div><i></i><small>PEN / VU</small></div><div><i></i><small>ROOM / VU</small></div></div><b>IH-01 <span>STUDIO SERIES</span></b>';
  } else if (design.id === 'atelier') {
    mark.innerHTML = '<b>04</b><span>AN EXERCISE<br>IN STILLNESS</span>';
  } else {
    mark.innerHTML = '<span>EST. IN THE PRESENT</span><i></i><b>STAY A LITTLE LONGER</b>';
  }
  stage?.append(mark);
}
