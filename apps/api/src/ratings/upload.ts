import type { MultipartFile } from "@fastify/multipart";
import type { FastifyRequest } from "fastify";
import { View } from "@rater/contracts";
import { detectQiwa, parseBboxXhtml } from "@rater/core";
import { PdfToolError, pdftotextBbox } from "@rater/pdf";
import { fileTooLarge, unsupportedDocument, validationError } from "../errors";

export interface Upload {
  pdf: Buffer;
  /** The "view" form field, when sent. */
  view: View | null;
}

/**
 * Reads the multipart upload: an optional "view" field and exactly one file in "file".
 * The whole file is buffered (it is at most `maxBytes`); a bigger file is answered with 413.
 */
export async function readUpload(
  request: FastifyRequest,
  maxBytes: number,
): Promise<Upload> {
  if (!request.isMultipart()) {
    throw validationError("Send the contract as multipart/form-data.");
  }
  let pdf: Buffer | null = null;
  let view: View | null = null;
  const parts = request.parts({ limits: { fileSize: maxBytes, files: 1, fields: 5 } });
  for await (const part of parts) {
    if (part.type === "file") {
      if (part.fieldname !== "file") {
        throw validationError('Send the PDF in the "file" field.');
      }
      pdf = await readFile(part, maxBytes);
    } else if (part.fieldname === "view") {
      const parsed = View.safeParse(part.value);
      if (!parsed.success) throw validationError('"view" must be "employee" or "hr".');
      view = parsed.data;
    }
  }
  if (!pdf) throw validationError('Send the PDF in the "file" field.');
  return { pdf, view };
}

async function readFile(part: MultipartFile, maxBytes: number): Promise<Buffer> {
  let buffer: Buffer;
  try {
    buffer = await part.toBuffer();
  } catch (error) {
    if ((error as { code?: unknown }).code === "FST_REQ_FILE_TOO_LARGE") {
      throw fileTooLarge(maxBytes);
    }
    throw error;
  }
  // toBuffer throws on an oversized file; this guards the case where it only truncates.
  if (part.file.truncated) throw fileTooLarge(maxBytes);
  return buffer;
}

/** PDF files start with "%PDF-" (some writers put a few junk bytes before it). */
export function looksLikePdf(file: Buffer): boolean {
  return file.subarray(0, 1024).includes("%PDF-");
}

/**
 * Early detection, before anything is stored: the file must be a readable PDF whose first
 * page has the Qiwa "Unified Employment Contract" title. Returns the page count.
 */
export async function checkQiwaPdf(pdf: Buffer): Promise<{ pages: number }> {
  if (!looksLikePdf(pdf)) throw unsupportedDocument("The file is not a PDF.");

  let xhtml: string;
  try {
    xhtml = await pdftotextBbox(pdf);
  } catch (error) {
    // A missing pdftotext is our problem (500); anything else means an unreadable PDF.
    if (error instanceof PdfToolError && !isMissingTool(error)) {
      throw unsupportedDocument("The PDF could not be read.");
    }
    throw error;
  }

  const pages = parseBboxXhtml(xhtml);
  const detection = detectQiwa(pages);
  if (!detection.ok) {
    throw unsupportedDocument(
      `Only Qiwa "Unified Employment Contract" PDFs can be rated. ${detection.reason}`,
    );
  }
  return { pages: pages.length };
}

function isMissingTool(error: PdfToolError): boolean {
  return (error.cause as { code?: unknown } | undefined)?.code === "ENOENT";
}
