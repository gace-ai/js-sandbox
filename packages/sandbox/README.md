# @gace/sandbox

General-purpose bridge for QuickJS to expose host APIs via proxies.

## Features

- **Reference-based**: Objects and functions are passed as references. Accessing a property or calling a function triggers a bridge call.
- **Interceptors**: Middleware support for `get`, `set`, and `call` operations.
- **Binary Transport**: Uses MessagePack for efficient data transfer between host and guest.
- **Lightweight**: Minimal overhead, bundles essential polyfills (`TextEncoder`, `TextDecoder`).

## Installation

```bash
npm install @gace/sandbox
```

*Note: Requires `quickjs-emscripten` as a peer dependency.*

## Quick Start

```typescript
import { getQuickJS } from 'quickjs-emscripten';
import { Sandbox } from '@gace/sandbox';

const qjs = await getQuickJS();
const vm = qjs.newContext();
const s = new Sandbox({ vm });

// Expose APIs to the sandbox
s.expose({
  greet: (name: string) => `Hello, ${name}!`,
  state: s.mutableRef({ count: 0 })
});

s.evalCode(`
  console.log(greet('World'));
  state.count++;
`);

s.dispose();
vm.dispose();
```

## Expose Anything

Pass native host APIs or complex objects directly. The sandbox interacts with host objects via transparent proxies:

- **Native Functions**: `fetch: fetch`
- **DOM Access**: `document: s.mutableRef(document)`
- **Complex Objects**: `api: { log: console.log, metadata: { version: '1.0.0' } }`

## API

### `new Sandbox({ vm: QuickJSContext })`
Creates a new sandbox instance bound to the provided QuickJS context.

### `s.expose(api: Record<string, any>)`
Registers host objects/functions in the sandbox global scope.

### `s.ref(target)` / `s.mutableRef(target)`
Wraps an object to be passed as an immutable or mutable reference.

### `s.evalCode(code: string)`
Executes code in the sandbox.
