import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';

export default defineConfig({
  plugins: [{
    name: 'distribution-notices',
    generateBundle() {
      for (const [fileName, source] of [
        ['THIRD_PARTY_NOTICES.md', './THIRD_PARTY_NOTICES.md'],
        ['THREE-LICENSE.txt', './node_modules/three/LICENSE'],
      ]) {
        this.emitFile({ type: 'asset', fileName, source: readFileSync(new URL(source, import.meta.url), 'utf8') });
      }
    },
  }],
});
