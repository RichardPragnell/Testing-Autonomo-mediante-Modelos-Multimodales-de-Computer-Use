import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import {
  applyOpenRouterModelCooldown,
  getOpenRouterModelCooldownDelay,
  runWithOpenRouterModelLimit
} from "../../src/ai/openrouter-limiter.js";

describe("openrouter model limiter", () => {
  it("serializes concurrent requests for the same model by default", async () => {
    let active = 0;
    let maxActive = 0;

    await Promise.all([
      runWithOpenRouterModelLimit({
        modelId: "test/shared-model",
        env: {},
        run: async () => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          await delay(20);
          active -= 1;
        }
      }),
      runWithOpenRouterModelLimit({
        modelId: "test/shared-model",
        env: {},
        run: async () => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          await delay(20);
          active -= 1;
        }
      })
    ]);

    expect(maxActive).toBe(1);
  });

  it("allows different models to proceed independently", async () => {
    let active = 0;
    let maxActive = 0;

    await Promise.all([
      runWithOpenRouterModelLimit({
        modelId: "test/model-a",
        env: {},
        run: async () => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          await delay(20);
          active -= 1;
        }
      }),
      runWithOpenRouterModelLimit({
        modelId: "test/model-b",
        env: {},
        run: async () => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          await delay(20);
          active -= 1;
        }
      })
    ]);

    expect(maxActive).toBeGreaterThan(1);
  });

  it("shares cooldowns across later requests for the same model", async () => {
    const modelId = "test/cooldown-model";
    applyOpenRouterModelCooldown(modelId, 35);

    const startedAt = Date.now();
    await runWithOpenRouterModelLimit({
      modelId,
      env: {
        OPENROUTER_MODEL_MIN_INTERVAL_MS: "0"
      },
      run: async () => undefined
    });
    const elapsedMs = Date.now() - startedAt;

    expect(elapsedMs).toBeGreaterThanOrEqual(25);
    expect(getOpenRouterModelCooldownDelay(modelId)).toBe(0);
  });
});
