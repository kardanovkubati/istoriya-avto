import { and, desc, eq, gt, lte, sql } from "drizzle-orm";
import type { Database } from "../../db/client";
import {
  subscriptionPlans,
  subscriptions,
  users,
  vehicleAccesses,
  vehicles
} from "../../db/schema";
import type {
  AccessMethod,
  ActiveSubscription,
  ReportAccessRepository,
  ReportAccessVehicle,
  UserEntitlements,
  VehicleAccess
} from "./report-access-repository";

export class DrizzleReportAccessRepository implements ReportAccessRepository {
  constructor(private readonly db: Database) {}

  async findVehicleByVin(vin: string): Promise<ReportAccessVehicle | null> {
    const rows = await this.db
      .select({ id: vehicles.id, vin: vehicles.vin })
      .from(vehicles)
      .where(eq(vehicles.vin, vin))
      .limit(1);

    return rows[0] ?? null;
  }

  async findVehicleById(vehicleId: string): Promise<ReportAccessVehicle | null> {
    const rows = await this.db
      .select({ id: vehicles.id, vin: vehicles.vin })
      .from(vehicles)
      .where(eq(vehicles.id, vehicleId))
      .limit(1);

    return rows[0] ?? null;
  }

  async findVehicleAccess(input: {
    userId: string;
    vehicleId: string;
  }): Promise<VehicleAccess | null> {
    const rows = await this.db
      .select()
      .from(vehicleAccesses)
      .where(
        and(
          eq(vehicleAccesses.userId, input.userId),
          eq(vehicleAccesses.vehicleId, input.vehicleId)
        )
      )
      .limit(1);

    return rows[0] ? mapVehicleAccess(rows[0]) : null;
  }

  async findActiveSubscription(input: {
    userId: string;
    now: Date;
  }): Promise<ActiveSubscription | null> {
    const rows = await this.db
      .select({
        id: subscriptions.id,
        userId: subscriptions.userId,
        remainingReports: subscriptions.remainingReports,
        planCode: subscriptionPlans.code,
        planName: subscriptionPlans.name
      })
      .from(subscriptions)
      .innerJoin(subscriptionPlans, eq(subscriptions.planId, subscriptionPlans.id))
      .where(
        and(
          eq(subscriptions.userId, input.userId),
          eq(subscriptions.status, "active"),
          lte(subscriptions.currentPeriodStart, input.now),
          gt(subscriptions.currentPeriodEnd, input.now)
        )
      )
      .orderBy(desc(subscriptions.remainingReports), desc(subscriptions.currentPeriodEnd))
      .limit(1);

    return rows[0] ? mapActiveSubscription(rows[0]) : null;
  }

  async decrementSubscriptionReport(input: {
    subscriptionId: string;
  }): Promise<ActiveSubscription> {
    const now = new Date();
    const updated = await this.db
      .update(subscriptions)
      .set({
        remainingReports: sql`${subscriptions.remainingReports} - 1`,
        updatedAt: now
      })
      .where(
        and(eq(subscriptions.id, input.subscriptionId), gt(subscriptions.remainingReports, 0))
      )
      .returning({
        id: subscriptions.id
      });

    if (!updated[0]) {
      throw new Error("subscription_report_unavailable");
    }

    const rows = await this.db
      .select({
        id: subscriptions.id,
        userId: subscriptions.userId,
        remainingReports: subscriptions.remainingReports,
        planCode: subscriptionPlans.code,
        planName: subscriptionPlans.name
      })
      .from(subscriptions)
      .innerJoin(subscriptionPlans, eq(subscriptions.planId, subscriptionPlans.id))
      .where(eq(subscriptions.id, input.subscriptionId))
      .limit(1);

    if (!rows[0]) {
      throw new Error("subscription_not_found_after_decrement");
    }

    return mapActiveSubscription(rows[0]);
  }

  async createVehicleAccess(input: {
    userId: string;
    vehicleId: string;
    accessMethod: AccessMethod;
  }): Promise<VehicleAccess> {
    const now = new Date();
    const inserted = await this.db
      .insert(vehicleAccesses)
      .values({
        userId: input.userId,
        vehicleId: input.vehicleId,
        accessMethod: input.accessMethod,
        firstAccessedAt: now,
        createdAt: now,
        updatedAt: now
      })
      .onConflictDoNothing()
      .returning();

    if (inserted[0]) {
      return mapVehicleAccess(inserted[0]);
    }

    const existing = await this.findVehicleAccess({
      userId: input.userId,
      vehicleId: input.vehicleId
    });
    if (existing === null) {
      throw new Error("vehicle_access_insert_conflict_without_existing_row");
    }
    return existing;
  }

  async getEntitlements(userId: string): Promise<UserEntitlements> {
    const userRows = await this.db
      .select({ points: users.pointsBalance })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    const activeSubscription = await this.findActiveSubscription({
      userId,
      now: new Date()
    });

    return {
      plan: activeSubscription?.plan ?? null,
      remainingReports: activeSubscription?.remainingReports ?? 0,
      points: userRows[0]?.points ?? 0
    };
  }
}

function mapActiveSubscription(row: {
  id: string;
  userId: string;
  remainingReports: number;
  planCode: string;
  planName: string;
}): ActiveSubscription {
  return {
    id: row.id,
    userId: row.userId,
    remainingReports: row.remainingReports,
    plan: {
      code: row.planCode,
      name: row.planName
    }
  };
}

function mapVehicleAccess(row: typeof vehicleAccesses.$inferSelect): VehicleAccess {
  return {
    id: row.id,
    userId: row.userId,
    vehicleId: row.vehicleId,
    accessMethod: row.accessMethod as AccessMethod,
    firstAccessedAt: row.firstAccessedAt
  };
}
