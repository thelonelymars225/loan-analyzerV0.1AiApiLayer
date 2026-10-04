import { useTranslation } from "react-i18next";
import { formatSar } from "../../lib/format";
import { impactColumns } from "../../lib/report";

interface ImpactTableProps {
  kind: string | null;
  sar: Record<string, number>;
}

/** SAR figures of one finding: 1y/5y/10y for end-of-service, contract/default/gap for Art. 77. */
export function ImpactTable({ kind, sar }: ImpactTableProps) {
  const { t, i18n } = useTranslation();
  const columns = impactColumns(kind, sar);
  if (columns.length === 0) return null;

  return (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full min-w-[16rem] border-separate border-spacing-0 text-sm">
        <caption className="mb-2 text-start text-xs font-semibold text-muted-foreground">
          {t(`impact.kind.${kind ?? "other"}`, { defaultValue: t("impact.kind.other") })}
        </caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column}
                scope="col"
                className="border-b border-border bg-muted/60 px-3 py-2 text-start text-xs font-medium text-muted-foreground first:rounded-ss-lg last:rounded-se-lg"
              >
                {t(`impact.column.${column}`, { defaultValue: column })}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            {columns.map((column) => (
              <td key={column} className="px-3 py-2 font-semibold tabular-nums">
                {formatSar(sar[column] ?? 0, i18n.language)}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
