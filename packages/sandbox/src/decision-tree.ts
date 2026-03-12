import { Ref, MutableRef, Err, Namespace, FunctionMarker } from 'communication-protocol';
import { ReferenceRegistry } from './registry';
import type { RefMode } from './types';
import {
    isSandboxRef,
    isSandboxMutableRef,
    isSandboxValue,
    isSandboxNamespace,
} from './types';

/**
 * Decision tree for serializing a host value before sending to sandbox.
 *
 * Resolution order:
 * 1. Error thrown?         → Err(Ref(N)) — immutable ref to the error
 * 2. Primitive?            → return as-is (msgpack handles natively)
 * 3. Explicitly s.value?   → return unwrapped target (deep copy via msgpack)
 * 4. Explicitly s.mutableRef? → register + return MutableRef(N)
 * 5. Explicitly s.ref?     → register + return Ref(N)
 * 6. Function?             → return FunctionMarker
 * 7. Namespace?            → return Namespace
 * 8. No explicit mark?     → inherit parent's mode, default to immutable ref
 */
export function resolveValueForSandbox(
    value: unknown,
    registry: ReferenceRegistry,
    parentMode: RefMode = 'ref',
): unknown {
    // 1. Primitives — pass through directly (msgpack serializes natively)
    if (value === null || value === undefined) return value;

    const t = typeof value;
    if (t === 'string' || t === 'number' || t === 'boolean' || t === 'bigint') {
        return value;
    }

    // 2. Explicit wrappers
    if (isSandboxValue(value)) {
        // Deep copy — return the unwrapped target, msgpack will serialize it
        return value.target;
    }

    if (isSandboxMutableRef(value)) {
        const id = registry.register(value.target, 'mutableRef', value.interceptors);
        return new MutableRef(id);
    }

    if (isSandboxRef(value)) {
        const id = registry.register(value.target, 'ref', value.interceptors);
        return new Ref(id);
    }

    if (isSandboxNamespace(value)) {
        return new Namespace();
    }

    // 3. Functions — signal as callable
    if (typeof value === 'function') {
        return value; // pass as-is so msgpack's ExtensionCodec handles it
    }

    // 4. No explicit wrapper — inherit parent mode
    const mode = parentMode;
    const id = registry.register(value, mode);
    return mode === 'mutableRef' ? new MutableRef(id) : new Ref(id);
}

/**
 * Resolve an error for sandbox — always returns Err(Ref(N)).
 */
export function resolveErrorForSandbox(
    error: unknown,
    registry: ReferenceRegistry,
): Err {
    const id = registry.register(error, 'ref');
    return new Err(new Ref(id));
}
