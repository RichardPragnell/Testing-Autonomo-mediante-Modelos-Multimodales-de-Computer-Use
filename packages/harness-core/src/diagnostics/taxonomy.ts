import type { FailureCategory } from "../types.js";

const patterns: Array<{ category: FailureCategory; regex: RegExp }> = [
  { category: "timeout", regex: /(timeout|timed out|deadline exceeded)/i },
  { category: "locator", regex: /(locator|selector|element not found|no node found)/i },
  { category: "navigation", regex: /(navigation|net::|dns|connection refused|404|5\\d\\d)/i },
  { category: "assertion", regex: /(assert|expected|mismatch|not equal|does not contain)/i },
  { category: "state", regex: /(stale|detached|intercepted|already closed|invalid state)/i },
  { category: "unexpected_ui", regex: /(modal|popup|captcha|consent|unexpected ui)/i }
];

export function classifyFailure(message: string): FailureCategory {
  for (const { category, regex } of patterns) {
    if (regex.test(message)) {
      return category;
    }
  }
  return "unknown";
}

