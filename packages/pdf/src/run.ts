import { execFile, type ExecFileException } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** A command-line tool failed, timed out, or is not installed. */
export class PdfToolError extends Error {
  constructor(
    readonly tool: string,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(`${tool}: ${message}`, options);
    this.name = "PdfToolError";
  }
}

export interface RunOptions {
  timeoutMs: number;
  /** Largest stdout we accept. pdftotext XHTML for a 10-page contract is about 1 MB. */
  maxBufferBytes?: number;
}

export interface RunResult {
  stdout: string;
  stderr: string;
}

const DEFAULT_MAX_BUFFER = 64 * 1024 * 1024;

/**
 * Runs a tool with an argument list (never through a shell, so file names and values are not
 * interpolated) and resolves with its output. Rejects with PdfToolError on a non-zero exit,
 * a timeout, or a missing binary.
 */
export function runTool(
  tool: string,
  args: string[],
  options: RunOptions,
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    execFile(
      tool,
      args,
      {
        timeout: options.timeoutMs,
        maxBuffer: options.maxBufferBytes ?? DEFAULT_MAX_BUFFER,
        encoding: "utf8",
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(
            new PdfToolError(tool, describeFailure(error, stderr, options.timeoutMs), {
              cause: error,
            }),
          );
          return;
        }
        resolve({ stdout, stderr });
      },
    );
  });
}

function describeFailure(
  error: ExecFileException,
  stderr: string,
  timeoutMs: number,
): string {
  if (error.code === "ENOENT") return "not installed";
  if (error.killed) return `timed out after ${timeoutMs} ms`;
  const detail = stderr.trim().split("\n").slice(-3).join(" ");
  return detail || error.message;
}

/** True when the tool can be started at all (exit code is ignored). */
export async function canRun(tool: string, args: string[]): Promise<boolean> {
  try {
    await runTool(tool, args, { timeoutMs: 10_000 });
    return true;
  } catch (error) {
    // Some tools print their version and then exit non-zero. A numeric code means the binary ran;
    // a missing binary ("ENOENT") or a hang (killed, code null) means it is not usable.
    const cause =
      error instanceof PdfToolError
        ? (error.cause as { code?: unknown } | undefined)
        : undefined;
    return typeof cause?.code === "number";
  }
}

/**
 * Creates a private temporary directory, passes it to `work`, and always deletes it afterwards.
 * Uploaded contracts hold personal data, so nothing may be left behind in /tmp.
 */
export async function withTempDir<T>(work: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "rater-pdf-"));
  try {
    return await work(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Writes the PDF into `dir` and returns its path. */
export async function writePdf(dir: string, pdf: Buffer): Promise<string> {
  const path = join(dir, "input.pdf");
  await writeFile(path, pdf, { mode: 0o600 });
  return path;
}
