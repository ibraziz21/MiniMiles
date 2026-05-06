export function Kpi({
  label, value, sub, accent,
}: { label: string; value: string | number; sub?: string; accent?: boolean | string }) {
  const accentClass = accent === true ? "text-[#0D7A8A]" : typeof accent === "string" ? accent : "text-white";
  return (
    <div className="bg-[#13161F] border border-white/5 rounded-xl p-5">
      <p className="text-xs text-gray-500 uppercase tracking-widest mb-1">{label}</p>
      <p className={`text-2xl font-bold ${accentClass}`}>{value}</p>
      {sub && <p className="text-xs text-gray-500 mt-1">{sub}</p>}
    </div>
  );
}
