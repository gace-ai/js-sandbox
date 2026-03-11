import { getQuickJS } from 'quickjs-emscripten';
import type { QuickJSWASMModule } from 'quickjs-emscripten';
import { DOMBridge } from './bridge';
import type { Rule } from './types';

export async function initSandbox(): Promise<QuickJSWASMModule> {
    return await getQuickJS();
}

export function runInSandbox(qjs: QuickJSWASMModule, code: string, rules: Rule[]) {
    const vm = qjs.newContext();
    const bridge = new DOMBridge(vm, rules);

    try {
        bridge.evalCode(code);
    } finally {
        bridge.dispose();
        vm.dispose();
    }
}

export * from './types';
