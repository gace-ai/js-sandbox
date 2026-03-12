import type { InterceptorFn, InterceptorOp } from './types';

/**
 * Run an interceptor middleware chain.
 * Interceptors execute outer-to-inner, each calling next(op) to proceed.
 * Whatever the interceptor returns is the final result.
 *
 * @param interceptors  Ordered list of interceptor functions
 * @param op            The operation descriptor
 * @param terminal      The final handler (performs the actual get/set/call)
 * @returns             The result (whatever the outermost interceptor returns)
 */
export function runInterceptors(
    interceptors: InterceptorFn[],
    op: InterceptorOp,
    terminal: (op: InterceptorOp) => unknown,
): unknown {
    if (interceptors.length === 0) {
        return terminal(op);
    }

    // Build the chain from innermost to outermost
    let current = terminal;

    for (let i = interceptors.length - 1; i >= 0; i--) {
        const interceptor = interceptors[i];
        const next = current;
        current = (op: InterceptorOp) => interceptor(op, next);
    }

    return current(op);
}
