export type AccessMethod = "already_opened" | "subscription_limit" | "point";

export type ReportAccessVehicle = {
  id: string;
  vin: string;
};

export type VehicleAccess = {
  id: string;
  userId: string;
  vehicleId: string;
  accessMethod: AccessMethod;
  firstAccessedAt: Date;
};

export type ActiveSubscription = {
  id: string;
  userId: string;
  plan: {
    code: string;
    name: string;
  };
  remainingReports: number;
};

export type UserEntitlements = {
  plan: { code: string; name: string } | null;
  remainingReports: number;
  points: number;
};

export type CommitUnlockResult =
  | {
      status: "granted";
      method: Exclude<AccessMethod, "already_opened">;
      access: VehicleAccess;
    }
  | {
      status: "already_opened";
      access: VehicleAccess;
    }
  | {
      status: "payment_required";
    };

export interface ReportAccessRepository {
  findVehicleByVin(vin: string): Promise<ReportAccessVehicle | null>;
  findVehicleById(vehicleId: string): Promise<ReportAccessVehicle | null>;
  findVehicleAccess(input: { userId: string; vehicleId: string }): Promise<VehicleAccess | null>;
  findActiveSubscription(input: {
    userId: string;
    now: Date;
  }): Promise<ActiveSubscription | null>;
  decrementSubscriptionReport(input: { subscriptionId: string }): Promise<ActiveSubscription>;
  createVehicleAccess(input: {
    userId: string;
    vehicleId: string;
    accessMethod: AccessMethod;
  }): Promise<VehicleAccess>;
  commitUnlock(input: {
    userId: string;
    vehicleId: string;
    idempotencyKey: string;
    now: Date;
  }): Promise<CommitUnlockResult>;
  getEntitlements(input: { userId: string; now: Date }): Promise<UserEntitlements>;
}
