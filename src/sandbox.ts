import { getQuickJS } from 'quickjs-emscripten';
import type { QuickJSWASMModule, QuickJSHandle } from 'quickjs-emscripten';

export type Rule = (op: any) => boolean;

// Node registry state
let nodeRegistry = new Map<number, WeakRef<Node>>();
let reverseRegistry = new WeakMap<Node, number>();
let nextNodeId = 1;

function registerNode(node: Node): number {
    if (reverseRegistry.has(node)) {
        return reverseRegistry.get(node)!;
    }
    const id = nextNodeId++;
    nodeRegistry.set(id, new WeakRef(node));
    reverseRegistry.set(node, id);
    return id;
}

export async function initSandbox(): Promise<QuickJSWASMModule> {
    return await getQuickJS();
}

const proxyShimCode = `
const hostReleaser = new FinalizationRegistry((nodeId) => {
    __dom_release(nodeId); 
});

function makeProxy(nodeId) {
  const p = new Proxy({}, {
    get(_, prop) {
      if (prop === '__node_id') return nodeId;

      // Ask the host what this property looks like
      const rawJson = __dom_get(nodeId, prop);
      if (!rawJson) return undefined;
      
      const raw = JSON.parse(rawJson);

      if (raw.__fn) {
        return (...args) => {
          const serializedArgs = JSON.stringify(args.map(toHost));
          const resultJson = __dom_call(nodeId, prop, serializedArgs);
          if (!resultJson) return undefined;
          return fromHost(JSON.parse(resultJson));
        };
      }
      
      if (raw.__node !== undefined) {
          return makeProxy(raw.__node);
      }
      
      return raw; // plain string / number / bool / null
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
  // If this object is something our proxy returned earlier, it should have a hidden property,
  // but since we are just a PoC and can't easily detect Proxy, we'll try something simpler.
  // We can attach a hidden symbol or property to identify proxies, but for now we look for 
  // __node_id if we inject it, OR we modify makeProxy to attach it.
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
`;

export function runInSandbox(qjs: QuickJSWASMModule, code: string, rules: Rule[]) {
    const vm = qjs.newContext();

    // Reset registry for a fresh run
    nodeRegistry = new Map<number, WeakRef<Node>>();
    reverseRegistry = new WeakMap<Node, number>();
    nextNodeId = 1;

    // Node 0 is the document
    nodeRegistry.set(0, new WeakRef(window.document));
    reverseRegistry.set(window.document, 0);

    const filter = (op: any) => rules.every(rule => rule(op) !== false);

    const domGetHandle = vm.newFunction("__dom_get", (nodeIdHandle: QuickJSHandle, propHandle: QuickJSHandle) => {
        const nodeId = vm.getNumber(nodeIdHandle);
        const prop = vm.getString(propHandle);

        const nodeRef = nodeRegistry.get(nodeId);
        const node = nodeRef ? nodeRef.deref() : undefined;
        if (!node) return vm.newString("null");

        if (!filter({ type: 'get', nodeId, prop })) return vm.newString("null");

        const value = (node as any)[prop];
        let result: any;

        if (typeof value === 'function') {
            result = { __fn: true };
        } else if (value instanceof Node) {
            result = { __node: registerNode(value) };
        } else if (value instanceof NodeList || value instanceof HTMLCollection) {
            result = { __list: Array.from(value).map(n => registerNode(n as Node)) };
        } else if (value !== null && typeof value === 'object') {
            result = { __node: registerNode(value) };
        } else {
            result = value;
        }

        const resultHandle = vm.newString(JSON.stringify(result));
        return resultHandle;
    });
    vm.setProp(vm.global, "__dom_get", domGetHandle);
    domGetHandle.dispose();

    const domCallHandle = vm.newFunction("__dom_call", (nodeIdHandle: QuickJSHandle, methodHandle: QuickJSHandle, argsJsonHandle: QuickJSHandle) => {
        const nodeId = vm.getNumber(nodeIdHandle);
        const method = vm.getString(methodHandle);
        const argsJson = vm.getString(argsJsonHandle);

        const nodeRef = nodeRegistry.get(nodeId);
        const node = nodeRef ? nodeRef.deref() : undefined;
        if (!node) return vm.newString("null");

        const args = JSON.parse(argsJson) || [];

        const deserializedArgs = args.map((arg: any) => {
            if (arg && arg.__node !== undefined) {
                const ref = nodeRegistry.get(arg.__node);
                return ref ? ref.deref() : undefined;
            }
            return arg;
        });

        if (!filter({ type: 'call', nodeId, method, args: deserializedArgs })) return vm.newString("null");

        if (typeof (node as any)[method] !== 'function') {
            return vm.newString("null");
        }

        const rawResult = (node as any)[method](...deserializedArgs);
        let serializeResult: any;

        if (rawResult instanceof Node) {
            serializeResult = { __node: registerNode(rawResult) };
        } else if (rawResult instanceof NodeList || rawResult instanceof HTMLCollection) {
            serializeResult = { __list: Array.from(rawResult).map(n => registerNode(n as Node)) };
        } else if (rawResult !== null && typeof rawResult === 'object') {
            serializeResult = { __node: registerNode(rawResult) };
        } else {
            serializeResult = rawResult;
        }

        const resultHandle = vm.newString(JSON.stringify(serializeResult));
        return resultHandle;
    });
    vm.setProp(vm.global, "__dom_call", domCallHandle);
    domCallHandle.dispose();

    const domSetHandle = vm.newFunction("__dom_set", (nodeIdHandle: QuickJSHandle, propHandle: QuickJSHandle, valueJsonHandle: QuickJSHandle) => {
        const nodeId = vm.getNumber(nodeIdHandle);
        const prop = vm.getString(propHandle);
        const valueJson = vm.getString(valueJsonHandle);

        const nodeRef = nodeRegistry.get(nodeId);
        const node = nodeRef ? nodeRef.deref() : undefined;
        if (!node) return vm.undefined;

        const value = JSON.parse(valueJson);

        if (!filter({ type: 'set', nodeId, prop, value })) return vm.undefined;

        (node as any)[prop] = value;
        return vm.undefined;
    });
    vm.setProp(vm.global, "__dom_set", domSetHandle);
    domSetHandle.dispose();

    const domReleaseHandle = vm.newFunction("__dom_release", (nodeIdHandle: QuickJSHandle) => {
        const nodeId = vm.getNumber(nodeIdHandle);
        const nodeRef = nodeRegistry.get(nodeId);
        const node = nodeRef ? nodeRef.deref() : undefined;

        if (node) {
            reverseRegistry.delete(node);
        }
        nodeRegistry.delete(nodeId);
        // Optional: console.log(`[Host GC] Released node id ${nodeId}`);
    });
    vm.setProp(vm.global, "__dom_release", domReleaseHandle);
    domReleaseHandle.dispose();

    // Load the shim
    const shimResult = vm.evalCode(proxyShimCode);
    if (shimResult.error) {
        console.error("Shim Error:", vm.dump(shimResult.error));
        shimResult.error.dispose();
    }
    shimResult.dispose();

    // Run the trusted user code
    try {
        const result = vm.evalCode(code);
        if (result.error) {
            console.error("Sandbox Execution Error:", vm.dump(result.error));
            result.error.dispose();
        }
        result.dispose();
    } catch (e) {
        console.error("VM threw: ", e);
    } finally {
        vm.dispose();
    }
}
