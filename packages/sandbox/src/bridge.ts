import type { QuickJSContext, QuickJSHandle } from 'quickjs-emscripten';
import { Ref, MutableRef, Namespace, FunctionMarker, serializeHost, deserializeHost } from 'communication-protocol';
import { ReferenceRegistry } from './registry';
import { runInterceptors } from './interceptor';
import { resolveValueForSandbox, resolveErrorForSandbox } from './decision-tree';
import type { InterceptorOp, RefMode } from './types';
import { isSandboxNamespace, isSandboxRef, isSandboxMutableRef, isSandboxValue } from './types';
import { assertSafeProp } from './security';

/**
 * The bridge between the host and QuickJS sandbox.
 * Registers `__sandbox_invoke` on the VM global scope and handles
 * all get/set/call/release operations.
 */
export class Bridge {
    private registry: ReferenceRegistry;
    private handles: QuickJSHandle[] = [];
    private exposedNamespace: Record<string, unknown> = {};

    constructor(
        private vm: QuickJSContext,
        registry: ReferenceRegistry,
    ) {
        this.registry = registry;
    }

    /**
     * Register the exposed API namespace shape and install __sandbox_invoke on the VM.
     */
    init(namespace: Record<string, unknown>): void {
        this.exposedNamespace = namespace;
        this.installInvokeHook();
    }

    /**
     * Resolve a ref inside the host — used by communication-protocol's deserializer.
     */
    private resolveRef = (ref: Ref): unknown => {
        const entry = this.registry.get(ref.value);
        return entry?.target;
    };

    /**
     * Parse a target string into its components.
     * "#47.text" → { refId: 47, prop: "text" }
     * "sdk.http.get" → { path: ["sdk", "http", "get"] }
     */
    private parseTarget(target: string): { refId: number; prop: string } | { path: string[] } {
        if (target.startsWith('#')) {
            const dotIndex = target.indexOf('.');
            if (dotIndex === -1) {
                // Just a ref, no property (for direct calls like #47)
                return { refId: parseInt(target.slice(1), 10), prop: '' };
            }
            const refId = parseInt(target.slice(1, dotIndex), 10);
            const prop = target.slice(dotIndex + 1);
            return { refId, prop };
        }
        return { path: target.split('.') };
    }

    private walkNamespace(
        path: string[],
    ): { value: unknown; parentMode: RefMode } {
        let current: unknown = this.exposedNamespace;
        let parentMode: RefMode = 'ref';

        for (const segment of path) {
            assertSafeProp(segment);
            if (current === null || current === undefined) {
                return { value: undefined, parentMode };
            }

            // If current is a namespace wrapper, walk into its shape
            if (isSandboxNamespace(current)) {
                current = current.shape[segment];
                continue;
            }

            // If current is a ref/mutableRef wrapper, unwrap it to continue path resolution
            if (isSandboxRef(current)) {
                parentMode = 'ref';
                current = current.target;
            } else if (isSandboxMutableRef(current)) {
                parentMode = 'mutableRef';
                current = current.target;
            } else if (isSandboxValue(current)) {
                // If it's a SandboxValue, just unwrap it
                current = current.target;
            }

            // Now current is unwrapped (if it was a wrapper). Proceed to index into it.
            if (typeof current === 'object' && current !== null && !Array.isArray(current)) {
                current = (current as Record<string, unknown>)[segment];
                continue;
            }

            // If it's something we can't index into but we are not on the last segment, it's an error.
            // If we are indexing into a string or array, that might also be valid.
            if (current !== null && current !== undefined) {
                current = (current as any)[segment];
                continue;
            }

            // Plain object — treat as namespace (auto s.obj())
            if (typeof current === 'object' && current !== null && !Array.isArray(current)) {
                current = (current as Record<string, unknown>)[segment];
                continue;
            }

            // Anything else — unexpected
            return { value: undefined, parentMode };
        }

        // Final unwrap if the terminal value is a wrapper
        if (isSandboxRef(current)) {
            parentMode = 'ref';
            current = current.target;
        } else if (isSandboxMutableRef(current)) {
            parentMode = 'mutableRef';
            current = current.target;
        } else if (isSandboxValue(current)) {
            current = current.target;
        }

        // We've walked the full path, resolve the terminal value
        return { value: current, parentMode };
    }

