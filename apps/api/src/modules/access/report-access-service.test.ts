import { describe, expect, it } from "bun:test";
import type { PointsLedgerMutationResult } from "../points/points-ledger-repository";
import type { PointsLedgerService } from "../points/points-ledger-service";
import type {
  ActiveSubscription,
  CommitUnlockResult,
  ReportAccessRepository,
  UserEntitlements,
  VehicleAccess
} from "./report-access-repository";
import { ReportAccessService } from "./report-access-service";

const NOW = new Date("2026-05-14T10:00:00.000Z");
const VIN = "XTA210990Y2765499";

describe("ReportAccessService", () => {
  it("grants an already opened vehicle without spending subscription or points", async () => {
    const repository = new FakeReportAccessRepository();
    repository.commitResult = {
      status: "already_opened",
      access: access({ accessMethod: "point" })
    };
    const points = new FakePointsLedgerService();
    const service = createService(repository, points);

    const result = await service.unlock({
      vehicle: { kind: "vin", vin: VIN },
      userId: "user-1",
      guestSessionId: null,
      idempotencyKey: "unlock-1"
    });

    expect(result).toMatchObject({
      status: "granted",
      method: "already_opened",
      vehicleId: "vehicle-1",
      vin: VIN
    });
    expect(repository.commitCalls).toEqual([
      {
        userId: "user-1",
        vehicleId: "vehicle-1",
        idempotencyKey: "unlock-1",
        now: NOW
      }
    ]);
    expect(repository.decrementCalls).toEqual([]);
    expect(points.spendCalls).toEqual([]);
    expect(repository.accesses).toHaveLength(1);
  });

  it("requires auth for guest previews, unlock commits, and full report access", async () => {
    const repository = new FakeReportAccessRepository();
    const service = createService(repository, new FakePointsLedgerService());

    await expect(
      service.previewUnlock({
        vehicle: { kind: "vin", vin: VIN },
        userId: null,
        guestSessionId: "guest-1"
      })
    ).resolves.toMatchObject({
      status: "auth_required",
      vinMasked: "XTA2109********99"
    });

    await expect(
      service.unlock({
        vehicle: { kind: "vin", vin: VIN },
        userId: null,
        guestSessionId: "guest-1",
        idempotencyKey: "unlock-guest"
      })
    ).resolves.toMatchObject({
      status: "auth_required",
      vinMasked: "XTA2109********99"
    });

    await expect(
      service.canViewFullReport({
        vin: VIN,
        userId: null,
        guestSessionId: "guest-1"
      })
    ).resolves.toMatchObject({
      status: "auth_required",
      vinMasked: "XTA2109********99"
    });
    expect(repository.decrementCalls).toEqual([]);
  });

  it("unlocks through an active subscription limit before points", async () => {
    const repository = new FakeReportAccessRepository();
    repository.entitlements = entitlements({ remainingReports: 1, points: 5 });
    repository.commitResult = {
      status: "granted",
      method: "subscription_limit",
      access: access({ accessMethod: "subscription_limit" })
    };
    const points = new FakePointsLedgerService();
    const service = createService(repository, points);

    const result = await service.unlock({
      vehicle: { kind: "vin", vin: VIN },
      userId: "user-1",
      guestSessionId: null,
      idempotencyKey: "unlock-subscription"
    });

    expect(result).toMatchObject({
      status: "granted",
      method: "subscription_limit",
      entitlements: {
        remainingReports: 1,
        points: 5
      }
    });
    expect(repository.commitCalls).toHaveLength(1);
    expect(repository.decrementCalls).toEqual([]);
    expect(points.spendCalls).toEqual([]);
    expect(repository.accesses).toMatchObject([
      {
        userId: "user-1",
        vehicleId: "vehicle-1",
        accessMethod: "subscription_limit"
      }
    ]);
  });

  it("unlocks through a point when subscription limit is unavailable", async () => {
    const repository = new FakeReportAccessRepository();
    repository.entitlements = entitlements({ remainingReports: 0, points: 1 });
    repository.commitResult = {
      status: "granted",
      method: "point",
      access: access({ accessMethod: "point" })
    };
    const points = new FakePointsLedgerService();
    const service = createService(repository, points);

    const result = await service.unlock({
      vehicle: { kind: "vin", vin: VIN },
      userId: "user-1",
      guestSessionId: null,
      idempotencyKey: "unlock-point"
    });

    expect(result).toMatchObject({
      status: "granted",
      method: "point",
      entitlements: {
        remainingReports: 0,
        points: 1
      }
    });
    expect(repository.commitCalls).toEqual([
      {
        userId: "user-1",
        vehicleId: "vehicle-1",
        idempotencyKey: "unlock-point",
        now: NOW
      }
    ]);
    expect(repository.decrementCalls).toEqual([]);
    expect(points.spendCalls).toEqual([]);
    expect(repository.accesses[0]?.accessMethod).toBe("point");
  });

  it("returns payment_required when neither subscription limit nor points are available", async () => {
    const repository = new FakeReportAccessRepository();
    repository.entitlements = entitlements({ remainingReports: 0, points: 0 });
    repository.commitResult = { status: "payment_required" };
    const points = new FakePointsLedgerService();
    const service = createService(repository, points);

    const result = await service.unlock({
      vehicle: { kind: "vin", vin: VIN },
      userId: "user-1",
      guestSessionId: null,
      idempotencyKey: "unlock-empty"
    });

    expect(result).toMatchObject({
      status: "payment_required",
      vinMasked: "XTA2109********99",
      willSpendPoints: false
    });
    expect(repository.decrementCalls).toEqual([]);
    expect(points.spendCalls).toEqual([]);
    expect(repository.accesses).toEqual([]);
  });

  it("uses the same now for atomic commit and entitlement reads", async () => {
    const repository = new FakeReportAccessRepository();
    repository.entitlements = entitlements({ remainingReports: 0, points: 0 });
    repository.commitResult = {
      status: "already_opened",
      access: access({ accessMethod: "point" })
    };
    const service = createService(repository, new FakePointsLedgerService());

    await service.unlock({
      vehicle: { kind: "vin", vin: VIN },
      userId: "user-1",
      guestSessionId: null,
      idempotencyKey: "unlock-now"
    });

    expect(repository.commitCalls[0]?.now).toEqual(NOW);
    expect(repository.entitlementCalls).toEqual([{ userId: "user-1", now: NOW }]);
  });

  it("does not separately spend when atomic commit cannot grant access", async () => {
    const repository = new FakeReportAccessRepository();
    repository.commitResult = { status: "payment_required" };
    const points = new FakePointsLedgerService();
    const service = createService(repository, points);

    const result = await service.unlock({
      vehicle: { kind: "vin", vin: VIN },
      userId: "user-1",
      guestSessionId: null,
      idempotencyKey: "unlock-partial-safe"
    });

    expect(result).toMatchObject({ status: "payment_required" });
    expect(repository.decrementCalls).toEqual([]);
    expect(points.spendCalls).toEqual([]);
    expect(repository.accesses).toEqual([]);
  });

  it("does not spend twice when an unlock commit is retried with the same idempotency key", async () => {
    const repository = new FakeReportAccessRepository();
    repository.entitlements = entitlements({ remainingReports: 0, points: 0 });
    repository.commitResults.push(
      {
        status: "granted",
        method: "point",
        access: access({ accessMethod: "point" })
      },
      {
        status: "already_opened",
        access: access({ accessMethod: "point" })
      }
    );
    const points = new FakePointsLedgerService();
    const service = createService(repository, points);

    const first = await service.unlock({
      vehicle: { kind: "vin", vin: VIN },
      userId: "user-1",
      guestSessionId: null,
      idempotencyKey: "unlock-retry"
    });
    const second = await service.unlock({
      vehicle: { kind: "vin", vin: VIN },
      userId: "user-1",
      guestSessionId: null,
      idempotencyKey: "unlock-retry"
    });

    expect(first).toMatchObject({ status: "granted", method: "point" });
    expect(second).toMatchObject({ status: "granted", method: "already_opened" });
    expect(points.spendCalls).toHaveLength(0);
    expect(repository.accesses).toHaveLength(1);
  });

  it("uses one access record to open a VIN forever without spending on later full report reads", async () => {
    const repository = new FakeReportAccessRepository();
    repository.accesses.push(access({ accessMethod: "subscription_limit" }));
    const points = new FakePointsLedgerService();
    const service = createService(repository, points);

    await expect(
      service.canViewFullReport({
        vin: VIN,
        userId: "user-1",
        guestSessionId: null
      })
    ).resolves.toEqual({
      status: "granted",
      method: "already_opened",
      vehicleId: "vehicle-1"
    });
    expect(repository.decrementCalls).toEqual([]);
    expect(points.spendCalls).toEqual([]);
  });

  it("ignores expired, canceled, and payment_failed subscriptions at now", async () => {
    const repository = new FakeReportAccessRepository();
    repository.entitlements = entitlements({ remainingReports: 0, points: 0 });
    repository.subscriptions.push(
      subscription({
        id: "expired-sub",
        status: "active",
        remainingReports: 3,
        currentPeriodStart: new Date("2026-04-01T00:00:00.000Z"),
        currentPeriodEnd: new Date("2026-05-01T00:00:00.000Z")
      }),
      subscription({
        id: "canceled-sub",
        status: "canceled",
        remainingReports: 3,
        currentPeriodStart: new Date("2026-05-01T00:00:00.000Z"),
        currentPeriodEnd: new Date("2026-06-01T00:00:00.000Z")
      }),
      subscription({
        id: "failed-sub",
        status: "payment_failed",
        remainingReports: 3,
        currentPeriodStart: new Date("2026-05-01T00:00:00.000Z"),
        currentPeriodEnd: new Date("2026-06-01T00:00:00.000Z")
      })
    );
    const service = createService(repository, new FakePointsLedgerService());

    await expect(
      service.previewUnlock({
        vehicle: { kind: "vin", vin: VIN },
        userId: "user-1",
        guestSessionId: null
      })
    ).resolves.toMatchObject({
      status: "payment_required"
    });
  });

  it("unlocks by vehicleId for search candidates", async () => {
    const repository = new FakeReportAccessRepository();
    repository.entitlements = entitlements({ remainingReports: 0, points: 0 });
    repository.commitResult = {
      status: "granted",
      method: "point",
      access: access({ accessMethod: "point" })
    };
    const points = new FakePointsLedgerService();
    const service = createService(repository, points);

    const result = await service.unlock({
      vehicle: { kind: "vehicle_id", vehicleId: "vehicle-1" },
      userId: "user-1",
      guestSessionId: null,
      idempotencyKey: "unlock-by-id"
    });

    expect(result).toMatchObject({
      status: "granted",
      method: "point",
      vehicleId: "vehicle-1",
      vin: VIN
    });
    expect(repository.commitCalls[0]?.vehicleId).toBe("vehicle-1");
    expect(points.spendCalls).toEqual([]);
  });
});

