import { describe, expect, it } from "vitest";
import { buildNavSections } from "@/components/layout/Sidebar";

function allHrefs(enabled: boolean): string[] {
  const visit = (items: ReturnType<typeof buildNavSections>[number]["items"]): string[] =>
    items.flatMap((item) => [item.href, ...(item.children ? visit(item.children) : [])]);
  return buildNavSections(enabled).flatMap((section) => visit(section.items));
}

describe("funded-voucher Admin navigation", () => {
  it("hides every funded-voucher destination while the Admin flag is off", () => {
    const hrefs = allHrefs(false);
    expect(hrefs).not.toContain("/vouchers/funds");
    expect(hrefs).not.toContain("/vouchers/allocations");
    expect(hrefs).not.toContain("/vouchers/grants");
  });

  it("shows funded-voucher destinations while the Admin flag is on", () => {
    const hrefs = allHrefs(true);
    expect(hrefs).toContain("/vouchers/funds");
    expect(hrefs).toContain("/vouchers/allocations");
    expect(hrefs).toContain("/vouchers/grants");
  });
});
