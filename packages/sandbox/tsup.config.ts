import { defineConfig } from "tsup";
import { raw } from "esbuild-raw-plugin";

export default defineConfig({
    entry: ["src/index.ts"],
    format: ["esm"],
    dts: true,
    sourcemap: true,
    clean: true,
    target: "es2022",
    treeshake: true,
    external: ["quickjs-emscripten"],
    noExternal: ["polyfill", "communication-protocol"],
    esbuildPlugins: [
        // @ts-ignore | esbuild-raw-plugin version compat
        raw(),
    ],
});
