import { ExtensionCodec } from "@msgpack/msgpack";
import { atomValue, Ref, MutableRef, Namespace, FunctionMarker, Err } from "./types";
import { pipeDecodeFunctionFromSandbox, pipeDecodeRefFromSandbox, pipeDecodeMutableRefFromSandbox, pipeDecodeErrFromSandbox, pipeDecodeNamespaceFromSandbox } from "./pipes";

/**
 * In the comments there will be a flag indicating whether it can be
 * passed only from host, or only from sandbox or from both, like this:
 * 
 * [FROM_HOST_ONLY] / [FROM_SANDBOX_ONLY] / [BOTH]
 * 
 * */

export function getExtensionCodec(fromSandbox: boolean, resolveRef: (ref: Ref) => unknown): ExtensionCodec {
    const extensionCodec = new ExtensionCodec();

    // EXTENSION 1: Undefined (Atom)
    // [BOTH]
    extensionCodec.register({
        type: 1,
        encode: (object) => {
            if (object === undefined) return atomValue;
            return null;
        },
        decode: (_data) => undefined,
    });

    // EXTENSION 2: Ref (Payload: u32)
    // [BOTH]
    extensionCodec.register({
        type: 2,
        encode: (object) => {
            if (object instanceof Ref) {
                return numberToU32Buffer(object.value);
            }
            return null;
        },
        decode: (data) => {
            const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
            const ref = new Ref(view.getUint32(0));

            if (fromSandbox) return pipeDecodeRefFromSandbox(ref, resolveRef);
            return ref;
        },
    });

    // EXTENSION 3: Function (Atom)
    // [FROM_HOST_ONLY]
    extensionCodec.register({
        type: 3,
        encode: (object) => {
            if (typeof object === "function") return atomValue;
            return null;
        },
        decode: (_data) => {
            if (fromSandbox) pipeDecodeFunctionFromSandbox();
            return FunctionMarker;
        },
    });

    // EXTENSION 4: Err (Payload: Ref)
    // [FROM_HOST_ONLY]
    extensionCodec.register({
        type: 4,
        encode: (object) => {
            if (object instanceof Err) {
                return numberToU32Buffer(object.ref.value);
            }
            return null;
        },
        decode: (data) => {
            const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
            const err = new Err(new Ref(view.getUint32(0)));

            if (fromSandbox) pipeDecodeErrFromSandbox(err);
            return err;
        },
    });

    // EXTENSION 5: Namespace (Atom)
    // [FROM_HOST_ONLY]
    extensionCodec.register({
        type: 5,
        encode: (object) => {
            if (object instanceof Namespace) {
                return atomValue;
            }
            return null;
        },
        decode: (_data) => {
            if (fromSandbox) return pipeDecodeNamespaceFromSandbox();
            return new Namespace()
        },
    });

    // EXTENSION 6: MutableRef (Payload: u32)
    // [FROM_HOST_ONLY]
    extensionCodec.register({
        type: 6,
        encode: (object) => {
            if (object instanceof MutableRef) {
                return numberToU32Buffer(object.value);
            }
            return null;
        },
        decode: (data) => {
            const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
            const mutableRef = new MutableRef(view.getUint32(0));

            if (fromSandbox) return pipeDecodeMutableRefFromSandbox(mutableRef, resolveRef);
            return mutableRef;
        },
    });

    return extensionCodec;
}

function numberToU32Buffer(number: number): Uint8Array {
    const buffer = new Uint8Array(4);
    const view = new DataView(buffer.buffer);
    view.setUint32(0, number);
    return buffer;
}