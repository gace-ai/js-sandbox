import type { QuickJSContext } from 'quickjs-emscripten';
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
        this.bridge.dispose();
        this.registry.clear();
    }
}
