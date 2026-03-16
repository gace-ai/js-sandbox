export const FORBIDDEN_PROPS = new Set([
    '__proto__',
    'constructor',
    'prototype',
    'call',
    'apply',
    'bind'
]);

// A set of globally available native constructors/functions that are inherently dangerous
// if exposed to the sandbox (even unintentionally).
export const FORBIDDEN_REFERENCES = new Set([
    Function,
    eval,
    setTimeout,
    setInterval,
    Object.setPrototypeOf,
    Object.defineProperty,
    Object.defineProperties,
    Object.freeze,
    Object.seal,
    Object.preventExtensions,
    Reflect.apply,
    Reflect.construct,
]);

// Include AsyncFunction, GeneratorFunction, etc. if they exist in the environment
const AsyncFunction = async function () {}.constructor;
const GeneratorFunction = function* () {}.constructor;
const AsyncGeneratorFunction = async function* () {}.constructor;

if (typeof AsyncFunction === 'function') FORBIDDEN_REFERENCES.add(AsyncFunction);
if (typeof GeneratorFunction === 'function') FORBIDDEN_REFERENCES.add(GeneratorFunction);
if (typeof AsyncGeneratorFunction === 'function') FORBIDDEN_REFERENCES.add(AsyncGeneratorFunction);

/**
 * Asserts that a property name is safe to access.
 * Throws an Error if the property is forbidden.
 */
export function assertSafeProp(prop: string): void {
    if (FORBIDDEN_PROPS.has(prop)) {
        throw new Error(`Security Violation: Access to property "${prop}" is forbidden.`);
    }
}

/**
 * Asserts that a host reference is safe to pass to the sandbox.
 * Throws an Error if the reference is forbidden.
 */
export function assertSafeReference(value: unknown): void {
    if (typeof value === 'function' && FORBIDDEN_REFERENCES.has(value as any)) {
        throw new Error(`Security Violation: Attempted to expose forbidden host reference (e.g. Function constructor).`);
    }
}
