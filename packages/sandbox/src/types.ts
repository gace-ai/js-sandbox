import type { QuickJSContext } from 'quickjs-emscripten';

// ---- Wrapper marker types (host-side only) ----

export type RefMode = 'ref' | 'mutableRef';

export interface RefEntry {
    target: unknown;
    mode: RefMode;
    interceptors: InterceptorFn[];
    parentId?: number;
}

// ---- Interceptors ----

export type InterceptorOp = {
    type: 'get' | 'set' | 'call';
    prop: string;
    /** The actual host object being accessed */
    target: unknown;
    /** For 'call' operations */
    args?: unknown[];
    /** For 'set' operations */
    value?: unknown;
    /** false if accessing the ref itself, true if accessing a property of it */
    nestedTarget: boolean;
};

export type InterceptorFn = (op: InterceptorOp, next: (op: InterceptorOp) => unknown) => unknown;

// ---- Sandbox options ----

export interface SandboxOptions {
    vm: QuickJSContext;
}

// ---- Wrapper interfaces ----

export interface SandboxRef<T = unknown> {
    readonly __brand: 'SandboxRef';
    readonly target: T;
    readonly mode: 'ref';
    readonly interceptors: InterceptorFn[];
    intercept(fn: InterceptorFn): SandboxRef<T>;
}

export interface SandboxMutableRef<T = unknown> {
    readonly __brand: 'SandboxMutableRef';
    readonly target: T;
    readonly mode: 'mutableRef';
    readonly interceptors: InterceptorFn[];
    intercept(fn: InterceptorFn): SandboxMutableRef<T>;
}

export interface SandboxValue<T = unknown> {
    readonly __brand: 'SandboxValue';
    readonly target: T;
}

export interface SandboxNamespace {
    readonly __brand: 'SandboxNamespace';
    readonly shape: Record<string, unknown>;
}

// ---- Type guards ----

export function isSandboxRef(v: unknown): v is SandboxRef {
    return v !== null && typeof v === 'object' && '__brand' in v && (v as any).__brand === 'SandboxRef';
}

export function isSandboxMutableRef(v: unknown): v is SandboxMutableRef {
    return v !== null && typeof v === 'object' && '__brand' in v && (v as any).__brand === 'SandboxMutableRef';
}

export function isSandboxValue(v: unknown): v is SandboxValue {
    return v !== null && typeof v === 'object' && '__brand' in v && (v as any).__brand === 'SandboxValue';
}

export function isSandboxNamespace(v: unknown): v is SandboxNamespace {
    return v !== null && typeof v === 'object' && '__brand' in v && (v as any).__brand === 'SandboxNamespace';
}

export function isAnyWrapper(v: unknown): boolean {
    return isSandboxRef(v) || isSandboxMutableRef(v) || isSandboxValue(v) || isSandboxNamespace(v);
}