function createService(
  repository: FakeReportAccessRepository,
  points: FakePointsLedgerService
): ReportAccessService {
  return new ReportAccessService({
    repository,
    pointsLedgerService: points as unknown as Pick<PointsLedgerService, "spendPointForAccess">,
    now: () => new Date(NOW)
  });
}

function entitlements(overrides: Partial<UserEntitlements> = {}): UserEntitlements {
  return {
    plan: null,
    remainingReports: 0,
    points: 0,
    ...overrides
  };
}

function subscription(overrides: Partial<StoredSubscription> = {}): StoredSubscription {
  return {
    id: "sub-1",
    userId: "user-1",
    plan: { code: "pro", name: "Pro" },
    status: "active",
    remainingReports: 1,
    currentPeriodStart: new Date("2026-05-01T00:00:00.000Z"),
    currentPeriodEnd: new Date("2026-06-01T00:00:00.000Z"),
    ...overrides
  };
}

function access(overrides: Partial<VehicleAccess> = {}): VehicleAccess {
  return {
    id: "access-1",
    userId: "user-1",
    vehicleId: "vehicle-1",
    accessMethod: "already_opened",
    firstAccessedAt: new Date("2026-05-14T10:00:00.000Z"),
    ...overrides
  };
}

type StoredSubscription = ActiveSubscription & {
  status: "active" | "canceled" | "expired" | "payment_failed";
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
};

