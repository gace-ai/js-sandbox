import { Err, MutableRef, Ref } from "./types";

/**
 * Context: When we pass ref to the sandbox, we can simply pass the id,
 * sandbox has it's own Proxy that handles it.
 * But when we receive ref from the sandbox, we need to convert it back
 * into original value here.
 */
export function pipeDecodeRefFromSandbox(ref: Ref, resolveRef: (ref: Ref) => unknown) {
    return resolveRef(ref);
}

export function pipeDecodeMutableRefFromSandbox(mutableRef: MutableRef, resolveRef: (ref: Ref) => unknown) {
    return resolveRef(mutableRef);
}

export function pipeDecodeFunctionFromSandbox() {
    throw new Error("Sandbox is not allowed to pass functions to the host");
}

export function pipeDecodeErrFromSandbox(err: Err) {
    throw new Error("Sandbox is not allowed to pass errors to the host");
}

export function pipeDecodeNamespaceFromSandbox() {
    throw new Error("Sandbox is not allowed to pass namespaces to the host");
}