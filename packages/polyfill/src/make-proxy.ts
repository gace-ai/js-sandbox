import { Ref, MutableRef, Err, Namespace, FunctionMarker, serializeSandobx, deserializeSandbox } from 'communication-protocol';

// Re-export for use by setupGlobalBindings generated code
export { deserializeSandbox, serializeSandobx };

/**
 * Checks if a value is a primitive (not an object/function).
 */
function isPrimitive(value: unknown): boolean {
    if (value === null || value === undefined) return true;
    const t = typeof value;
    return t === 'string' || t === 'number' || t === 'boolean' || t === 'bigint';
}

// __sandbox_invoke is provided by the host (registered on globalThis by the bridge).
// It returns ArrayBuffer (from QuickJS's newArrayBuffer), so we always wrap in Uint8Array.
declare function __sandbox_invoke(action: string, target: string, payload?: ArrayBuffer): ArrayBuffer;

/**
 * Call __sandbox_invoke and decode the response.
 * Handles ArrayBuffer→Uint8Array conversion required by msgpack.
 */
export function invoke(action: string, target: string, payload?: Uint8Array): unknown {
    let rawPayload: ArrayBuffer | undefined;
    if (payload) {
        // Very important: payload is a Uint8Array, which is a view over an ArrayBuffer.
        // The underlying ArrayBuffer may be massive. QuickJS will die trying to copy it.
        // We force an explicit copy of JUST the exact bytes using .slice().
        rawPayload = payload.slice().buffer;
    }

    const resultBuffer = __sandbox_invoke(action, target, rawPayload);
    if (!resultBuffer) return undefined;
    return deserializeSandbox(new Uint8Array(resultBuffer));
}

/**
 * Decode a response from the host and produce the appropriate sandbox-side value.
 *
 * There are only 2 kinds of proxies:
 * 1. Ref proxy — wraps a Ref or MutableRef
 * 2. Namespace proxy — wraps a Namespace
 *
 * Functions are NOT a separate proxy type — when the host returns FunctionMarker,
 * we return an arrow function that calls __sandbox_invoke('call', ...).
 */
export function handleResponse(
    decoded: unknown,
    parentPath?: number | string,
    prop?: string,
): unknown {
    // Primitives pass through
    if (isPrimitive(decoded)) return decoded;

    // Ref — wrap in immutable ref proxy
    if (decoded instanceof Ref) {
        return refProxy(decoded, false);
    }

    // MutableRef — wrap in mutable ref proxy
    if (decoded instanceof MutableRef) {
        return refProxy(decoded, true);
    }

    // Err — throw a ref proxy wrapping the inner error ref
    if (decoded instanceof Err) {
        throw refProxy(decoded.ref, false);
    }

    // Function — return an arrow fn that invokes the method on the parent ref or namespace
    if (decoded === FunctionMarker) {
        if (parentPath === undefined || prop === undefined) {
            return () => undefined;
        }
        return (...args: unknown[]) => {
            const targetStr = typeof parentPath === 'number' ? `#${parentPath}.${prop}` : `${parentPath}.${prop}`;
            const decoded = invoke('call', targetStr, encodeArgs(args));
            return handleResponse(decoded);
        };
    }

    // Namespace — wrap in a proxy so nested properties can be accessed/called
    if (decoded instanceof Namespace) {
        const basePath = typeof parentPath === 'number' 
            ? `#${parentPath}.${prop}` 
            : parentPath !== undefined && prop !== undefined 
                ? `${parentPath}.${prop}` 
                : prop || '';
        return namespaceProxy(basePath, decoded);
    }

    // Plain object / array — return as-is (value-copied via msgpack)
    return decoded;
}

// ---- Proxies ----

function namespaceProxy(basePath: string, ns: Namespace): unknown {
    return new Proxy({}, {
        get(target, prop) {
            if (typeof prop === 'symbol') return undefined;
            const path = basePath ? `${basePath}.${prop}` : prop;
            const decoded = invoke('get', path);
            return handleResponse(decoded, basePath, prop);
        },
        set(target, prop, value) {
            if (typeof prop === 'symbol') return false;
            const path = basePath ? `${basePath}.${prop}` : prop;
            invoke('set', path, encodeArgs(value));
            return true;
        }
    });
}

// ---- Ref Proxy ----

const hostReleaser = new FinalizationRegistry<number>((refValue) => {
    __sandbox_invoke('release', `#${refValue}`);
});

/**
 * Create a ref proxy for a Ref or MutableRef.
 */
export function refProxy(ref: Ref | MutableRef, isMutable: boolean): unknown {
    const p = new Proxy({} as Record<string | symbol, unknown>, {
        get(_, prop) {
            if (prop === '__ref_id') return ref.value;
            if (typeof prop === 'symbol') return undefined;

            const decoded = invoke('get', `#${ref.value}.${prop}`);
            return handleResponse(decoded, ref.value, prop);
        },
        set(_, prop, value) {
            if (!isMutable) {
                throw new Error('Cannot set on immutable ref');
            }
            if (typeof prop === 'symbol') return false;

            invoke('set', `#${ref.value}.${prop}`, encodeArgs(value));
            return true;
        },
    });

    hostReleaser.register(p, ref.value);
    return p;
}

// ---- Serialization helpers ----

/**
 * Convert a sandbox-side value back to host-friendly format.
 */
function toHost(value: unknown): unknown {
    if (value === null || value === undefined) return value;

    if (typeof value === 'object' && value !== null) {
        const refId = (value as any).__ref_id;
        if (refId !== undefined) {
            return new Ref(refId);
        }
        if (Array.isArray(value)) {
            return value.map(toHost);
        }
        const result: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value)) {
            result[k] = toHost(v);
        }
        return result;
    }

    return value;
}

export function encodeArgs(args: unknown): Uint8Array {
    return serializeSandobx(toHost(args));
}
