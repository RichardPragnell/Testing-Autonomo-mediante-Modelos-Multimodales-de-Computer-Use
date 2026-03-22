import type { TaskExpectation } from "../types.js";

interface AssertionResult {
  success: boolean;
  message: string;
  urlAfter?: string;
}

export async function evaluateExpectation(page: any, expected: TaskExpectation): Promise<AssertionResult> {
  const safeUrl = typeof page?.url === "function" ? page.url() : undefined;

  if (expected.type === "url_contains") {
    const success = Boolean(safeUrl?.includes(expected.value));
    return {
      success,
      message: success
        ? `URL contains ${expected.value}`
        : `URL does not contain expected value ${expected.value}`,
      urlAfter: safeUrl
    };
  }

  if (expected.type === "contains") {
    const title = (await page?.title?.()) ?? "";
    const success = title.includes(expected.value);
    return {
      success,
      message: success
        ? `Title contains ${expected.value}`
        : `Title does not contain expected value ${expected.value}`,
      urlAfter: safeUrl
    };
  }

  if (expected.type === "text_visible") {
    const bodyText = (await page?.evaluate?.(() => document.body?.innerText ?? "")) ?? "";
    const success = bodyText.includes(expected.value);
    return {
      success,
      message: success
        ? `Body text contains ${expected.value}`
        : `Body text does not contain expected value ${expected.value}`,
      urlAfter: safeUrl
    };
  }

  if (expected.type === "text_not_visible") {
    const bodyText = (await page?.evaluate?.(() => document.body?.innerText ?? "")) ?? "";
    const success = !bodyText.includes(expected.value);
    return {
      success,
      message: success
        ? `Body text does not contain ${expected.value}`
        : `Body text still contains unexpected value ${expected.value}`,
      urlAfter: safeUrl
    };
  }

  return {
    success: false,
    message: `Unsupported expectation type ${(expected as { type?: string }).type ?? "unknown"}`,
    urlAfter: safeUrl
  };
}
