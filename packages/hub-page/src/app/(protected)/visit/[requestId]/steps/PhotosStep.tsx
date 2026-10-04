import { useEffect, useRef, type RefObject } from "react";
import type { PhotoUpload } from "./types";

export function PhotosStep({
  prompt,
  safetyGuidance,
  photos,
  maxPhotos,
  acceptedTypes,
  hasActiveUpload,
  onSelect,
  onRemove,
  onRetry,
  onDone,
  headingRef,
}: {
  prompt: string;
  safetyGuidance: string;
  photos: PhotoUpload[];
  maxPhotos: number;
  acceptedTypes: string[];
  hasActiveUpload: boolean;
  onSelect: (file: File | undefined) => void;
  onRemove: (localId: string) => void;
  onRetry: (localId: string) => void;
  onDone: () => void;
  headingRef: RefObject<HTMLHeadingElement>;
}) {
  const firstErrorRef = useRef<HTMLDivElement>(null);
  const errorCount = photos.filter((photo) => photo.status === "error").length;
  useEffect(() => {
    if (errorCount > 0) firstErrorRef.current?.focus();
  }, [errorCount]);

  return (
    <section className="flex flex-1 flex-col gap-6">
      <h1 ref={headingRef} tabIndex={-1} className="font-sterling text-xl font-semibold text-akiba-ink">
        {prompt}
      </h1>
      <p className="text-xs text-akiba-muted">{safetyGuidance}</p>
      <div className="flex flex-wrap gap-3">
        {photos.map((photo, index) => (
          <div
            key={photo.localId}
            ref={photo.status === "error" && index === photos.findIndex((candidate) => candidate.status === "error") ? firstErrorRef : undefined}
            tabIndex={photo.status === "error" ? -1 : undefined}
            className="relative flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-xl border border-akiba-line bg-akiba-card p-1 text-center text-[11px] text-akiba-muted"
          >
            {photo.status === "uploading" && "Uploading…"}
            {photo.status === "done" && "Submitted for review"}
            {photo.status === "error" && (
              <>
                <span className="max-w-full truncate" title={photo.file.name}>Failed: {photo.file.name}</span>
                <button
                  type="button"
                  onClick={() => onRetry(photo.localId)}
                  aria-label={`Retry ${photo.file.name}`}
                  className="min-h-[44px] px-2 font-semibold text-akiba-teal underline"
                >
                  Retry
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() => onRemove(photo.localId)}
              aria-label={`Remove ${photo.file.name}`}
              className="absolute -right-3 -top-3 flex h-11 w-11 items-center justify-center rounded-full bg-white text-xl text-akiba-ink shadow"
            >
              ×
            </button>
          </div>
        ))}
        {photos.filter((p) => p.status !== "error").length < maxPhotos && (
          <label className="flex h-20 w-20 min-h-[44px] cursor-pointer items-center justify-center rounded-xl border border-dashed border-akiba-line text-xs text-akiba-muted">
            Add photo
            <input
              type="file"
              accept={acceptedTypes.join(",")}
              className="sr-only"
              onChange={(event) => {
                onSelect(event.target.files?.[0]);
                event.currentTarget.value = "";
              }}
            />
          </label>
        )}
      </div>
      <p className="sr-only" role="status" aria-live="polite">
        {hasActiveUpload
          ? "Uploading photo…"
          : photos.some((p) => p.status === "error")
            ? "A photo failed to upload. Retry or remove it to continue."
            : photos.length > 0
              ? "Photo submitted for review."
              : ""}
      </p>
      <div className="mt-auto flex flex-col gap-3">
        <button
          type="button"
          onClick={onDone}
          disabled={hasActiveUpload}
          aria-disabled={hasActiveUpload}
          className="min-h-[48px] rounded-full bg-akiba-teal px-6 py-3 text-sm font-semibold text-white disabled:opacity-60"
        >
          {hasActiveUpload ? "Uploading…" : "Done"}
        </button>
      </div>
    </section>
  );
}
