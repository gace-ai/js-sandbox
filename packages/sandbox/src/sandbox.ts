import type { QuickJSContext, QuickJSHandle } from 'quickjs-emscripten';
import { Bridge } from './bridge';
import { ReferenceRegistry } from './registry';
import { createRef, createMutableRef, createValue, createNamespace } from './wrappers';
import type {
    SandboxRef,
    SandboxMutableRef,
    SandboxValue,
    SandboxNamespace,
    SandboxOptions,
    InterceptorFn,
} from './types';

// @ts-ignore — imported as raw string via esbuild-raw-plugin
import polyfillSource from '../../polyfill/dist/make-proxy.global.js?raw';

/**
 * Minimal environment polyfills for QuickJS.
 * Provides TextEncoder, TextDecoder — all required by @msgpack/msgpack.
 */
const envPolyfill = `
;(() => {
    if (typeof TextEncoder === 'undefined') {
        globalThis.TextEncoder = class TextEncoder {
            encode(str) {
                const utf8 = [];
                for (let i = 0; i < str.length; i++) {
                    let code = str.charCodeAt(i);
                    if (code >= 0xD800 && code <= 0xDBFF && i + 1 < str.length) {
                        const next = str.charCodeAt(i + 1);
                        if (next >= 0xDC00 && next <= 0xDFFF) {
                            code = ((code - 0xD800) << 10) + (next - 0xDC00) + 0x10000;
                            i++;
                        }
                    }
                    if (code < 0x80) {
                        utf8.push(code);
                    } else if (code < 0x800) {
                        utf8.push(0xC0 | (code >> 6), 0x80 | (code & 0x3F));
                    } else if (code < 0x10000) {
                        utf8.push(0xE0 | (code >> 12), 0x80 | ((code >> 6) & 0x3F), 0x80 | (code & 0x3F));
                    } else {
                        utf8.push(0xF0 | (code >> 18), 0x80 | ((code >> 12) & 0x3F), 0x80 | ((code >> 6) & 0x3F), 0x80 | (code & 0x3F));
                    }
                }
                return new Uint8Array(utf8);
            }
        };
    }

    if (typeof TextDecoder === 'undefined') {
        globalThis.TextDecoder = class TextDecoder {
            decode(bytes) {
                if (!bytes) return '';
                const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
                let str = '';
                for (let i = 0; i < u8.length;) {
                    let code;
                    if (u8[i] < 0x80) {
                        code = u8[i++];
                    } else if ((u8[i] & 0xE0) === 0xC0) {
                        code = ((u8[i++] & 0x1F) << 6) | (u8[i++] & 0x3F);
                    } else if ((u8[i] & 0xF0) === 0xE0) {
                        code = ((u8[i++] & 0x0F) << 12) | ((u8[i++] & 0x3F) << 6) | (u8[i++] & 0x3F);
                    } else {
                        code = ((u8[i++] & 0x07) << 18) | ((u8[i++] & 0x3F) << 12) | ((u8[i++] & 0x3F) << 6) | (u8[i++] & 0x3F);
                        if (code > 0xFFFF) {
                            code -= 0x10000;
                            str += String.fromCharCode(0xD800 + (code >> 10), 0xDC00 + (code & 0x3FF));
                            continue;
                        }
                    }
                    str += String.fromCharCode(code);
                }
                return str;
            }
        };
    }
})();
`;

export class Sandbox {
    private vm: QuickJSContext;
    private bridge: Bridge;
    private registry: ReferenceRegistry;
    private pendingHandles: QuickJSHandle[] = [];

    constructor(opts: SandboxOptions) {
        this.vm = opts.vm;
        this.registry = new ReferenceRegistry();
        this.bridge = new Bridge(this.vm, this.registry);
    }

    ref<T>(target: T): SandboxRef<T> {
        return createRef(target);
    }

    mutableRef<T>(target: T): SandboxMutableRef<T> {
        return createMutableRef(target);
    }

    value<T>(target: T): SandboxValue<T> {
        return createValue(target);
    }

    obj(shape: Record<string, unknown>): SandboxNamespace {
        return createNamespace(shape);
    }

    namespace(shape: Record<string, unknown>): SandboxNamespace {
        return createNamespace(shape);
    }

