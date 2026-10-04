import { MAX_UPLOAD_BYTES } from "@rater/contracts";

export type UploadProblem = "not_pdf" | "too_large" | "empty";

/**
 * Checks a file before it is sent. The API checks again (and rejects non-Qiwa PDFs);
 * this only saves the user a round trip for the obvious cases.
 */
export function validateUpload(file: File): UploadProblem | null {
  if (!isPdf(file)) return "not_pdf";
  if (file.size === 0) return "empty";
  if (file.size > MAX_UPLOAD_BYTES) return "too_large";
  return null;
}

function isPdf(file: File): boolean {
  // Some browsers leave the type empty for drag-and-drop, so fall back to the extension.
  if (file.type === "application/pdf") return true;
  return file.type === "" && file.name.toLowerCase().endsWith(".pdf");
}

export const MAX_UPLOAD_MB = MAX_UPLOAD_BYTES / (1024 * 1024);
