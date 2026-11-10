import { Coffee, ReceiptText, Ticket } from "lucide-react";
import { voucherKind } from "@/lib/voucherPresentation";
export const voucherCanvas = "min-h-[calc(100dvh-88px)] bg-[#FAF8FF]";
export const voucherCard =
  "rounded-card bg-white p-5 shadow-[0_2px_3px_rgba(19,27,46,0.03)]";
export function VoucherSymbol({
  kind,
}: {
  kind: ReturnType<typeof voucherKind>;
}) {
  const Icon =
    kind === "reimbursable" ? ReceiptText : kind === "miles" ? Coffee : Ticket;
  return (
    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control bg-[#EAEDFF] text-primary">
      <Icon className="h-6 w-6" aria-hidden="true" />
    </span>
  );
}
export function VoucherStatus({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex shrink-0 rounded-full px-3 py-1 text-xs font-medium capitalize ${
        ["active", "issued"].includes(status.toLowerCase())
          ? "bg-[#D9F9FC] text-primary-strong"
          : "bg-[#EAEDFF] text-ink-muted"
      }`}
    >
      {status === "pending_approval" ? "Ready to publish" : status.replaceAll("_", " ")}
    </span>
  );
}
export function VoucherFacts({
  items,
}: {
  items: Array<{ label: string; value: React.ReactNode }>;
}) {
  return (
    <dl className="divide-y divide-[#EAEDFF]">
      {items.map((item) => (
        <div
          key={item.label}
          className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 py-4 first:pt-0 last:pb-0"
        >
          <dt className="text-sm text-ink-muted">{item.label}</dt>
          <dd className="max-w-full break-words text-sm font-medium sm:max-w-[70%] sm:text-right">
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