    /**
     * Expose an API to the sandbox's globalThis.
     */
    expose(api: Record<string, unknown>): void {
        this.bridge.init(api);
        this.injectPolyfill();
        this.setupGlobalBindings(api);
    }

    evalCode(code: string): void {
        const result = this.vm.evalCode(code);
        if (result.error) {
            const err = this.vm.dump(result.error);
            result.error.dispose();
            throw new Error(`Sandbox execution error: ${JSON.stringify(err)}`);
        }
        result.dispose();
    }

    /**
     * Evaluate code that may return a Promise (e.g. async tool functions).
     *
     * If the eval result is a QuickJS promise, host-side `.then`/`.catch`
     * callbacks are attached and `executePendingJobs` is called so the
     * async chain (including host-initiated promise resolutions from the
     * bridge) can settle.
     */
    async evalCodeAsync(code: string): Promise<unknown> {
        const result = this.vm.evalCode(code);
        if (result.error) {
            const err = this.vm.dump(result.error);
            result.error.dispose();
            throw new Error(`Sandbox execution error: ${JSON.stringify(err)}`);
        }

        return this.resolveHandle(result.value);
    }

    /**
     * Call a function defined on the sandbox's globalThis and resolve its
     * return value, awaiting it if it is a QuickJS promise.
     */
    async callFunction(name: string, ...args: unknown[]): Promise<unknown> {
        const fn = this.vm.getProp(this.vm.global, name);

        const argHandles: QuickJSHandle[] = args.map((arg) => {
            if (arg === undefined) return this.vm.undefined;
            if (arg === null) return this.vm.null;
            const json = JSON.stringify(arg);
            const parsed = this.vm.evalCode(`(${json})`);
            if (parsed.error) {
                parsed.error.dispose();
                return this.vm.undefined;
            }
            return parsed.value;
        });

        const callResult = this.vm.callFunction(fn, this.vm.global, ...argHandles);

        for (const h of argHandles) h.dispose();
        fn.dispose();

        if (callResult.error) {
            const err = this.vm.dump(callResult.error);
            callResult.error.dispose();
            throw new Error(`Sandbox call error: ${JSON.stringify(err)}`);
        }

        return this.resolveHandle(callResult.value);
    }

    private async resolveHandle(handle: QuickJSHandle): Promise<unknown> {
        const thenProp = this.vm.getProp(handle, 'then');
        const isPromise = this.vm.typeof(thenProp) === 'function';
        thenProp.dispose();

        if (!isPromise) {
            const value = this.vm.dump(handle);
            handle.dispose();
            return value;
        }

        return new Promise<unknown>((resolve, reject) => {
            const onResolve = this.vm.newFunction('__evalResolve', (valHandle: QuickJSHandle) => {
                resolve(this.vm.dump(valHandle));
            });

            const onReject = this.vm.newFunction('__evalReject', (errHandle: QuickJSHandle) => {
                const err = this.vm.dump(errHandle);
                reject(new Error(typeof err === 'string' ? err : JSON.stringify(err)));
            });

            const thenMethod = this.vm.getProp(handle, 'then');
            const thenResult = this.vm.callFunction(thenMethod, handle, onResolve, onReject);
            thenMethod.dispose();

            if (thenResult.error) {
                const err = this.vm.dump(thenResult.error);
                thenResult.error.dispose();
                reject(new Error(JSON.stringify(err)));
            } else {
                thenResult.value.dispose();
            }

            handle.dispose();
            this.pendingHandles.push(onResolve, onReject);
            this.vm.runtime.executePendingJobs();
        });
    }

    private injectPolyfill(): void {
        // Inject environment polyfills first (btoa, atob, TextEncoder, TextDecoder)
        this.evalCode(envPolyfill);
        // Then inject the main polyfill IIFE
        this.evalCode(polyfillSource);
    }

    private setupGlobalBindings(api: Record<string, unknown>): void {
        const keys = Object.keys(api);

        const setupCode = keys.map(key => `
            globalThis.${key} = __polyfill.handleResponse(
                __polyfill.invoke('get', '${key}'),
                '${key}'
            );
        `).join('\n');

        this.evalCode(setupCode);
    }

    dispose(): void {
        for (const h of this.pendingHandles) {
            h.dispose();
        }
        this.pendingHandles = [];
        this.bridge.dispose();
        this.registry.clear();
    }
}