    /**
     * Handle a single __sandbox_invoke call.
     */
    private handleInvoke(
        action: string,
        target: string,
        payloadBytes?: Uint8Array,
    ): Uint8Array | Promise<Uint8Array> {
        const parsed = this.parseTarget(target);

        if ('refId' in parsed) {
            return this.handleRefAction(action, parsed.refId, parsed.prop, payloadBytes);
        } else {
            return this.handleNamespaceAction(action, parsed.path, payloadBytes);
        }
    }

    /**
     * Handle actions on a ref (#ID.prop).
     */
    private handleRefAction(
        action: string,
        refId: number,
        prop: string,
        payloadBytes?: Uint8Array,
    ): Uint8Array | Promise<Uint8Array> {
        if (action === 'release') {
            this.registry.release(refId);
            return this.encode(undefined);
        }

        const entry = this.registry.get(refId);
        if (!entry) {
            return this.encode(undefined);
        }

        const { target, mode, interceptors } = entry;

        try {
            switch (action) {
                case 'get': {
                    if (prop) assertSafeProp(prop);
                    const op: InterceptorOp = {
                        type: 'get',
                        prop,
                        target,
                        nestedTarget: prop !== '',
                    };

                    const result = runInterceptors(interceptors, op, (finalOp) => {
                        if (finalOp.prop === '') return finalOp.target;
                        return (finalOp.target as any)[finalOp.prop];
                    });

                    if (result instanceof Promise) {
                        return result
                            .then((resolved) => this.encodeResult(resolved, mode))
                            .catch((err) => this.encode(resolveErrorForSandbox(err, this.registry)));
                    }

                    return this.encodeResult(result, mode);
                }

                case 'set': {
                    if (prop) assertSafeProp(prop);
                    if (mode !== 'mutableRef') {
                        return this.encode(undefined);
                    }

                    const value = payloadBytes
                        ? deserializeHost(payloadBytes, this.resolveRef)
                        : undefined;

                    const op: InterceptorOp = {
                        type: 'set',
                        prop,
                        target,
                        value,
                        nestedTarget: prop !== '',
                    };

                    const result = runInterceptors(interceptors, op, (finalOp) => {
                        (finalOp.target as any)[finalOp.prop] = finalOp.value;
                        return undefined;
                    });

                    if (result instanceof Promise) {
                        return result
                            .then((resolved) => this.encode(resolved ?? undefined))
                            .catch((err) => this.encode(resolveErrorForSandbox(err, this.registry)));
                    }

                    return this.encode(result ?? undefined);
                }

                case 'call': {
                    if (prop) assertSafeProp(prop);
                    const args: unknown[] = payloadBytes
                        ? deserializeHost(payloadBytes, this.resolveRef)
                        : [];

                    const op: InterceptorOp = {
                        type: 'call',
                        prop,
                        target,
                        args,
                        nestedTarget: prop !== '',
                    };

                    const result = runInterceptors(interceptors, op, (finalOp) => {
                        const fn = finalOp.prop
                            ? (finalOp.target as any)[finalOp.prop]
                            : finalOp.target;

                        if (typeof fn !== 'function') {
                            throw new Error(`${finalOp.prop || 'target'} is not a function`);
                        }

                        // Call with target as `this` — the register already has the right receiver
                        const callResult = finalOp.prop
                            ? fn.call(finalOp.target, ...(finalOp.args || []))
                            : fn(...(finalOp.args || []));
                            
                        return callResult;
                    });

                    // Handle async results
                    if (result instanceof Promise) {
                        return result
                            .then((resolved) => this.encodeResult(resolved, mode))
                            .catch((err) => this.encode(resolveErrorForSandbox(err, this.registry)));
                    }

                    const finalBytes = this.encodeResult(result, mode);
                    return finalBytes;
                }

                default:
                    return this.encode(undefined);
            }
        } catch (err) {
            return this.encode(resolveErrorForSandbox(err, this.registry));
        }
    }

