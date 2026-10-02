import type { RefObject } from "react";
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
  return (
    <section className="flex flex-1 flex-col gap-6">
      <h1 ref={headingRef} tabIndex={-1} className="font-sterling text-xl font-semibold text-akiba-ink">
        {prompt}
      </h1>
      <p className="text-xs text-akiba-muted">{safetyGuidance}</p>
      <div className="flex flex-wrap gap-3">
        {photos.map((photo) => (
          <div
            key={photo.localId}
            className="relative flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-xl border border-akiba-line bg-akiba-card p-1 text-center text-[11px] text-akiba-muted"
          >
            {photo.status === "uploading" && "Uploading…"}
            {photo.status === "done" && "Submitted for review"}
            {photo.status === "error" && (
              <>
                <span>Failed</span>
                <button
                  type="button"
                  onClick={() => onRetry(photo.localId)}
                  className="min-h-[20px] font-semibold text-akiba-teal underline"
                >
                  Retry
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() => onRemove(photo.localId)}
              aria-label={photo.status === "error" ? "Remove failed photo" : "Remove photo"}
              className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-white text-akiba-ink shadow"
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
              onChange={(event) => onSelect(event.target.files?.[0])}
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
