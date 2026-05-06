export function Section({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="bg-[#13161F] border border-white/5 rounded-xl p-5">
      <div className="mb-4">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-400">{title}</h2>
        {sub && <p className="text-[10px] text-gray-600 mt-1 leading-relaxed">{sub}</p>}
      </div>
      {children}
    </div>
  );
}
