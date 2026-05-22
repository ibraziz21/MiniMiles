import { Badge } from "@/components/ui/badge";
import { statusColor, statusLabel } from "@/lib/utils";
import type { OrderStatus } from "@/types";

export function StatusBadge({ status }: { status: OrderStatus }) {
  return <Badge className={statusColor(status)}>{statusLabel(status)}</Badge>;
}
