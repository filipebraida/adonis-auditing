import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: [
    './index.ts',
    './configure.ts',
    './services/auditing.ts',
    './providers/auditing_provider.ts',
    './src/types.ts',
    './src/errors.ts',
    './stubs/main.ts',
  ],
  outDir: './build',
  unbundle: true,
  clean: true,
  format: 'esm',
  minify: 'dce-only',
  fixedExtension: false,
  dts: false,
  treeshake: false,
  target: 'esnext',
})
