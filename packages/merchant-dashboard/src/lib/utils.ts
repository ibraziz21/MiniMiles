import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { OrderStatus } from "@/types";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-KE", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function statusLabel(status: OrderStatus): string {
  const map: Record<OrderStatus, string> = {
    placed: "Placed",
    accepted: "Accepted",
    packed: "Packed",
    out_for_delivery: "Out for Delivery",
    delivered: "Delivered",
    received: "Received",
    completed: "Completed",
    cancelled: "Cancelled",
  };
  return map[status] ?? status;
}

export function statusColor(status: OrderStatus): string {
  const map: Record<OrderStatus, string> = {
    placed: "bg-yellow-100 text-yellow-800",
    accepted: "bg-blue-100 text-blue-800",
    packed: "bg-indigo-100 text-indigo-800",
    out_for_delivery: "bg-purple-100 text-purple-800",
    delivered: "bg-teal-100 text-teal-800",
    received: "bg-green-100 text-green-800",
    completed: "bg-green-200 text-green-900",
    cancelled: "bg-red-100 text-red-800",
  };
  return map[status] ?? "bg-gray-100 text-gray-800";
}
