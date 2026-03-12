/**
 * Polyfill entry point.
 *
 * This module is the entry point that gets bundled into a self-contained JS string
 * and injected into the QuickJS sandbox VM.
 *
 * It exports:
 * - handleResponse: decode host responses and create proxies
 * - refProxy: create a ref proxy
 * - toHost: convert sandbox values back for host transmission
 */
export { handleResponse, refProxy } from './make-proxy';
