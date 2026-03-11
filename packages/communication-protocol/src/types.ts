export class Ref {
    constructor(public value: number) {}
}

// All errors are passed via Ref
// IMPORTANT: Err does not extend Ref, so it doesn't pass error instanceof Ref
export class Err {
    constructor(public ref: Ref) {}
}

export class Namespace {
    constructor() {}
}

export const FunctionMarker = Symbol("function");

export const atomValue = new Uint8Array(0);