class FakeReportAccessRepository implements ReportAccessRepository {
  vehicles = [{ id: "vehicle-1", vin: VIN }];
  accesses: VehicleAccess[] = [];
  subscriptions: StoredSubscription[] = [];
  entitlements = entitlements();
  decrementCalls: Array<{ subscriptionId: string }> = [];
  commitCalls: Array<{
    userId: string;
    vehicleId: string;
    idempotencyKey: string;
    now: Date;
  }> = [];
  entitlementCalls: Array<{ userId: string; now: Date }> = [];
  commitResult: CommitUnlockResult | null = null;
  commitResults: CommitUnlockResult[] = [];

  async findVehicleByVin(vin: string) {
    return this.vehicles.find((vehicle) => vehicle.vin === vin) ?? null;
  }

  async findVehicleById(vehicleId: string) {
    return this.vehicles.find((vehicle) => vehicle.id === vehicleId) ?? null;
  }

  async findVehicleAccess(input: { userId: string; vehicleId: string }) {
    return (
      this.accesses.find(
        (accessRow) =>
          accessRow.userId === input.userId && accessRow.vehicleId === input.vehicleId
      ) ?? null
    );
  }

  async findActiveSubscription(input: { userId: string; now: Date }) {
    return (
      this.subscriptions.find(
        (row) =>
          row.userId === input.userId &&
          row.status === "active" &&
          row.currentPeriodStart.getTime() <= input.now.getTime() &&
          row.currentPeriodEnd.getTime() > input.now.getTime()
      ) ?? null
    );
  }

