/**
 * Security/safety tests for the photo processing worker (hardening spec
 * §11.3): "unsupported type, forged MIME, corrupt image, excessive
 * dimensions and oversized files fail safely." The worker decodes with
 * sharp rather than trusting the client's declared content type — a forged
 * MIME or genuinely corrupt file both surface as a decode failure here, the
 * same fail-safe path as an oversized/malformed image.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const sharpState = vi.hoisted(() => ({
  metadata: null as { width: number; height: number } | null,
  metadataError: null as Error | null,
  toBufferError: null as Error | null,
}));

function makeSharpInstance(): any {
  const instance: Record<string, unknown> = {};
  instance.rotate = vi.fn(() => instance);
  instance.resize = vi.fn(() => instance);
  instance.webp = vi.fn(() => instance);
  instance.metadata = vi.fn(async () => {
    if (sharpState.metadataError) throw sharpState.metadataError;
    return sharpState.metadata;
  });
  instance.toBuffer = vi.fn(async () => {
    if (sharpState.toBufferError) throw sharpState.toBufferError;
    return Buffer.from("fake-encoded-image");
  });
  return instance;
}

vi.mock("sharp", () => ({ default: vi.fn(() => makeSharpInstance()) }));

const state = vi.hoisted(() => ({
  photo: null as { private_source_key: string } | null,
  photoError: null as { message: string } | null,
  downloadError: null as { message: string } | null,
  uploadError: null as { message: string } | null,
}));

const mockRpc = vi.fn();
const mockDownload = vi.fn(async (): Promise<{ data: { arrayBuffer: () => Promise<ArrayBuffer> } | null; error: unknown }> => ({
  data: { arrayBuffer: async () => new TextEncoder().encode("source-bytes").buffer },
  error: state.downloadError,
}));
const mockUpload = vi.fn(async () => ({ error: state.uploadError }));

const admin = {
  from: () => ({
    select: () => ({
      eq: () => ({
        maybeSingle: async () => ({ data: state.photo, error: state.photoError }),
      }),
    }),
  }),
  storage: {
    from: () => ({
      download: mockDownload,
      upload: mockUpload,
    }),
  },
  rpc: mockRpc,
};

const { processPendingPhotoJobs } = await import("@/lib/discovery/photoProcessing");

describe("processPendingPhotoJobs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sharpState.metadata = { width: 800, height: 600 };
    sharpState.metadataError = null;
    sharpState.toBufferError = null;
    state.photo = { private_source_key: "contrib/photo.jpg" };
    state.photoError = null;
    state.downloadError = null;
    state.uploadError = null;
    mockDownload.mockImplementation(async () => ({
      data: { arrayBuffer: async () => new TextEncoder().encode("source-bytes").buffer },
      error: state.downloadError,
    }));
    mockRpc.mockImplementation((name: string) => {
      if (name === "claim_photo_processing_jobs") {
        return Promise.resolve({ data: [{ id: "job-1", photo_id: "photo-1" }], error: null });
      }
      if (name === "complete_photo_processing_job") return Promise.resolve({ error: null });
      throw new Error(`Unexpected RPC ${name}`);
    });
  });

  it("processes a well-formed image successfully", async () => {
    const result = await processPendingPhotoJobs(admin as any, 10);
    expect(result).toEqual({ claimed: 1, succeeded: 1, failed: 0 });
    expect(mockRpc).toHaveBeenCalledWith("complete_photo_processing_job", expect.objectContaining({
      p_job_id: "job-1", p_ok: true, p_width: 800, p_height: 600,
    }));
  });

  it("fails safely on a corrupt image / forged MIME (sharp cannot decode it)", async () => {
    // The declared upload content-type passed the upload-intent route's
    // allowlist, but the bytes are not actually a decodable image — sharp's
    // decode failure is the real check, independent of what the client claimed.
    sharpState.metadataError = new Error("Input buffer contains unsupported image format");

    const result = await processPendingPhotoJobs(admin as any, 10);
    expect(result).toEqual({ claimed: 1, succeeded: 0, failed: 1 });
    expect(mockRpc).toHaveBeenCalledWith("complete_photo_processing_job", expect.objectContaining({
      p_job_id: "job-1", p_ok: false,
      p_error: expect.stringContaining("unsupported image format"),
    }));
  });

  it("fails safely on excessive dimensions without attempting to re-encode", async () => {
    sharpState.metadata = { width: 20_000, height: 20_000 };

    const result = await processPendingPhotoJobs(admin as any, 10);
    expect(result).toEqual({ claimed: 1, succeeded: 0, failed: 1 });
    expect(mockRpc).toHaveBeenCalledWith("complete_photo_processing_job", expect.objectContaining({
      p_job_id: "job-1", p_ok: false, p_error: "dimensions_exceed_limit",
    }));
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it("fails safely on excessive pixel count even within the per-dimension limit", async () => {
    // 7000x7000 is under the 8000px per-side cap individually but well over
    // the 40-megapixel product cap — both limits must be enforced.
    sharpState.metadata = { width: 7000, height: 7000 };

    const result = await processPendingPhotoJobs(admin as any, 10);
    expect(result.succeeded).toBe(0);
    expect(mockRpc).toHaveBeenCalledWith("complete_photo_processing_job", expect.objectContaining({
      p_ok: false, p_error: "dimensions_exceed_limit",
    }));
  });

  it("fails safely when the source photo row is missing", async () => {
    state.photo = null;
    const result = await processPendingPhotoJobs(admin as any, 10);
    expect(result).toEqual({ claimed: 1, succeeded: 0, failed: 1 });
    expect(mockRpc).toHaveBeenCalledWith("complete_photo_processing_job", expect.objectContaining({
      p_ok: false, p_error: "photo_row_missing",
    }));
  });

  it("fails safely when the private source download fails", async () => {
    state.downloadError = { message: "object not found" };
    mockDownload.mockResolvedValueOnce({ data: null, error: state.downloadError });
    const result = await processPendingPhotoJobs(admin as any, 10);
    expect(result).toEqual({ claimed: 1, succeeded: 0, failed: 1 });
  });

  it("never marks a job done when the re-encoded derivative fails to upload", async () => {
    state.uploadError = { message: "storage quota exceeded" };
    const result = await processPendingPhotoJobs(admin as any, 10);
    expect(result).toEqual({ claimed: 1, succeeded: 0, failed: 1 });
    expect(mockRpc).toHaveBeenCalledWith("complete_photo_processing_job", expect.objectContaining({ p_ok: false }));
  });
});