    /**
     * Handle actions on a namespace path (sdk.http.get).
     */
    private handleNamespaceAction(
        action: string,
        path: string[],
        payloadBytes?: Uint8Array,
    ): Uint8Array | Promise<Uint8Array> {
        try {
            const { value, parentMode } = this.walkNamespace(path);

            switch (action) {
                case 'get': {
                    return this.encode(resolveValueForSandbox(value, this.registry, parentMode));
                }

                case 'call': {
                    // For namespace calls, the last segment is the function name,
                    // and its parent object is the context
                    if (typeof value !== 'function') {
                        return this.encode(undefined);
                    }

                    const args: unknown[] = payloadBytes
                        ? deserializeHost(payloadBytes, this.resolveRef)
                        : [];

                    // Find the parent object for `this` binding
                    const parentPath = path.slice(0, -1);
                    const { value: parentValue } = this.walkNamespace(parentPath);
                    const parent = isSandboxNamespace(parentValue)
                        ? parentValue.shape
                        : parentValue;

                    const result = (value as Function).call(parent, ...args);

                    if (result instanceof Promise) {
                        return result
                            .then((resolved) => this.encodeResult(resolved, parentMode))
                            .catch((err) => this.encode(resolveErrorForSandbox(err, this.registry)));
                    }

                    return this.encodeResult(result, parentMode);
                }

                case 'set': {
                    // Namespace set — walk to parent, set property
                    const parentPath = path.slice(0, -1);
                    const propName = path[path.length - 1];
                    const { value: parentValue } = this.walkNamespace(parentPath);

                    const setTarget = isSandboxNamespace(parentValue)
                        ? parentValue.shape
                        : parentValue;

                    if (setTarget && typeof setTarget === 'object') {
                        const val = payloadBytes
                            ? deserializeHost(payloadBytes, this.resolveRef)
                            : undefined;
                        (setTarget as any)[propName] = val;
                    }

                    return this.encode(undefined);
                }

                default:
                    return this.encode(undefined);
            }
        } catch (err) {
            return this.encode(resolveErrorForSandbox(err, this.registry));
        }
    }

    /**
     * Encode a resolved value using the decision tree + communication-protocol.
     */
    private encodeResult(value: unknown, parentMode: RefMode): Uint8Array {
        const resolved = resolveValueForSandbox(value, this.registry, parentMode);
        return this.encode(resolved);
    }

    /**
     * Encode any value for transmission to sandbox.
     */
    private encode(value: unknown): Uint8Array {
        return serializeHost(value, this.resolveRef);
    }

    /**
     * Install the __sandbox_invoke function on the QuickJS VM global.
     * Uses ArrayBuffer for binary transport between host and guest.
     */
    private installInvokeHook(): void {
        const invokeHandle = this.vm.newFunction('__sandbox_invoke', (...handleArgs: QuickJSHandle[]) => {
            const action = this.vm.getString(handleArgs[0]);
            const target = this.vm.getString(handleArgs[1]);

            let payloadBytes: Uint8Array | undefined;
            if (handleArgs.length > 2 && this.vm.typeof(handleArgs[2]) !== 'undefined') {
                // Get the Lifetime<Uint8Array> payload from the QuickJS handle
                const payloadArrayBuffer = this.vm.getArrayBuffer(handleArgs[2]);
                if (payloadArrayBuffer) {
                    // Extract exactly what we need, then dispose the lifetime to prevent leaks
                    payloadBytes = new Uint8Array(payloadArrayBuffer.value);
                    payloadArrayBuffer.dispose();
                }
            }

            const result = this.handleInvoke(action, target, payloadBytes);

            if (result instanceof Promise) {
                // Return a promise handle for async operations
                const promiseHandle = this.vm.newPromise();
                result
                    .then((bytes) => {
                        const arrayBuf = this.vm.newArrayBuffer(bytes.slice().buffer);
                        promiseHandle.resolve(arrayBuf);
                        arrayBuf.dispose();
                    })
                    .catch((err) => {
                        const errBytes = this.encode(resolveErrorForSandbox(err, this.registry));
                        const arrayBuf = this.vm.newArrayBuffer(errBytes.slice().buffer);
                        promiseHandle.resolve(arrayBuf);
                        arrayBuf.dispose();
                    });

                promiseHandle.settled.then(this.vm.runtime.executePendingJobs);
                return promiseHandle.handle;
            }

            // Sync result — return as ArrayBuffer
            return this.vm.newArrayBuffer(result.slice().buffer);
        });

        this.vm.setProp(this.vm.global, '__sandbox_invoke', invokeHandle);
        this.handles.push(invokeHandle);
    }

    /**
     * Dispose all VM handles.
     */
    dispose(): void {
        for (const h of this.handles) {
            h.dispose();
        }
        this.handles = [];
    }
}
