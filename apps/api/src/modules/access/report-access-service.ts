import type { PointsLedgerMutationResult } from "../points/points-ledger-repository";
import type { PointsLedgerService } from "../points/points-ledger-service";
import type {
  AccessMethod,
  ReportAccessRepository,
  ReportAccessVehicle,
  UserEntitlements
} from "./report-access-repository";

export type UnlockVehicleInput =
  | { kind: "vin"; vin: string }
  | { kind: "vehicle_id"; vehicleId: string };

export type UnlockAuthRequiredDecision = {
  status: "auth_required";
  vehicleId?: string;
  vinMasked: string;
  options: ["telegram", "max", "phone"];
  message: string;
  warning: string;
};

export type UnlockPaymentRequiredDecision = {
  status: "payment_required";
  vehicleId?: string;
  vinMasked: string;
  options: ["upload_report", "choose_plan"];
  willSpendPoints: false;
  message: string;
};

export type UnlockReadyDecision = {
  status: "ready";
  vehicleId: string;
  vinMasked: string;
  spendOrder: "subscription" | "point";
  willSpendSubscriptionReport: boolean;
  willSpendPoints: boolean;
  pointsBalanceAfter: number;
  remainingReportsAfter: number;
  warning: string;
};

export type UnlockAlreadyOpenedDecision = {
  status: "already_opened";
  vehicleId: string;
  vinMasked: string;
  warning: string;
};

export type UnlockNotFoundDecision = {
  status: "not_found";
};

export type UnlockPreviewDecision =
  | UnlockAuthRequiredDecision
  | UnlockPaymentRequiredDecision
  | UnlockReadyDecision
  | UnlockAlreadyOpenedDecision
  | UnlockNotFoundDecision;

export type UnlockGrantedDecision = {
  status: "granted";
  method: Exclude<AccessMethod, "already_opened"> | "already_opened";
  vehicleId: string;
  vin: string;
  entitlements: UserEntitlements;
};

export type UnlockCommitDecision =
  | UnlockGrantedDecision
  | UnlockAuthRequiredDecision
  | UnlockPaymentRequiredDecision
  | UnlockNotFoundDecision;

export type ReportAccessDecision =
  | {
      status: "granted";
      method: AccessMethod | "test_override";
      vehicleId: string;
    }
  | UnlockAuthRequiredDecision
  | {
      status: "locked";
      vehicleId?: string;
      vinMasked: string;
    };

const WRONG_CANDIDATE_WARNING =
  "Перед открытием проверьте, что выбран нужный автомобиль. Если выбрать другой автомобиль, балл не возвращается.";
const AUTH_REQUIRED_MESSAGE = "Войдите, чтобы закрепить доступ к отчету.";
const PAYMENT_REQUIRED_MESSAGE =
  "Загрузите отчет или выберите тариф, чтобы открыть полный отчет.";

export class ReportAccessService {
  constructor(
    private readonly options: {
      repository: ReportAccessRepository;
      pointsLedgerService: Pick<PointsLedgerService, "spendPointForAccess">;
      now?: () => Date;
    }
  ) {}

  async previewUnlock(input: {
    vehicle: UnlockVehicleInput;
    userId: string | null;
    guestSessionId: string | null;
  }): Promise<UnlockPreviewDecision> {
    const vehicle = await this.resolveVehicle(input.vehicle);
    if (vehicle === null) {
      return { status: "not_found" };
    }

    if (input.userId === null) {
      return this.authRequired(vehicle);
    }

    const access = await this.options.repository.findVehicleAccess({
      userId: input.userId,
      vehicleId: vehicle.id
    });
    if (access !== null) {
      return {
        status: "already_opened",
        vehicleId: vehicle.id,
        vinMasked: maskVin(vehicle.vin),
        warning: WRONG_CANDIDATE_WARNING
      };
    }

    const activeSubscription = await this.options.repository.findActiveSubscription({
      userId: input.userId,
      now: this.now()
    });
    if (activeSubscription !== null && activeSubscription.remainingReports > 0) {
      const entitlements = await this.options.repository.getEntitlements(input.userId);
      return {
        status: "ready",
        vehicleId: vehicle.id,
        vinMasked: maskVin(vehicle.vin),
        spendOrder: "subscription",
        willSpendSubscriptionReport: true,
        willSpendPoints: false,
        pointsBalanceAfter: entitlements.points,
        remainingReportsAfter: Math.max(activeSubscription.remainingReports - 1, 0),
        warning: WRONG_CANDIDATE_WARNING
      };
    }

    const entitlements = await this.options.repository.getEntitlements(input.userId);
    if (entitlements.points > 0) {
      return {
        status: "ready",
        vehicleId: vehicle.id,
        vinMasked: maskVin(vehicle.vin),
        spendOrder: "point",
        willSpendSubscriptionReport: false,
        willSpendPoints: true,
        pointsBalanceAfter: entitlements.points - 1,
        remainingReportsAfter: entitlements.remainingReports,
        warning: WRONG_CANDIDATE_WARNING
      };
    }

    return this.paymentRequired(vehicle);
  }

