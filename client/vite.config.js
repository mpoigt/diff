import { defineConfig } from 'vite';

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  define: {
    'import.meta.env.VITE_APP_REVISION': JSON.stringify(process.env.COMMIT_REF || process.env.APP_REVISION || 'local'),
  },
  plugins: [{
    name: 'deployment-revision',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify({ release: process.env.COMMIT_REF || process.env.APP_REVISION || 'local' }),
      });
    },
  }],
});
