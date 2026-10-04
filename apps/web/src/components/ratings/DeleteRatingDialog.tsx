import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import { queryKeys } from "../../lib/queries";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { useToast } from "../ui/toast-context";

interface DeleteRatingDialogProps {
  ratingId: string;
  open: boolean;
  onClose: () => void;
  onDeleted?: () => void;
}

/** Confirms, then deletes the rating, its findings and the uploaded PDF. */
export function DeleteRatingDialog({
  ratingId,
  open,
  onClose,
  onDeleted,
}: DeleteRatingDialogProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();

  const deletion = useMutation({
    mutationFn: () => api.deleteRating(ratingId),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: queryKeys.rating(ratingId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.ratings });
      toast({ kind: "success", message: t("ratings.deleted") });
      onClose();
      onDeleted?.();
    },
    onError: (error) => toast({ kind: "error", message: errorMessage(t, error) }),
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("ratings.deleteTitle")}
      description={t("ratings.deleteBody")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={deletion.isPending}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="danger"
            onClick={() => deletion.mutate()}
            loading={deletion.isPending}
          >
            {t("ratings.delete")}
          </Button>
        </>
      }
    />
  );
}
