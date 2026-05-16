import { describe, expect, it } from "bun:test";
import { REPORT_COPY, FORBIDDEN_REPORT_COPY } from "./report-copy";

describe("report copy", () => {
  it("does not use recommendation-style wording in approved report copy", () => {
    const serialized = JSON.stringify(REPORT_COPY).toLowerCase();

    for (const forbidden of FORBIDDEN_REPORT_COPY) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});
