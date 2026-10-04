import { MAX_UPLOAD_BYTES } from "@rater/contracts";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { fakeFile, jsonResponse, renderWithProviders } from "../../test/render";
import { UploadCard } from "./UploadCard";

function setup(retentionDays = 30) {
  const fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", fetchMock);
  // applyAccept off: the client-side check must hold even if the picker's filter is bypassed.
  const user = userEvent.setup({ applyAccept: false });
  renderWithProviders(
    <UploadCard defaultView="employee" retentionDays={retentionDays} />,
    {
      path: "/",
    },
  );
  const input = screen.getByLabelText("Choose a file");
  const submit = screen.getByRole("button", { name: "Rate contract" });
  return { user, input, submit, fetchMock };
}

describe("UploadCard", () => {
  it("rejects a non-PDF file before uploading", async () => {
    const { user, input, submit, fetchMock } = setup();

    await user.upload(input, fakeFile("contract.docx", "application/msword", 2000));

    expect(screen.getByRole("alert")).toHaveTextContent("This file isn't a PDF.");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(submit).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a PDF larger than 10 MB before uploading", async () => {
    const { user, input, submit, fetchMock } = setup();

    await user.upload(
      input,
      fakeFile("contract.pdf", "application/pdf", MAX_UPLOAD_BYTES + 1),
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "This file is larger than 10 MB.",
    );
    expect(submit).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("needs explicit consent, then uploads the PDF with the chosen view", async () => {
    const { user, input, submit, fetchMock } = setup();
    fetchMock.mockResolvedValue(jsonResponse({ id: "rt_new", status: "queued" }, 202));

    await user.upload(input, fakeFile("contract.pdf", "application/pdf", 400_000));
    expect(screen.getByText("contract.pdf")).toBeInTheDocument();
    expect(submit).toBeDisabled();

    await user.selectOptions(screen.getByLabelText("Open the report in"), "hr");
    await user.click(
      screen.getByLabelText(/I agree that Contract Rater may process this contract/),
    );
    expect(submit).toBeEnabled();
    await user.click(submit);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/v1/ratings");
    expect(init?.method).toBe("POST");
    const form = init?.body as FormData;
    expect(form.get("view")).toBe("hr");
    expect((form.get("file") as File).name).toBe("contract.pdf");
    expect(await screen.findByText("other page")).toBeInTheDocument(); // navigated to the report
  });

  it("explains an unsupported document returned by the API", async () => {
    const { user, input, submit, fetchMock } = setup();
    fetchMock.mockResolvedValue(
      jsonResponse(
        {
          type: "about:blank",
          title: "Unsupported document",
          status: 422,
          code: "unsupported_document",
        },
        422,
        "application/problem+json",
      ),
    );

    await user.upload(input, fakeFile("other.pdf", "application/pdf", 1000));
    await user.click(screen.getByRole("checkbox"));
    await user.click(submit);

    expect(
      await screen.findByText(/couldn't read this as a Qiwa Unified Employment Contract/),
    ).toBeInTheDocument();
  });

  it("shows the API's own reason, such as its real size limit", async () => {
    const { user, input, submit, fetchMock } = setup();
    fetchMock.mockResolvedValue(
      jsonResponse(
        {
          type: "about:blank",
          title: "File too large",
          status: 413,
          code: "file_too_large",
          detail: "The file is larger than 5 MB.",
        },
        413,
        "application/problem+json",
      ),
    );

    await user.upload(
      input,
      fakeFile("contract.pdf", "application/pdf", 7 * 1024 * 1024),
    );
    await user.click(screen.getByRole("checkbox"));
    await user.click(submit);

    expect(await screen.findByText("The file is larger than 5 MB.")).toBeInTheDocument();
    expect(screen.queryByText(/larger than 10 MB/)).not.toBeInTheDocument();
  });

  it("says '1 day', not '1 days', for the shortest retention", () => {
    setup(1);
    expect(screen.getByText(/deleted automatically after 1 day\./)).toBeInTheDocument();
  });
});
