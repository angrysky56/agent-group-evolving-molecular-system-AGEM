export class RequestTimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`Request timed out after ${timeoutMs}ms`);
    this.name = "RequestTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

export interface RequestDeadline {
  readonly signal: AbortSignal;
  readonly timedOut: boolean;
  remainingMs(): number;
  dispose(): void;
}

/** A real wall-clock deadline, rather than a check made between loop turns. */
export function createRequestDeadline(
  timeoutMs: number,
  parentSignal?: AbortSignal,
): RequestDeadline {
  const controller = new AbortController();
  let timedOut = false;
  const expiresAt = Date.now() + timeoutMs;
  const abortFromParent = () => {
    clearTimeout(timer);
    controller.abort(parentSignal?.reason);
  };
  const timer = setTimeout(() => {
    timedOut = true;
    parentSignal?.removeEventListener("abort", abortFromParent);
    controller.abort(new RequestTimeoutError(timeoutMs));
  }, timeoutMs);
  timer.unref?.();
  if (parentSignal?.aborted) abortFromParent();
  else parentSignal?.addEventListener("abort", abortFromParent, { once: true });

  return {
    signal: controller.signal,
    get timedOut() {
      return timedOut;
    },
    remainingMs() {
      return Math.max(0, expiresAt - Date.now());
    },
    dispose() {
      clearTimeout(timer);
      parentSignal?.removeEventListener("abort", abortFromParent);
    },
  };
}
