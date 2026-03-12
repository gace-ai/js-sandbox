import type { RefEntry, RefMode, InterceptorFn } from './types';

/**
 * Generalized reference registry.
 * Maps numeric IDs to host-side objects + metadata (mode, interceptors).
 * Handles deduplication via a reverse WeakMap.
 */
export class ReferenceRegistry {
    private entries = new Map<number, RefEntry>();
    private reverseMap = new WeakMap<object, number>();
    private nextId = 1;

    /**
     * Register a value in the registry, returning its ref ID.
     * If the value is an object/function already registered, returns the existing ID (dedup).
     */
    register(
        target: unknown,
        mode: RefMode = 'ref',
        interceptors: InterceptorFn[] = [],
        parentId?: number,
    ): number {
        // Deduplication: if it's an object and already registered, return existing ID
        if (target !== null && typeof target === 'object' || typeof target === 'function') {
            const existing = this.reverseMap.get(target as object);
            if (existing !== undefined) return existing;
        }

        const id = this.nextId++;
        this.entries.set(id, { target, mode, interceptors, parentId });

        if (target !== null && (typeof target === 'object' || typeof target === 'function')) {
            this.reverseMap.set(target as object, id);
        }

        return id;
    }

    /**
     * Get a registry entry by ID.
     */
    get(id: number): RefEntry | undefined {
        return this.entries.get(id);
    }

    /**
     * Release a ref by ID.
     */
    release(id: number): void {
        const entry = this.entries.get(id);
        if (entry && entry.target !== null && (typeof entry.target === 'object' || typeof entry.target === 'function')) {
            this.reverseMap.delete(entry.target as object);
        }
        this.entries.delete(id);
    }

    /**
     * Clear all entries.
     */
    clear(): void {
        this.entries.clear();
        this.reverseMap = new WeakMap();
        this.nextId = 1;
    }

    get size(): number {
        return this.entries.size;
    }
}
