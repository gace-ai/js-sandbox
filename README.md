# Gace JS Sandbox

A powerful, generic JavaScript sandbox library designed to expose host APIs to a QuickJS environment with flexible interception and reference management.

## Project Structure

This is a monorepo managed with `pnpm` workspaces.

- **`packages/sandbox`**: The core sandbox library. This is the main package.
- **`packages/communication-protocol`**: Internal protocol for host-sandbox communication.
- **`packages/polyfill`**: Polyfills for the sandbox environment.
- **`examples/demo`**: A React + Vite demonstration of the sandbox in action, showing remote DOM manipulation.

## Getting Started

1. Install dependencies:
   ```bash
   pnpm install
   ```

2. Build all packages:
   ```bash
   pnpm build
   ```

3. Run the demo:
   ```bash
   cd examples/demo
   pnpm dev
   ```

## Key Features

- **QuickJS Based**: High-performance, secure JS execution.
- **Flexible API Exposure**: Easily expose host objects, functions, and state to the sandbox.
- **Interception Layer**: Fine-grained control over property access and function calls via intersections.
- **Reference Tracking**: Transparently manage object references between host and guest.
