import type { View } from "@rater/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FileText, FileUp, ShieldCheck, X } from "lucide-react";
import { useId, useState, type ChangeEvent, type DragEvent, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { api } from "../../lib/api";
import { cn } from "../../lib/cn";
import { errorMessage, uploadProblemMessage } from "../../lib/errors";
import { formatMegabytes } from "../../lib/format";
import { queryKeys } from "../../lib/queries";
import { MAX_UPLOAD_MB, validateUpload, type UploadProblem } from "../../lib/upload";
import { Button } from "../ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "../ui/card";
import { Checkbox, Label } from "../ui/input";
import { Select } from "../ui/select";
import { useToast } from "../ui/toast-context";

interface UploadCardProps {
  /** Pre-selected report view. */
  defaultView: View;
  /** Days before the uploaded PDF is deleted. */
  retentionDays: number;
}

export function UploadCard({ defaultView, retentionDays }: UploadCardProps) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const ids = {
    input: useId(),
    problem: useId(),
    consent: useId(),
    view: useId(),
    privacy: useId(),
  };

  const [file, setFile] = useState<File | null>(null);
  const [problem, setProblem] = useState<UploadProblem | null>(null);
  const [view, setView] = useState<View>(defaultView);
  const [consent, setConsent] = useState(false);
  const [dragging, setDragging] = useState(false);

  const upload = useMutation({
    mutationFn: (input: { file: File; view: View }) =>
      api.createRating(input.file, input.view),
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.ratings });
      toast({ kind: "success", message: t("upload.started") });
      void navigate(`/ratings/${created.id}`);
    },
  });

  function choose(candidate: File | undefined) {
    if (!candidate) return;
    upload.reset();
    const found = validateUpload(candidate);
    setProblem(found);
    setFile(found ? null : candidate);
  }

  function onInputChange(event: ChangeEvent<HTMLInputElement>) {
    choose(event.target.files?.[0]);
    event.target.value = ""; // allow picking the same file again after removing it
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    choose(event.dataTransfer.files[0]);
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (file && consent) upload.mutate({ file, view });
  }

  return (
    <Card aria-labelledby="upload-title">
      <form onSubmit={onSubmit} noValidate>
        <CardHeader>
          <CardTitle id="upload-title">{t("upload.title")}</CardTitle>
          <CardDescription>
            {t("upload.description", { max: MAX_UPLOAD_MB })}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-5">
          <div
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={(event) => {
              // Moving over a child also fires dragleave; only reset when leaving the zone.
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                setDragging(false);
              }
            }}
            onDrop={onDrop}
            className={cn(
              "flex flex-col items-center gap-3 rounded-xl border-2 border-dashed px-6 py-8 text-center transition-colors",
              dragging ? "border-primary bg-primary-soft" : "border-border bg-muted/40",
            )}
          >
            {file ? (
              <div className="flex w-full max-w-md items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 text-start">
                <FileText aria-hidden="true" className="size-5 shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium" dir="auto">
                    {file.name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t("upload.size", {
                      size: formatMegabytes(file.size, i18n.language),
                    })}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setFile(null)}
                  aria-label={t("upload.remove")}
                >
                  <X aria-hidden="true" />
                </Button>
              </div>
            ) : (
              <>
                <FileUp aria-hidden="true" className="size-8 text-muted-foreground" />
                <p className="text-sm font-medium">{t("upload.dropzone")}</p>
                <p className="text-xs text-muted-foreground">{t("upload.or")}</p>
              </>
            )}
            <input
              id={ids.input}
              type="file"
              accept="application/pdf,.pdf"
              onChange={onInputChange}
              aria-describedby={problem ? ids.problem : undefined}
              aria-invalid={problem ? true : undefined}
              className="peer sr-only"
            />
            <label
              htmlFor={ids.input}
              className={cn(
                "inline-flex h-9 cursor-pointer items-center rounded-lg border border-input bg-card px-4 text-sm font-medium shadow-xs hover:bg-accent",
                "peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring",
              )}
            >
              {file ? t("upload.replace") : t("upload.browse")}
            </label>
          </div>

          {problem && (
            <p
              id={ids.problem}
              role="alert"
              className="text-sm font-medium text-critical-ink"
            >
              {uploadProblemMessage(t, problem)}
            </p>
          )}

          <div className="grid gap-1.5 sm:max-w-xs">
            <Label htmlFor={ids.view}>{t("upload.viewLabel")}</Label>
            <Select
              id={ids.view}
              value={view}
              onChange={(event) => setView(event.target.value as View)}
            >
              <option value="employee">{t("ratings.view.employee")}</option>
              <option value="hr">{t("ratings.view.hr")}</option>
            </Select>
            <p className="text-xs text-muted-foreground">{t("upload.viewHint")}</p>
          </div>

          <div
            id={ids.privacy}
            className="flex gap-3 rounded-lg bg-info-soft/60 p-4 text-sm"
          >
            <ShieldCheck
              aria-hidden="true"
              className="mt-0.5 size-5 shrink-0 text-info-ink"
            />
            <div className="space-y-1">
              <p className="font-medium">{t("upload.privacyTitle")}</p>
              <p className="text-muted-foreground">
                {t("upload.privacyBody", { count: retentionDays })}
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <Checkbox
              id={ids.consent}
              checked={consent}
              onChange={(event) => setConsent(event.target.checked)}
              aria-describedby={ids.privacy}
              required
            />
            <Label htmlFor={ids.consent} className="font-normal">
              {t("upload.consent")}
            </Label>
          </div>

          {upload.isError && (
            <p
              role="alert"
              className="rounded-lg bg-critical-soft px-4 py-3 text-sm text-critical-ink"
            >
              {errorMessage(t, upload.error)}
            </p>
          )}
        </CardContent>

        <CardFooter className="justify-between">
          <p className="text-xs text-muted-foreground">{t("upload.notLegalAdvice")}</p>
          <Button type="submit" disabled={!file || !consent} loading={upload.isPending}>
            {upload.isPending ? t("upload.submitting") : t("upload.submit")}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
