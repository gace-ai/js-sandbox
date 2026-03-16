import { useState, useEffect, useCallback, useRef } from 'react';
import type { QuickJSWASMModule } from 'quickjs-emscripten';
import { initSandbox, runInSandbox } from '../sandbox';

export function useSandbox(initialCode: string) {
    const [code, setCode] = useState(() => localStorage.getItem('sandboxCode') || initialCode);
    const [logs, setLogs] = useState<string[]>([]);
    const [qjsInstance, setQjsInstance] = useState<QuickJSWASMModule | null>(null);

    const mounted = useRef(true);

    useEffect(() => {
        localStorage.setItem('sandboxCode', code);
    }, [code]);

    const addLog = useCallback((msg: string) => {
        setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
    }, []);

    const connectQjs = useCallback(async () => {
        try {
            const qjs = await initSandbox();
            if (mounted.current) {
                setQjsInstance(qjs);
                addLog('QuickJS VM Engine ready.');
            }
        } catch (err: any) {
            addLog('Failed to initialize QuickJS: ' + err);
        }
    }, [addLog]);

    useEffect(() => {
        mounted.current = true;
        connectQjs();
        return () => {
            mounted.current = false;
        };
    }, [connectQjs]);

    const runCode = useCallback(() => {
        if (!qjsInstance) {
            addLog('Wait for VM to be ready...');
            return;
        }

        addLog('Executing sandbox code...');

        try {
            runInSandbox(qjsInstance, code);
            addLog('Execution completed.');
        } catch (err: any) {
            addLog('Execution failed: ' + err.message);
        }
    }, [code, qjsInstance, addLog]);

    const resetPage = useCallback(() => {
        window.location.reload();
    }, []);

    const resetCode = useCallback(() => {
        setCode(initialCode);
    }, [initialCode]);

    return {
        code,
        setCode,
        logs,
        runCode,
        qjsReady: !!qjsInstance,
        resetPage,
        resetCode
    };
}
