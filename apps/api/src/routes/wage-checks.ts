import { readFileSync } from "node:fs";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import type { FastifyRequest } from "fastify";
import { WageCheckResponse } from "@rater/contracts";
import {
  checkWages,
  extractContract,
  parseBboxXhtml,
  readContractsCsv,
  readPayrollCsv,
  WageFileError,
  type WageRecord,
} from "@rater/core";
import { pdftotextBbox } from "@rater/pdf";
import type { AppDeps } from "../deps";
import { unsupportedDocument, validationError } from "../errors";
import { checkQiwaPdf, readFile } from "../ratings/upload";

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
          'multipart/form-data: "payroll" (Mudad wage file, CSV) plus "contract" (one Qiwa PDF; ' +
          "offer letter in the optional fields offerBasic, offerHousing, offerTransport, " +
          'offerTotal) or "contracts" (CSV, a row per person and source: qiwa or offline).',
        consumes: ["multipart/form-data"],
        response: { 200: WageCheckResponse },
      },
    },
    async (request) => {
      const { files, fields } = await readForm(request, deps.config.MAX_UPLOAD_BYTES);
      const wageFile = files.get("payroll");
      const pdf = files.get("contract");
      const csv = files.get("contracts");
      if (!wageFile) throw validationError('Send the wage file (CSV) in "payroll".');
      if (!pdf === !csv) {
        throw validationError('Send a Qiwa PDF in "contract" or a CSV in "contracts".');
      }
      try {
        const payroll = readPayrollCsv(wageFile.toString("utf8"));
        if (csv)
          return checkWages({ ...readContractsCsv(csv.toString("utf8")), payroll });
        const qiwa = await readQiwaWage(pdf as Buffer);
        const offer = offerFrom(fields, qiwa);
        return checkWages({ qiwa: [qiwa], offers: offer ? [offer] : [], payroll });
      } catch (error) {
        if (error instanceof WageFileError) throw validationError(error.message);
        throw error;
      }
    },
  );
};

/** The wage and the employee's ID from a Qiwa contract PDF. */
async function readQiwaWage(pdf: Buffer): Promise<WageRecord> {
  await checkQiwaPdf(pdf);
  const pages = parseBboxXhtml(await pdftotextBbox(pdf));
  const { employeeId, fields } = extractContract(pages);
  const { wage } = fields;
  if (!employeeId || !wage) {
    throw unsupportedDocument("The employee's ID number or wage could not be read.");
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
    if (part.type === "file") files.set(part.fieldname, await readFile(part, maxBytes));
    else fields.set(part.fieldname, String(part.value));
  }
  return { files, fields };
}
