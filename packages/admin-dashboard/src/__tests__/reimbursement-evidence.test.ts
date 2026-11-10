import { it, expect } from "vitest";
import { evidenceExtension } from "@/lib/reimbursementEvidence";
it("accepts supported file signatures and rejects spoofed MIME types", () => {
  expect(
    evidenceExtension(new TextEncoder().encode("%PDF-1.7"), "application/pdf")
  ).toBe("pdf");
  expect(
    evidenceExtension(
      Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]),
      "image/png"
    )
  ).toBe("png");
  expect(
    evidenceExtension(Uint8Array.from([255, 216, 255]), "image/jpeg")
  ).toBe("jpg");
  expect(
    evidenceExtension(new TextEncoder().encode("<script>"), "application/pdf")
  ).toBe(null);
  expect(
    evidenceExtension(new TextEncoder().encode("%PDF-1.7"), "image/png")
  ).toBe(null);
});
