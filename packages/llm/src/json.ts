/**
 * Finds the first JSON object in a model reply. Models sometimes wrap JSON in a ```json fence
 * or add a sentence before it; this accepts all of those and returns undefined when the reply
 * holds no complete object.
 */
export function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  const whole = tryParseObject(trimmed);
  if (whole !== undefined) return whole;

  for (const fenced of fencedBlocks(trimmed)) {
    const parsed = tryParseObject(fenced.trim());
    if (parsed !== undefined) return parsed;
  }

  for (
    let start = trimmed.indexOf("{");
    start !== -1;
    start = trimmed.indexOf("{", start + 1)
  ) {
    const end = matchingBrace(trimmed, start);
    if (end === -1) continue;
    const parsed = tryParseObject(trimmed.slice(start, end + 1));
    if (parsed !== undefined) return parsed;
  }
  return undefined;
}

/** Parses text as JSON and keeps it only if it is an object (not an array or a scalar). */
function tryParseObject(text: string): unknown {
  if (!text.startsWith("{")) return undefined;
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? value
      : undefined;
  } catch {
    return undefined;
  }
}

/** Contents of Markdown code fences, in order. */
function fencedBlocks(text: string): string[] {
  return [...text.matchAll(/```[a-zA-Z]*\s*\n?([\s\S]*?)```/g)].map(
    (match) => match[1] ?? "",
  );
}

/**
 * Index of the brace that closes the object opened at `start`, or -1. Braces inside JSON
 * strings (including escaped quotes) do not count.
 */
function matchingBrace(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      if (char === "\\") i++;
      else if (char === '"') inString = false;
    } else if (char === '"') {
      inString = true;
    } else if (char === "{") {
      depth++;
    } else if (char === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}
