import { defineConfig } from 'tsup';

export default defineConfig({
    entry: ['src/make-proxy.ts'],
    format: ['iife'],
    globalName: '__polyfill',
    outDir: 'dist',
    bundle: true,
    minify: false,
    sourcemap: false,
    // Bundle all dependencies into the IIFE (communication-protocol + @msgpack/msgpack)
    noExternal: [/.*/],
    platform: 'neutral',
    target: 'es2022',
    clean: true,
});
