interface OpenRouterModelLimiterState {
  activeCount: number;
  cooldownUntil: number;
  nextRequestAt: number;
  waiters: Set<() => void>;
}

const modelLimiterStates = new Map<string, OpenRouterModelLimiterState>();

function readNumberEnv(name: string, env: NodeJS.ProcessEnv = process.env): number | undefined {
  const rawValue = env[name];
  if (!rawValue?.trim()) {
    return undefined;
  }

  const parsed = Number(rawValue);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function ensureLimiterState(modelId: string): OpenRouterModelLimiterState {
  const existing = modelLimiterStates.get(modelId);
  if (existing) {
    return existing;
  }

  const created: OpenRouterModelLimiterState = {
    activeCount: 0,
    cooldownUntil: 0,
    nextRequestAt: 0,
    waiters: new Set()
  };
  modelLimiterStates.set(modelId, created);
  return created;
}

function notifyWaiters(state: OpenRouterModelLimiterState): void {
  for (const waiter of [...state.waiters]) {
    waiter();
  }
}

function disposeLimiterState(modelId: string, state: OpenRouterModelLimiterState): void {
  if (
    state.activeCount === 0 &&
    state.waiters.size === 0 &&
    state.cooldownUntil <= Date.now() &&
    state.nextRequestAt <= Date.now()
  ) {
    modelLimiterStates.delete(modelId);
  }
}

function resolveModelMaxConcurrency(modelId: string, env: NodeJS.ProcessEnv = process.env): number {
  const configured =
    readNumberEnv("OPENROUTER_MODEL_MAX_CONCURRENCY", env) ??
    readNumberEnv("OPENROUTER_MODEL_PARALLELISM", env) ??
    (modelId.includes(":free") ? readNumberEnv("OPENROUTER_FREE_MODEL_MAX_CONCURRENCY", env) : undefined);

  if (configured === undefined) {
    return 1;
  }

  return Math.max(1, Math.floor(configured));
}

function resolveModelMinIntervalMs(modelId: string, env: NodeJS.ProcessEnv = process.env): number {
  const configured =
    readNumberEnv("OPENROUTER_MODEL_MIN_INTERVAL_MS", env) ??
    (modelId.includes(":free") ? readNumberEnv("OPENROUTER_FREE_MODEL_MIN_INTERVAL_MS", env) : undefined);

  if (configured !== undefined) {
    return configured;
  }

  return modelId.includes(":free") ? 1_500 : 250;
}

function waitForLimiterChange(state: OpenRouterModelLimiterState, waitMs: number): Promise<void> {
  return new Promise((resolve) => {
    let timeout: ReturnType<typeof setTimeout> | undefined;

    const done = () => {
      if (timeout) {
        clearTimeout(timeout);
      }
      state.waiters.delete(done);
      resolve();
    };

    state.waiters.add(done);
    if (waitMs > 0) {
      timeout = setTimeout(done, waitMs);
    }
  });
}

async function acquireOpenRouterModelSlot(
  modelId: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<() => void> {
  const maxConcurrency = resolveModelMaxConcurrency(modelId, env);
  const minIntervalMs = resolveModelMinIntervalMs(modelId, env);

  while (true) {
    const state = ensureLimiterState(modelId);
    const now = Date.now();
    const earliestStartAt = Math.max(state.cooldownUntil, state.nextRequestAt);

    if (state.activeCount < maxConcurrency && earliestStartAt <= now) {
      state.activeCount += 1;
      state.nextRequestAt = now + minIntervalMs;

      return () => {
        const releaseState = ensureLimiterState(modelId);
        releaseState.activeCount = Math.max(0, releaseState.activeCount - 1);
        notifyWaiters(releaseState);
        disposeLimiterState(modelId, releaseState);
      };
    }

    const waitMs = Math.max(0, earliestStartAt - now);
    await waitForLimiterChange(state, waitMs);
  }
}

function collectErrorMessages(
  value: unknown,
  messages: string[],
  seen: Set<unknown>,
  depth = 0
): void {
  if (value === undefined || value === null || depth > 4) {
    return;
  }

  if (typeof value === "string") {
    const normalized = value.trim();
    if (normalized) {
      messages.push(normalized);
    }
    return;
  }

  if (typeof value !== "object") {
    return;
  }

  if (seen.has(value)) {
    return;
  }
  seen.add(value);

  if (value instanceof Error) {
    collectErrorMessages(value.message, messages, seen, depth + 1);
  }

  const record = value as Record<string, unknown>;
  for (const key of ["message", "error", "cause", "description", "details", "responseBody", "body", "data", "value"]) {
    if (key in record) {
      collectErrorMessages(record[key], messages, seen, depth + 1);
    }
  }

  if (Array.isArray(record.errors)) {
    for (const item of record.errors) {
      collectErrorMessages(item, messages, seen, depth + 1);
    }
  }
}

function normalizeOpenRouterErrorMessage(error: unknown): string {
  const messages: string[] = [];
  collectErrorMessages(error, messages, new Set());
  const uniqueMessages = [...new Set(messages.map((message) => message.replace(/\s+/g, " ").trim()).filter(Boolean))];
  return uniqueMessages[0] ?? String(error);
}

export function isRateLimitErrorMessage(message: string): boolean {
  return /rate limit|too many requests|free-models-per-min|429/i.test(message);
}

export function isProviderAvailabilityErrorMessage(message: string): boolean {
  return /provider returned error|no endpoints available|guardrail restrictions|data policy/i.test(message);
}

export function isTransientOpenRouterErrorMessage(message: string): boolean {
  return (
    isRateLimitErrorMessage(message) ||
    isProviderAvailabilityErrorMessage(message) ||
    /service unavailable|gateway timeout|bad gateway|temporarily unavailable|connection closed|timed out/i.test(message)
  );
}

export function computeOpenRouterRetryDelayMs(input: {
  attempt: number;
  modelId: string;
  errorMessage: string;
  env?: NodeJS.ProcessEnv;
}): number {
  const env = input.env ?? process.env;
  if (!isTransientOpenRouterErrorMessage(input.errorMessage)) {
    return 0;
  }

  const isFreeModel = input.modelId.includes(":free");
  const rateLimitDelayMs =
    readNumberEnv("STAGEHAND_RATE_LIMIT_DELAY_MS", env) ??
    (isFreeModel ? 20_000 : 7_500);
  const providerDelayMs =
    readNumberEnv("STAGEHAND_PROVIDER_ERROR_DELAY_MS", env) ??
    (isFreeModel ? 4_000 : 2_000);
  const baseDelayMs = isRateLimitErrorMessage(input.errorMessage) ? rateLimitDelayMs : providerDelayMs;
  return baseDelayMs * (input.attempt + 1);
}

export function applyOpenRouterModelCooldown(
  modelId: string,
  delayMs: number,
  now = Date.now()
): number {
  if (!Number.isFinite(delayMs) || delayMs <= 0) {
    return 0;
  }

  const state = ensureLimiterState(modelId);
  state.cooldownUntil = Math.max(state.cooldownUntil, now + delayMs);
  notifyWaiters(state);
  return Math.max(0, state.cooldownUntil - now);
}

export function getOpenRouterModelCooldownDelay(modelId: string, now = Date.now()): number {
  const state = modelLimiterStates.get(modelId);
  if (!state) {
    return 0;
  }

  const delayMs = Math.max(0, state.cooldownUntil - now);
  disposeLimiterState(modelId, state);
  return delayMs;
}

export async function runWithOpenRouterModelLimit<T>(input: {
  modelId: string;
  run: () => Promise<T>;
  env?: NodeJS.ProcessEnv;
}): Promise<T> {
  const env = input.env ?? process.env;
  const release = await acquireOpenRouterModelSlot(input.modelId, env);

  try {
    return await input.run();
  } catch (error) {
    const errorMessage = normalizeOpenRouterErrorMessage(error);
    const retryDelayMs = computeOpenRouterRetryDelayMs({
      attempt: 0,
      modelId: input.modelId,
      errorMessage,
      env
    });
    if (retryDelayMs > 0) {
      applyOpenRouterModelCooldown(input.modelId, retryDelayMs);
    }
    throw error;
  } finally {
    release();
  }
}
