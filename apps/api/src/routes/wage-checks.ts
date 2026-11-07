import { readFileSync } from "node:fs";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import type { FastifyRequest } from "fastify";
import { readSheet } from "read-excel-file/node";
import { WageCheckRequest, WageCheckResponse, WageRecord } from "@rater/contracts";
import {
  asPaid,
  checkWages,
  extractContract,
  readContractsCsv,
  readPayrollCsv,
  WageFileError,
} from "@rater/core";
import type { AppDeps } from "../deps";
import { unsupportedDocument, validationError } from "../errors";
import { readFile, readQiwaPages } from "../ratings/upload";

/** Form field → wage part of the offer letter typed in next to a Qiwa PDF. */
const OFFER_FIELDS = {
  offerBasic: "basic",
  offerHousing: "housing",
  offerTransport: "transport",
  offerTotal: "total",
} as const;

/** A bare page for trying the API by hand; not the product UI. */
const PAGE = readFileSync(new URL("./wage-check-page.html", import.meta.url), "utf8");

/**
 * The wage check: compares each person's Qiwa contract with the payroll (Mudad wage file) and,
 * when given, the offer letter. Nothing is stored: the files are read, compared and dropped.
 */
export const wageCheckRoutes: FastifyPluginAsyncZod<AppDeps> = async (app, deps) => {
  app.get(
    "/wage-checks/test",
    { config: { public: true }, schema: { hide: true } },
    async (_request, reply) => reply.type("text/html; charset=utf-8").send(PAGE),
  );

  app.post(
    "/wage-checks",
    {
      schema: {
        summary: "Compare Qiwa contracts, offer letters and a payroll file",
        description:
          'multipart/form-data: optional "payroll" (Mudad wage file, CSV or .xlsx) plus "contract" (one Qiwa PDF; ' +
          "offer letter in the optional fields offerBasic, offerHousing, offerTransport, " +
          'offerTotal) or "contracts" (CSV or .xlsx, a row per person and source: qiwa or offline). ' +
          "Column names may be English or Arabic.",
        consumes: ["multipart/form-data"],
        response: { 200: WageCheckResponse },
      },
    },
    async (request) => {
      const { files, fields } = await readForm(request, deps.config.MAX_UPLOAD_BYTES);
      const wageFile = files.get("payroll");
      const pdf = files.get("contract");
      const csv = files.get("contracts");
      if (!pdf === !csv) {
        throw validationError('Send a Qiwa PDF in "contract" or a CSV in "contracts".');
      }
      try {
        // No wage file yet, e.g. for a new hire: only the offer is compared with Qiwa.
        const payroll = wageFile && readPayrollCsv(await tableText(wageFile));
        if (csv)
          return checkWages({ ...readContractsCsv(await tableText(csv)), payroll });
        const qiwa = await readQiwaWage(pdf as Buffer);
        const offer = offerFrom(fields, qiwa);
        return checkWages({ qiwa: [qiwa], offers: offer ? [offer] : [], payroll });
      } catch (error) {
        if (error instanceof WageFileError) throw validationError(error.message);
        throw error;
      }
    },
  );

  // One Qiwa PDF read into a record, for a caller with many: read each here, then send them
  // all to /wage-checks/records. An auditor going through a company's files works this way.
  app.post(
    "/wage-checks/contract",
    {
      schema: {
        summary: "Read the wage and ID from one Qiwa contract PDF",
        description: 'multipart/form-data: "contract" (one Qiwa PDF).',
        consumes: ["multipart/form-data"],
        response: { 200: WageRecord },
      },
    },
    async (request) => {
      const { files } = await readForm(request, deps.config.MAX_UPLOAD_BYTES);
      const pdf = files.get("contract");
      if (!pdf) throw validationError('Send a Qiwa PDF in "contract".');
      return readQiwaWage(pdf);
    },
  );

  // The same check for a system that already holds the records, such as an HRIS calling it
  // before payroll is approved. Payroll amounts left out count as 0, like an empty CSV cell.
  app.post(
    "/wage-checks/records",
    {
      // Room for the 50,000-person cap: about 130 bytes a record, in two or three lists.
      bodyLimit: 32 * 1024 * 1024,
      schema: {
        summary: "Compare Qiwa contracts, offer letters and payroll sent as JSON",
        body: WageCheckRequest,
        response: { 200: WageCheckResponse },
      },
    },
    async ({ body }) => checkWages({ ...body, payroll: body.payroll?.map(asPaid) }),
  );
};

/**
 * A CSV upload as text, or the first sheet of an Excel workbook (.xlsx, a zip: "PK" first)
 * written out as CSV, so one reader handles both.
 */
async function tableText(file: Buffer): Promise<string> {
  if (file.subarray(0, 2).toString() !== "PK") return file.toString("utf8");
  let rows: unknown[][];
  try {
    rows = await readSheet(file);
  } catch {
    throw validationError(
      "The Excel file could not be read. Save it as .xlsx or CSV (UTF-8).",
    );
  }
  // Every cell quoted, so a comma inside one stays in it; a line break inside one is a space.
  const cell = (value: unknown) =>
    `"${String(value ?? "")
      .replace(/\r?\n/g, " ")
      .replace(/"/g, '""')}"`;
  return rows.map((row) => row.map(cell).join(",")).join("\n");
}

/** The wage and the employee's ID from a Qiwa contract PDF, scanned or not. */
async function readQiwaWage(pdf: Buffer): Promise<WageRecord> {
  const { pages, scanned } = await readQiwaPages(pdf);
  const { employeeId, fields, issues } = extractContract(pages);
  const { wage } = fields;
  if (!employeeId || !wage) {
    throw unsupportedDocument("The employee's ID number or wage could not be read.");
  }
  // In a scan, wage parts that don't add up to the total are more likely a misread digit.
  const wageIssue = scanned && issues.find((issue) => issue.field === "wage");
  if (wageIssue) {
    throw unsupportedDocument(`The scan's wage could not be read: ${wageIssue.message}`);
  }
  // "Other" fixed allowances in the contract count toward transport, like payroll does.
  const transport = wage.transport + wage.other;
  const { basic, housing, total } = wage;
  return { employeeId, name: null, basic, housing, transport, total };
}

/** The offer letter's amounts from the form, or null when none was typed in. */
function offerFrom(fields: Map<string, string>, qiwa: WageRecord): WageRecord | null {
  const offer = { ...qiwa };
  let given = false;
  for (const [name, part] of Object.entries(OFFER_FIELDS)) {
    const raw = fields.get(name)?.replace(/[,\s]/g, "");
    offer[part] = raw ? Number(raw) : null;
    if (Number.isNaN(offer[part])) throw validationError(`"${name}" must be a number.`);
    given ||= Boolean(raw);
  }
  return given ? offer : null;
}

/** Every file and field of the multipart form, each file at most `maxBytes`. */
async function readForm(request: FastifyRequest, maxBytes: number) {
  if (!request.isMultipart()) throw validationError("Send multipart/form-data.");
  const files = new Map<string, Buffer>();
  const fields = new Map<string, string>();
  const parts = request.parts({ limits: { fileSize: maxBytes, files: 3, fields: 10 } });
  for await (const part of parts) {
    if (part.type === "file" && files.has(part.fieldname)) {
      throw validationError(
        `Send one file in "${part.fieldname}". For many Qiwa PDFs, read each with ` +
          "POST /wage-checks/contract and send the records to POST /wage-checks/records.",
      );
    }
    if (part.type === "file") files.set(part.fieldname, await readFile(part, maxBytes));
    else fields.set(part.fieldname, String(part.value));
  }
  return { files, fields };
}
