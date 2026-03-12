import { getQuickJS } from 'quickjs-emscripten';
import type { QuickJSWASMModule } from 'quickjs-emscripten';
import { Sandbox, type InterceptorFn } from 'sandbox';

export type { InterceptorFn };

/**
 * Initialize the QuickJS engine.
 */
export async function initSandbox(): Promise<QuickJSWASMModule> {
    return await getQuickJS();
}

/**
 * Run code in a sandboxed QuickJS context using the new generic sandbox library.
 * Exposes `document` as a mutable reference into the sandbox.
 */
export function runInSandbox(
    qjs: QuickJSWASMModule,
    code: string,
    interceptors: InterceptorFn[] = [],
) {
    const vm = qjs.newContext();
    const s = new Sandbox({ vm });

    try {
        s.expose({
            document: s.mutableRef(document),
            console: { log: console.log },
            sdk: {
                getWindow: () => window,
            },
        });

        // Add interceptors if any
        // Note: In the new architecture, interceptors are attached per-ref via the wrappers.
        // For a quick PoC, we attach them directly.

        s.evalCode(code);
    } finally {
        s.dispose();
        vm.dispose();
    }
}
