export * from './types';
import { Ref } from './types';
import { ExtensionCodec, encode as msgpackEncode, decode as msgpackDecode } from '@msgpack/msgpack';
import { getExtensionCodec } from './extension-codecs';

// --------- Sandbox side ---------

let sandboxExtensionCodec: null | ExtensionCodec = null;

export function serializeSandobx(data: any): Uint8Array {
    sandboxExtensionCodec = sandboxExtensionCodec || getExtensionCodec(false, () => {});

    return msgpackEncode(data, {
        extensionCodec: sandboxExtensionCodec,
        useBigInt64: true,
    });
}

export function deserializeSandbox<T = any>(data: Uint8Array): T {
    sandboxExtensionCodec = sandboxExtensionCodec || getExtensionCodec(false, () => {});

    return msgpackDecode(data, {
        extensionCodec: sandboxExtensionCodec,
        useBigInt64: true,
    }) as T;
}

// --------- Host side ---------

let hostExtensionCodec: null | ExtensionCodec = null;

export function serializeHost(data: any, resolveRef: (ref: Ref) => unknown): Uint8Array {
    hostExtensionCodec = hostExtensionCodec || getExtensionCodec(true, resolveRef);

    return msgpackEncode(data, {
        extensionCodec: hostExtensionCodec,
        useBigInt64: true,
    });
}

export function deserializeHost<T = any>(data: Uint8Array, resolveRef: (ref: Ref) => unknown): T {
    hostExtensionCodec = hostExtensionCodec || getExtensionCodec(true, resolveRef);

    return msgpackDecode(data, {
        extensionCodec: hostExtensionCodec,
        useBigInt64: true,
    }) as T;
}