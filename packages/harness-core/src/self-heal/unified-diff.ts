function normalizeLines(raw: string): string[] {
  return raw.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n");
}

function isPreludeLine(line: string): boolean {
  return (
    /^diff --git /.test(line) ||
    /^index [0-9a-f]+\.\.[0-9a-f]+(?: \d+)?$/.test(line) ||
    /^old mode \d+$/.test(line) ||
    /^new mode \d+$/.test(line) ||
    /^deleted file mode \d+$/.test(line) ||
    /^new file mode \d+$/.test(line) ||
    /^similarity index \d+%$/.test(line) ||
    /^rename from /.test(line) ||
    /^rename to /.test(line) ||
    /^Binary files /.test(line) ||
    /^GIT binary patch$/.test(line)
  );
}

function isPatchLine(line: string): boolean {
  return (
    isPreludeLine(line) ||
    /^---\s+/.test(line) ||
    /^\+\+\+\s+/.test(line) ||
    /^@@(?: .*|)$/.test(line) ||
    /^[ +\\-]/.test(line)
  );
}

export function extractUnifiedDiffBlock(raw: string): string | undefined {
  const lines = normalizeLines(raw);

  for (let index = 0; index < lines.length - 1; index += 1) {
    if (!/^---\s+/.test(lines[index]) || !/^\+\+\+\s+/.test(lines[index + 1])) {
      continue;
    }

    let start = index;
    while (start > 0 && isPreludeLine(lines[start - 1])) {
      start -= 1;
    }

    const collected: string[] = [];
    let hasHunk = false;

    for (let cursor = start; cursor < lines.length; cursor += 1) {
      const line = lines[cursor]!;
      if (!isPatchLine(line)) {
        break;
      }
      if (/^@@(?: .*|)$/.test(line)) {
        hasHunk = true;
      }
      collected.push(line);
    }

    if (hasHunk && collected.length > 0) {
      return `${collected.join("\n").trimEnd()}\n`;
    }
  }

  return undefined;
}
