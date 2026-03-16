export type DOMOperation =
    | { type: 'get'; nodeId: number; prop: string }
    | { type: 'set'; nodeId: number; prop: string; value: unknown }
    | { type: 'call'; nodeId: number; method: string; args: unknown[] };

export type Rule = (op: DOMOperation) => boolean;

export interface SerializedHostObject {
    __node?: number;
    __list?: number[];
    __fn?: boolean;
}
