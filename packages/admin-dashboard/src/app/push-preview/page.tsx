import { PushCampaignComposer } from "@/components/push/PushCampaignComposer";

export default function PushPreviewPage() {
  return (
    <main className="min-h-screen bg-slate-50 p-8">
      <div className="mx-auto max-w-6xl">
        <PushCampaignComposer audienceCount={248} />
      </div>
    </main>
  );
}
