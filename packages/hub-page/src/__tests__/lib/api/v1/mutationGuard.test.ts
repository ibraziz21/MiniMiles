import { describe, expect, it } from "vitest";
import {
  assertMutationAllowed,
  ForbiddenOriginError,
  UnsupportedContentTypeError,
} from "@/lib/api/v1/mutationGuard";
import type { RequestActor } from "@/lib/auth/requestActor";

const cookieActor: RequestActor = { userId: "u1", email: "a@example.com", authMode: "cookie", accessToken: "token-1" };
const bearerActor: RequestActor = { userId: "u1", email: "a@example.com", authMode: "bearer", accessToken: "token-2" };

function sameOriginReq() {
  return new Request("http://localhost/api/v1/merchants/acme/save", {
    method: "POST",
    headers: { origin: "http://localhost", "content-type": "application/json" },
  });
}

function crossOriginReq() {
  return new Request("http://localhost/api/v1/merchants/acme/save", {
    method: "POST",
    headers: { origin: "https://evil.example", "content-type": "application/json" },
  });
}

function bearerReqNoOrigin(contentType = "application/json") {
  return new Request("http://localhost/api/v1/merchants/acme/save", {
    method: "POST",
    headers: { "content-type": contentType },
  });
}

describe("assertMutationAllowed", () => {
  it("allows a cookie-authenticated same-origin mutation", async () => {
    await expect(assertMutationAllowed(sameOriginReq(), cookieActor)).resolves.toBeUndefined();
  });

  it("rejects a cookie-authenticated cross-origin mutation", async () => {
    await expect(assertMutationAllowed(crossOriginReq(), cookieActor)).rejects.toBeInstanceOf(
      ForbiddenOriginError,
    );
  });

  it("allows a bearer-authenticated mutation with no Origin header at all", async () => {
    await expect(assertMutationAllowed(bearerReqNoOrigin(), bearerActor)).resolves.toBeUndefined();
  });

  it("rejects a bearer-authenticated mutation with a non-JSON content type", async () => {
    await expect(
      assertMutationAllowed(bearerReqNoOrigin("text/plain"), bearerActor),
    ).rejects.toBeInstanceOf(UnsupportedContentTypeError);
  });
});
