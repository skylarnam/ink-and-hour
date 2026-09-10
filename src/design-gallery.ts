import './design-gallery.css';
import { DESIGN_DIRECTIONS } from './designs.ts';

const root = document.querySelector<HTMLDivElement>('#design-gallery');
if (!root) throw new Error('The design gallery container is missing.');
root.innerHTML = `
  <header class="gallery-header"><a href="/" class="gallery-brand">Ink &amp; Hour<span>DESIGN STUDIES</span></a><span>FIVE DIRECTIONS / ONE RITUAL</span><a href="/" class="back-link">Back to your desk <span aria-hidden="true">&nearr;</span></a></header>
  <main>
    <section class="gallery-intro">
      <div class="folio">VISUAL EXPLORATIONS<br><span>FIRST SERIES &mdash; 2026</span></div>
      <h1>Different rooms.<br><em>Same little ritual.</em></h1>
      <div class="intro-note"><p>Less interface.<br>More <span>somewhere.</span></p><small>Five different approaches to type, space, material, and mood. Not five coats of paint.</small></div>
    </section>
    <section class="gallery-contract" aria-label="About these mockups"><span>KEEP THE FEELING. CHANGE THE FRAME.</span><p>Every direction is a working visual mockup: the same pen, writing engine, camera, materials, and sound controls. Preview freely &mdash; these rooms do not overwrite your saved preferences or replace the original site.</p></section>
    <div class="directions">
      ${DESIGN_DIRECTIONS.map((design) => `
        <article class="direction" id="${design.id}">
          <div class="direction-top"><span class="direction-number">${design.number}</span><span>${design.tags.join(' / ').toUpperCase()}</span><div class="palette" aria-label="Color palette">${design.colors.map((color) => `<i style="background:${color}"></i>`).join('')}</div></div>
          <a class="preview-link" href="/?design=${design.id}" aria-label="Open ${design.name} working mockup"><img src="/design-previews/${design.id}.jpg" alt="${design.name}: ${design.theme}" width="1440" height="944" ${design.number !== '01' ? 'loading="lazy"' : ''}><span class="open-preview">Explore this direction <b aria-hidden="true">&nearr;</b></span></a>
          <div class="direction-copy"><div><h2><a href="/?design=${design.id}">${design.name}</a></h2><p class="direction-theme">${design.theme}</p></div><p>${design.description}</p></div>
        </article>
      `).join('')}
    </div>
    <section class="gallery-outro"><span>THE DESIGN QUESTION</span><h2>What kind of room<br>would you stay in?</h2><p>Nocturne makes the strongest break from the current layout. The Listening Room puts the ASMR idea most clearly at the center. Airmail is the most personal and paper-like; Atelier the most graphic; Daydream the most playful.</p><a href="/">Return to the original ritual &nearr;</a></section>
  </main>
  <footer class="gallery-footer"><span>INK &amp; HOUR / A LITTLE INK. A LITTLE TIME.</span><span>Original geometry. Local fonts. No stock imagery.</span></footer>
`;
