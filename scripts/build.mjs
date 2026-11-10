// Bundles the action's two entry points into dist/ as self-contained ESM files.
import { build } from 'esbuild';

await build({
  entryPoints: { main: 'src/main.ts', post: 'src/post.ts' },
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  minify: false,
  sourcemap: false,
  legalComments: 'none',
  // Some bundled CommonJS dependencies call require() on Node built-ins.
  banner: {
    js: "import { createRequire as __suiiCreateRequire } from 'node:module';\nconst require = __suiiCreateRequire(import.meta.url);",
  },
  logLevel: 'info',
});
