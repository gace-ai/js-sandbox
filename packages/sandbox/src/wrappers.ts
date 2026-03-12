import type {
    InterceptorFn,
    SandboxRef,
    SandboxMutableRef,
    SandboxValue,
    SandboxNamespace,
} from './types';

// ---- SandboxRef ----

export function createRef<T>(target: T, interceptors: InterceptorFn[] = []): SandboxRef<T> {
    return {
        __brand: 'SandboxRef' as const,
        target,
        mode: 'ref' as const,
        interceptors: [...interceptors],
        intercept(fn: InterceptorFn): SandboxRef<T> {
            return createRef(target, [...this.interceptors, fn]);
        },
    };
}

// ---- SandboxMutableRef ----

export function createMutableRef<T>(target: T, interceptors: InterceptorFn[] = []): SandboxMutableRef<T> {
    return {
        __brand: 'SandboxMutableRef' as const,
        target,
        mode: 'mutableRef' as const,
        interceptors: [...interceptors],
        intercept(fn: InterceptorFn): SandboxMutableRef<T> {
            return createMutableRef(target, [...this.interceptors, fn]);
        },
    };
}

// ---- SandboxValue ----

export function createValue<T>(target: T): SandboxValue<T> {
    return {
        __brand: 'SandboxValue' as const,
        target,
    };
}

// ---- SandboxNamespace ----

export function createNamespace(shape: Record<string, unknown>): SandboxNamespace {
    return {
        __brand: 'SandboxNamespace' as const,
        shape,
    };
}