  async decrementSubscriptionReport(input: { subscriptionId: string }) {
    this.decrementCalls.push(input);
    const row = this.subscriptions.find(
      (subscriptionRow) => subscriptionRow.id === input.subscriptionId
    );
    if (row === undefined || row.remainingReports <= 0) {
      throw new Error("subscription_report_unavailable");
    }
    row.remainingReports -= 1;
    this.entitlements = {
      ...this.entitlements,
      plan: row.plan,
      remainingReports: row.remainingReports
    };
    return row;
  }

  async createVehicleAccess(input: {
    userId: string;
    vehicleId: string;
    accessMethod: "subscription_limit" | "point";
  }) {
    const existing = await this.findVehicleAccess(input);
    if (existing !== null) {
      return existing;
    }
    const created = access({
      id: `access-${this.accesses.length + 1}`,
      userId: input.userId,
      vehicleId: input.vehicleId,
      accessMethod: input.accessMethod
    });
    this.accesses.push(created);
    return created;
  }

  async commitUnlock(input: {
    userId: string;
    vehicleId: string;
    idempotencyKey: string;
    now: Date;
  }) {
    this.commitCalls.push(input);
    const result = this.commitResults.shift() ?? this.commitResult;
    if (result !== null) {
      if (result.status !== "payment_required") {
        const existing = await this.findVehicleAccess(input);
        if (existing === null) {
          this.accesses.push(result.access);
        }
      }
      return result;
    }

    return { status: "payment_required" as const };
  }

  async getEntitlements(input: { userId: string; now: Date }) {
    this.entitlementCalls.push(input);
    return this.entitlements;
  }
}

class FakePointsLedgerService {
  spendCalls: Array<{ userId: string; vehicleId: string; idempotencyKey: string }> = [];
  balanceAfter = 0;

  async spendPointForAccess(input: {
    userId: string;
    vehicleId: string;
    idempotencyKey: string;
  }): Promise<PointsLedgerMutationResult> {
    this.spendCalls.push(input);
    return {
      status: "applied",
      entry: null,
      ledgerEntryId: "ledger-1",
      balanceAfter: this.balanceAfter,
      reason: "report_access_spend"
    };
  }
}
