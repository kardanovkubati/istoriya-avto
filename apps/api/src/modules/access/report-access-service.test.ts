import { describe, expect, it } from "bun:test";
import { createLockedReportAccessService } from "./report-access-service";

describe("report access service", () => {
  it("denies full report access in Milestone 3 without mutating ledger state", async () => {
    const service = createLockedReportAccessService();

    await expect(
      service.canViewFullReport({
        vin: "XTA210990Y2765499",
        userId: null,
        guestSessionId: null
      })
    ).resolves.toEqual({
      status: "locked",
      options: ["upload_report", "choose_plan"],
      willSpendPoints: false,
      warning:
        "Перед открытием проверьте, что выбран нужный автомобиль. Если выбрать другой автомобиль, балл не возвращается."
    });
  });
});
