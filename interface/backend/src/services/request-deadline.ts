export class RequestTimeoutError extends Error {
  readonly timeoutMs: number;
  readonly scope = "request" as const;

  constructor(timeoutMs: number) {
    super(`Request timed out after ${timeoutMs}ms`);
    this.name = "RequestTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

/** Request-scope cancellation annotated with the active tool's real runtime. */
export class ToolRequestDeadlineError extends Error {
  readonly scope = "request" as const;

  constructor(
    readonly toolName: string,
    readonly toolElapsedMs: number,
    readonly requestTimeoutMs: number,
    options?: ErrorOptions,
  ) {
    super(
      `Request deadline expired while ${toolName} was active ` +
        `(tool elapsed ${toolElapsedMs}ms; request budget ${requestTimeoutMs}ms).`,
      options,
    );
    this.name = "ToolRequestDeadlineError";
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
