import type { QuickJSContext, QuickJSHandle } from 'quickjs-emscripten';
import { DOMRegistry } from './registry';
import type { Rule } from './types';

// We add a semicolon in front and the end to prevent any potential
// syntax errors if the code is concatenated with other code.
const proxyShimCode = `
;(() => {
    const hostReleaser = new FinalizationRegistry((nodeId) => {
        __dom_release(nodeId); 
    });

    function makeProxy(nodeId) {
    const p = new Proxy({}, {
        get(_, prop) {
        if (prop === '__node_id') return nodeId;

        const rawJson = __dom_get(nodeId, prop);
        if (!rawJson) return undefined;
        
        const raw = JSON.parse(rawJson);

        if (raw && typeof raw === 'object' && raw.__fn) {
            return (...args) => {
            const serializedArgs = JSON.stringify(args.map(toHost));
            const resultJson = __dom_call(nodeId, prop, serializedArgs);
            if (!resultJson) return undefined;
            return fromHost(JSON.parse(resultJson));
            };
        }
        
        if (raw && typeof raw === 'object' && raw.__node !== undefined) {
            return makeProxy(raw.__node);
        }
        
        return raw;
        },

        set(_, prop, value) {
        __dom_set(nodeId, prop, JSON.stringify(toHost(value)));
        return true;
        }
    });

    hostReleaser.register(p, nodeId);
    return p;
    }

    function toHost(value) {
    if (!value) return value;
    if (value.__node_id !== undefined) {
        return { __node: value.__node_id };
    }
    return value; 
    }

    function fromHost(raw) {
        if (!raw) return raw;
        if (raw.__node !== undefined) return makeProxy(raw.__node);
        if (raw.__list !== undefined) return raw.__list.map(id => makeProxy(id));
        return raw;
    }

    globalThis.document = makeProxy(0);
})();
`;

export class DOMBridge {
    private registry: DOMRegistry;
    private handles: QuickJSHandle[] = [];
    private vm: QuickJSContext;
    private rules: Rule[];

    constructor(vm: QuickJSContext, rules: Rule[]) {
        this.vm = vm;
        this.rules = rules;
        this.registry = new DOMRegistry();
        this.initHooks();
        this.injectShim();
    }

    private filter(op: any): boolean {
        return this.rules.every(rule => rule(op) !== false);
    }

    private serializeHostValue(value: unknown): unknown {
        if (typeof value === 'function') {
            return { __fn: true };
        } else if (value instanceof Node) {
            return { __node: this.registry.registerNode(value) };
        } else if (value instanceof NodeList || value instanceof HTMLCollection) {
            return { __list: Array.from(value).map(n => this.registry.registerNode(n as Node)) };
        } else if (value !== null && typeof value === 'object') {
            // Basic objects (e.g., style objects)
            return { __node: this.registry.registerNode(value as unknown as Node) };
        }
        return value;
    }

    private deserializeArgs(argsJson: string): unknown[] {
        const args = JSON.parse(argsJson) || [];
        return args.map((arg: any) => {
            if (arg && arg.__node !== undefined) {
                return this.registry.getNode(arg.__node);
            }
            return arg;
        });
    }

    private initHooks() {
        const domGetHandle = this.vm.newFunction("__dom_get", (nodeIdH, propH) => {
            const nodeId = this.vm.getNumber(nodeIdH);
            const prop = this.vm.getString(propH);

            const node = this.registry.getNode(nodeId);
            if (!node) return this.vm.newString("null");

            if (!this.filter({ type: 'get', nodeId, prop })) return this.vm.newString("null");

            const value = (node as any)[prop];
            return this.vm.newString(JSON.stringify(this.serializeHostValue(value)));
        });
        this.vm.setProp(this.vm.global, "__dom_get", domGetHandle);
        this.handles.push(domGetHandle);

        const domCallHandle = this.vm.newFunction("__dom_call", (nodeIdH, methodH, argsJsonH) => {
            const nodeId = this.vm.getNumber(nodeIdH);
            const method = this.vm.getString(methodH);
            const argsJson = this.vm.getString(argsJsonH);

            const node = this.registry.getNode(nodeId);
            if (!node) return this.vm.newString("null");

            const deserializedArgs = this.deserializeArgs(argsJson);

            if (!this.filter({ type: 'call', nodeId, method, args: deserializedArgs })) {
                return this.vm.newString("null");
            }

            if (typeof (node as any)[method] !== 'function') {
                return this.vm.newString("null");
            }

            try {
                const rawResult = (node as any)[method](...deserializedArgs);
                return this.vm.newString(JSON.stringify(this.serializeHostValue(rawResult)));
            } catch (err) {
                // Safe falilure
                return this.vm.newString("null");
            }
        });
        this.vm.setProp(this.vm.global, "__dom_call", domCallHandle);
        this.handles.push(domCallHandle);

        const domSetHandle = this.vm.newFunction("__dom_set", (nodeIdH, propH, valueJsonH) => {
            const nodeId = this.vm.getNumber(nodeIdH);
            const prop = this.vm.getString(propH);
            const valueJson = this.vm.getString(valueJsonH);

            const node = this.registry.getNode(nodeId);
            if (!node) return this.vm.undefined;

            const value = JSON.parse(valueJson);

            if (!this.filter({ type: 'set', nodeId, prop, value })) return this.vm.undefined;

            try {
                (node as any)[prop] = value;
            } catch (e) {
                // Safe failure
            }
            return this.vm.undefined;
        });
        this.vm.setProp(this.vm.global, "__dom_set", domSetHandle);
        this.handles.push(domSetHandle);

        const domReleaseHandle = this.vm.newFunction("__dom_release", (nodeIdH) => {
            const nodeId = this.vm.getNumber(nodeIdH);
            this.registry.releaseNode(nodeId);
        });
        this.vm.setProp(this.vm.global, "__dom_release", domReleaseHandle);
        this.handles.push(domReleaseHandle);
    }

    private injectShim() {
        const shimResult = this.vm.evalCode(proxyShimCode);
        if (shimResult.error) {
            console.error("Shim Error:", this.vm.dump(shimResult.error));
            shimResult.error.dispose();
        }
        shimResult.dispose();
    }

    public evalCode(code: string) {
        const result = this.vm.evalCode(code);
        if (result.error) {
            console.error("Sandbox Execution Error:", this.vm.dump(result.error));
            result.error.dispose();
        }
        result.dispose();
    }

    public dispose() {
        for (const h of this.handles) {
            h.dispose();
        }
        this.handles = [];
        this.registry.clear();
    }
}
