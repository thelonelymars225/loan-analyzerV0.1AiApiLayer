import { MAX_UPLOAD_BYTES } from "@rater/contracts";
import { describe, expect, it } from "vitest";
import { fakeFile } from "../test/render";
import { validateUpload } from "./upload";

describe("validateUpload", () => {
  it("accepts a PDF up to 10 MB", () => {
    expect(
      validateUpload(fakeFile("contract.pdf", "application/pdf", 250_000)),
    ).toBeNull();
    expect(
      validateUpload(fakeFile("contract.pdf", "application/pdf", MAX_UPLOAD_BYTES)),
    ).toBeNull();
  });

  it("accepts a .pdf whose type the browser left empty", () => {
    expect(validateUpload(fakeFile("Contract.PDF", "", 1000))).toBeNull();
  });

  it("rejects anything that is not a PDF", () => {
    expect(
      validateUpload(
        fakeFile(
          "contract.docx",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          1000,
        ),
      ),
    ).toBe("not_pdf");
    expect(validateUpload(fakeFile("scan.png", "image/png", 1000))).toBe("not_pdf");
    expect(validateUpload(fakeFile("renamed.pdf", "image/png", 1000))).toBe("not_pdf");
  });

  it("rejects files over 10 MB and empty files", () => {
    expect(
      validateUpload(fakeFile("big.pdf", "application/pdf", MAX_UPLOAD_BYTES + 1)),
    ).toBe("too_large");
    expect(validateUpload(fakeFile("empty.pdf", "application/pdf", 0))).toBe("empty");
  });
});