  async unlock(input: {
    vehicle: UnlockVehicleInput;
    userId: string | null;
    guestSessionId: string | null;
    idempotencyKey: string;
  }): Promise<UnlockCommitDecision> {
    const vehicle = await this.resolveVehicle(input.vehicle);
    if (vehicle === null) {
      return { status: "not_found" };
    }

    if (input.userId === null) {
      return this.authRequired(vehicle);
    }

    const existingAccess = await this.options.repository.findVehicleAccess({
      userId: input.userId,
      vehicleId: vehicle.id
    });
    if (existingAccess !== null) {
      return this.granted(vehicle, "already_opened", await this.entitlements(input.userId));
    }

    const activeSubscription = await this.options.repository.findActiveSubscription({
      userId: input.userId,
      now: this.now()
    });
    if (activeSubscription !== null && activeSubscription.remainingReports > 0) {
      await this.options.repository.decrementSubscriptionReport({
        subscriptionId: activeSubscription.id
      });
      await this.options.repository.createVehicleAccess({
        userId: input.userId,
        vehicleId: vehicle.id,
        accessMethod: "subscription_limit"
      });
      return this.granted(
        vehicle,
        "subscription_limit",
        await this.entitlements(input.userId)
      );
    }

    const entitlements = await this.options.repository.getEntitlements(input.userId);
    if (entitlements.points <= 0) {
      return this.paymentRequired(vehicle);
    }

    const spend = await this.options.pointsLedgerService.spendPointForAccess({
      userId: input.userId,
      vehicleId: vehicle.id,
      idempotencyKey: input.idempotencyKey
    });
    if (spend.status === "denied") {
      return this.paymentRequired(vehicle);
    }

    await this.options.repository.createVehicleAccess({
      userId: input.userId,
      vehicleId: vehicle.id,
      accessMethod: "point"
    });
    return this.granted(vehicle, "point", await this.entitlementsAfterSpend(input.userId, spend));
  }

  async canViewFullReport(input: {
    vin: string;
    userId: string | null;
    guestSessionId: string | null;
  }): Promise<ReportAccessDecision> {
    const vehicle = await this.options.repository.findVehicleByVin(input.vin);
    if (vehicle === null) {
      return { status: "locked", vinMasked: maskVin(input.vin) };
    }

    if (input.userId === null) {
      return this.authRequired(vehicle);
    }

    const access = await this.options.repository.findVehicleAccess({
      userId: input.userId,
      vehicleId: vehicle.id
    });
    if (access !== null) {
      return {
        status: "granted",
        method: "already_opened",
        vehicleId: vehicle.id
      };
    }

    return {
      status: "locked",
      vehicleId: vehicle.id,
      vinMasked: maskVin(vehicle.vin)
    };
  }

  private async resolveVehicle(input: UnlockVehicleInput): Promise<ReportAccessVehicle | null> {
    return input.kind === "vin"
      ? await this.options.repository.findVehicleByVin(input.vin)
      : await this.options.repository.findVehicleById(input.vehicleId);
  }

  private async entitlements(userId: string): Promise<UserEntitlements> {
    return await this.options.repository.getEntitlements(userId);
  }

  private async entitlementsAfterSpend(
    userId: string,
    spend: PointsLedgerMutationResult
  ): Promise<UserEntitlements> {
    const entitlements = await this.entitlements(userId);
    return spend.balanceAfter === null
      ? entitlements
      : { ...entitlements, points: spend.balanceAfter };
  }

  private granted(
    vehicle: ReportAccessVehicle,
    method: UnlockGrantedDecision["method"],
    entitlements: UserEntitlements
  ): UnlockGrantedDecision {
    return {
      status: "granted",
      method,
      vehicleId: vehicle.id,
      vin: vehicle.vin,
      entitlements
    };
  }

  private authRequired(vehicle: ReportAccessVehicle): UnlockAuthRequiredDecision {
    return {
      status: "auth_required",
      vehicleId: vehicle.id,
      vinMasked: maskVin(vehicle.vin),
      options: ["telegram", "max", "phone"],
      message: AUTH_REQUIRED_MESSAGE,
      warning: WRONG_CANDIDATE_WARNING
    };
  }

  private paymentRequired(vehicle: ReportAccessVehicle): UnlockPaymentRequiredDecision {
    return {
      status: "payment_required",
      vehicleId: vehicle.id,
      vinMasked: maskVin(vehicle.vin),
      options: ["upload_report", "choose_plan"],
      willSpendPoints: false,
      message: PAYMENT_REQUIRED_MESSAGE
    };
  }

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }
}

export function maskVin(vin: string): string {
  if (vin.length <= 6) {
    return vin;
  }

  const prefix = vin.slice(0, 7);
  const suffix = vin.slice(-2);
  const hidden = Math.max(vin.length - prefix.length - suffix.length, 0);
  return `${prefix}${"*".repeat(hidden)}${suffix}`;
}

export function createLockedReportAccessService(): ReportAccessService {
  return new ReportAccessService({
    repository: {
      async findVehicleByVin(vin) {
        return { id: "locked", vin };
      },
      async findVehicleById() {
        return null;
      },
      async findVehicleAccess() {
        return null;
      },
      async findActiveSubscription() {
        return null;
      },
      async decrementSubscriptionReport() {
        throw new Error("locked_access_service_cannot_decrement_subscription");
      },
      async createVehicleAccess() {
        throw new Error("locked_access_service_cannot_create_access");
      },
      async getEntitlements() {
        return { plan: null, remainingReports: 0, points: 0 };
      }
    },
    pointsLedgerService: {
      async spendPointForAccess() {
        return {
          status: "denied",
          entry: null,
          ledgerEntryId: null,
          balanceAfter: 0,
          reason: "insufficient_points"
        };
      }
    }
  });
}
