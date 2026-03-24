interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  trend?: {
    value: number;
    label: string;
  };
  icon?: string;
  accent?: "green" | "indigo" | "amber" | "red" | "blue";
  loading?: boolean;
}

const accentClasses = {
  green: {
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/20",
    text: "text-emerald-400",
    icon: "bg-emerald-500/20",
  },
  indigo: {
    bg: "bg-indigo-500/10",
    border: "border-indigo-500/20",
    text: "text-indigo-400",
    icon: "bg-indigo-500/20",
  },
  amber: {
    bg: "bg-amber-500/10",
    border: "border-amber-500/20",
    text: "text-amber-400",
    icon: "bg-amber-500/20",
  },
  red: {
    bg: "bg-red-500/10",
    border: "border-red-500/20",
    text: "text-red-400",
    icon: "bg-red-500/20",
  },
  blue: {
    bg: "bg-blue-500/10",
    border: "border-blue-500/20",
    text: "text-blue-400",
    icon: "bg-blue-500/20",
  },
};

export default function StatCard({
  title,
  value,
  subtitle,
  trend,
  icon,
  accent = "green",
  loading = false,
}: StatCardProps) {
  const colors = accentClasses[accent];

  if (loading) {
    return (
      <div className="bg-gray-800 rounded-2xl border border-gray-700 p-5 animate-pulse">
        <div className="flex items-start justify-between mb-3">
          <div className="w-9 h-9 rounded-xl bg-gray-700" />
        </div>
        <div className="h-8 bg-gray-700 rounded w-24 mb-2" />
        <div className="h-4 bg-gray-700 rounded w-32" />
      </div>
    );
  }

  const trendPositive = trend && trend.value >= 0;

  return (
    <div className={`bg-gray-800 rounded-2xl border ${colors.border} p-5 hover:border-opacity-40 transition-all`}>
      <div className="flex items-start justify-between mb-3">
        {icon && (
          <div className={`w-9 h-9 rounded-xl ${colors.icon} flex items-center justify-center text-lg`}>
            {icon}
          </div>
        )}
        {trend && (
          <span
            className={`text-xs font-medium px-2 py-0.5 rounded-full ${
              trendPositive
                ? "bg-emerald-500/15 text-emerald-400"
                : "bg-red-500/15 text-red-400"
            }`}
          >
            {trendPositive ? "+" : ""}{trend.value}% {trend.label}
          </span>
        )}
      </div>
      <div className={`text-2xl font-bold ${colors.text} mb-1`}>
        {typeof value === "number" ? value.toLocaleString() : value}
      </div>
      <div className="text-sm text-gray-400">{title}</div>
      {subtitle && <div className="text-xs text-gray-500 mt-1">{subtitle}</div>}
    </div>
  );
}
