import { fileURLToPath } from 'node:url';
import { joinSession, createCanvas } from '@github/copilot-sdk/extension';
import { ReviewStore, SELECTION_FILE } from '../../../font-review/store.mjs';
import { startReviewServer } from '../../../font-review/server.mjs';

const store = new ReviewStore(fileURLToPath(new URL('../../../', import.meta.url)));
const servers = new Map();

const session = await joinSession({
  canvases: [createCanvas({
    id: 'ink-font-review',
    displayName: 'Handwriting shortlist',
    description: 'Review 100 real font samples and save checked candidates to the project selection file.',
    inputSchema: {
      type: 'object', properties: { file: { const: SELECTION_FILE } },
      required: ['file'], additionalProperties: false,
    },
    actions: [{
      name: 'read_selection',
      description: 'Read the checked fonts and their durable project file; this does not apply them to the website.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      handler: () => store.summary(),
    }, {
      name: 'read_render_status',
      description: 'Read the actual checklist frame font-loading, binding and saved-state diagnostics.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      handler: (ctx) => ({ received: Boolean(servers.get(ctx.instanceId)?.renderStatus),
        ...servers.get(ctx.instanceId)?.renderStatus }),
    }],
    open: async (ctx) => {
      await store.read();
      let entry = servers.get(ctx.instanceId);
      if (!entry) {
        entry = await startReviewServer(store, (error) => {
          session.log(`Font checklist: ${error.message}`, { level: 'error' });
        });
        servers.set(ctx.instanceId, entry);
      }
      return { title: '100 handwriting candidates', url: entry.url };
    },
    onClose: async (ctx) => {
      const entry = servers.get(ctx.instanceId);
      if (entry) {
        servers.delete(ctx.instanceId);
        await entry.close();
      }
    },
  })],
});
