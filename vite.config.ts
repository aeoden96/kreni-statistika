import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

/**
 * Keep the basemap archive out of the Pages deploy.
 *
 * `public/data/zagreb.pmtiles` is a dev convenience — vite copies publicDir
 * wholesale, so without this it lands in `dist/` at ~35 MB and Cloudflare Pages
 * rejects the deploy on its 25 MiB per-file cap. Production serves the archive
 * from R2 instead (see src/basemap.ts), so nothing in the build refers to the
 * local copy and dropping it is safe.
 */
function stripPmtiles(): Plugin {
  let outDir = 'dist';
  return {
    apply: 'build',
    async closeBundle() {
      const target = join(outDir, 'data', 'zagreb.pmtiles');
      await rm(target, { force: true });
      this.info(`basemap: dropped ${target} — production serves it from R2`);
    },
    configResolved: (c) => void (outDir = c.build.outDir),
    name: 'strip-pmtiles',
  };
}

export default defineConfig({
  // MapLibre is ~1.1 MB minified and is the entire point of the page, so its
  // size is not a surprise worth a warning on every build.
  build: { chunkSizeWarningLimit: 1200 },
  plugins: [stripPmtiles()],
});
