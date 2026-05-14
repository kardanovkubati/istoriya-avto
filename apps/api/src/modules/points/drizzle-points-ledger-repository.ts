import { and, eq, gt, gte, lt, sql } from "drizzle-orm";
import type { Database } from "../../db/client";
import {
  pointLedgerEntries,
  reportFingerprints,
  users
} from "../../db/schema";
import type {
  PointsLedgerDeniedReason,
  PointsLedgerEntry,
  PointsLedgerIdempotencyFingerprint,
  PointsLedgerMutationResult,
  PointsLedgerRepository,
  PointsLedgerRepositoryAdjustInput,
  PointsLedgerRepositoryGrantInput,
  PointsLedgerRepositorySpendInput,
  PointsLedgerResultReason
} from "./points-ledger-repository";
import {
  adjustPointsIdempotencyFingerprint,
  grantReportPointIdempotencyFingerprint,
  resolveIdempotentReplay,
  spendPointForAccessIdempotencyFingerprint
} from "./points-ledger-repository";

type DbTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export class DrizzlePointsLedgerRepository implements PointsLedgerRepository {
  constructor(private readonly db: Database) {}

  async grantReportPoint(
    input: PointsLedgerRepositoryGrantInput
  ): Promise<PointsLedgerMutationResult> {
    try {
      return await this.db.transaction(async (tx) => {
        const replay = await tx
          .select()
          .from(pointLedgerEntries)
          .where(eq(pointLedgerEntries.idempotencyKey, input.idempotencyKey))
          .limit(1);
        if (replay[0]) {
          return resolveIdempotentReplay(
            mapEntry(replay[0]),
            grantReportPointIdempotencyFingerprint(input),
            await this.getBalanceInTx(tx, input.userId)
          );
        }

        const grantConflict = await this.findReportGrantConflict(tx, input);
        if (grantConflict) {
          return this.denied(grantConflict, await this.getBalanceInTx(tx, input.userId));
        }

        const now = new Date();
        const updatedFingerprints = await tx
          .update(reportFingerprints)
          .set({
            automaticGrantCount: sql`${reportFingerprints.automaticGrantCount} + 1`,
            updatedAt: now
          })
          .where(
            and(
              eq(reportFingerprints.id, input.reportFingerprintId),
              lt(reportFingerprints.automaticGrantCount, 3)
            )
          )
          .returning({ automaticGrantCount: reportFingerprints.automaticGrantCount });

        if (!updatedFingerprints[0]) {
          return this.denied(
            "fingerprint_auto_grant_limit_reached",
            await this.getBalanceInTx(tx, input.userId)
          );
        }

        const inserted = await tx
          .insert(pointLedgerEntries)
          .values({
            userId: input.userId,
            vehicleId: input.vehicleId,
            reportUploadId: input.reportUploadId,
            reportFingerprintId: input.reportFingerprintId,
            delta: 1,
            reason: "report_grant",
            idempotencyKey: input.idempotencyKey,
            note: input.note,
            createdAt: now,
            updatedAt: now
          })
          .returning();
        const entry = mapEntry(requireReturnedRow(inserted, "point ledger grant insert"));
        const balanceAfter = await this.incrementUserBalanceInTx(tx, input.userId, 1, now);

        return this.applied(entry, balanceAfter);
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        return await this.classifyGrantUniqueConflict(input);
      }
      throw error;
    }
  }

  async spendPointForAccess(
    input: PointsLedgerRepositorySpendInput
  ): Promise<PointsLedgerMutationResult> {
    try {
      return await this.db.transaction(async (tx) => {
        const replay = await tx
          .select()
          .from(pointLedgerEntries)
          .where(eq(pointLedgerEntries.idempotencyKey, input.idempotencyKey))
          .limit(1);
        if (replay[0]) {
          return resolveIdempotentReplay(
            mapEntry(replay[0]),
            spendPointForAccessIdempotencyFingerprint(input),
            await this.getBalanceInTx(tx, input.userId)
          );
        }

        const now = new Date();
        const balances = await tx
          .update(users)
          .set({
            pointsBalance: sql`${users.pointsBalance} - 1`,
            updatedAt: now
          })
          .where(and(eq(users.id, input.userId), gt(users.pointsBalance, 0)))
          .returning({ pointsBalance: users.pointsBalance });

        if (!balances[0]) {
          return this.denied("insufficient_points", await this.getBalanceInTx(tx, input.userId));
        }

        const inserted = await tx
          .insert(pointLedgerEntries)
          .values({
            userId: input.userId,
            vehicleId: input.vehicleId,
            reportUploadId: null,
            reportFingerprintId: null,
            delta: -1,
            reason: "report_access_spend",
            idempotencyKey: input.idempotencyKey,
            note: input.note,
            createdAt: now,
            updatedAt: now
          })
          .returning();

        return this.applied(
          mapEntry(requireReturnedRow(inserted, "point ledger spend insert")),
          balances[0].pointsBalance
        );
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        return await this.classifyIdempotentReplay(
          input.idempotencyKey,
          spendPointForAccessIdempotencyFingerprint(input),
          input.userId
        );
      }
      throw error;
    }
  }

  async adjustPoints(input: PointsLedgerRepositoryAdjustInput): Promise<PointsLedgerMutationResult> {
    try {
      return await this.db.transaction(async (tx) => {
        const replay = await tx
          .select()
          .from(pointLedgerEntries)
          .where(eq(pointLedgerEntries.idempotencyKey, input.idempotencyKey))
          .limit(1);
        if (replay[0]) {
          return resolveIdempotentReplay(
            mapEntry(replay[0]),
            adjustPointsIdempotencyFingerprint(input),
            await this.getBalanceInTx(tx, input.userId)
          );
        }

        const now = new Date();
        const balances = await this.updateUserBalanceForAdjustmentInTx(tx, input, now);
        if (!balances[0]) {
          return this.denied(
            "adjustment_would_make_balance_negative",
            await this.getBalanceInTx(tx, input.userId)
          );
        }

        const inserted = await tx
          .insert(pointLedgerEntries)
          .values({
            userId: input.userId,
            vehicleId: null,
            reportUploadId: null,
            reportFingerprintId: null,
            delta: input.delta,
            reason: input.reason,
            idempotencyKey: input.idempotencyKey,
            note: input.note,
            createdAt: now,
            updatedAt: now
          })
          .returning();

        return this.applied(
          mapEntry(requireReturnedRow(inserted, "point ledger adjustment insert")),
          balances[0].pointsBalance
        );
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        return await this.classifyIdempotentReplay(
          input.idempotencyKey,
          adjustPointsIdempotencyFingerprint(input),
          input.userId
        );
      }
      throw error;
    }
  }

  async getBalance(userId: string): Promise<number | null> {
    const rows = await this.db
      .select({ pointsBalance: users.pointsBalance })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return rows[0]?.pointsBalance ?? null;
  }

  private async findReportGrantConflict(
    tx: DbTransaction,
    input: PointsLedgerRepositoryGrantInput
  ): Promise<PointsLedgerDeniedReason | null> {
    const vehicleGrant = await tx
      .select({ id: pointLedgerEntries.id })
      .from(pointLedgerEntries)
      .where(
        and(
          eq(pointLedgerEntries.userId, input.userId),
          eq(pointLedgerEntries.vehicleId, input.vehicleId),
          eq(pointLedgerEntries.reason, "report_grant"),
          gt(pointLedgerEntries.delta, 0)
        )
      )
      .limit(1);
    if (vehicleGrant[0]) {
      return "user_already_rewarded_for_vin";
    }

    const uploadGrant = await tx
      .select({ id: pointLedgerEntries.id })
      .from(pointLedgerEntries)
      .where(
        and(
          eq(pointLedgerEntries.userId, input.userId),
          eq(pointLedgerEntries.reportUploadId, input.reportUploadId),
          eq(pointLedgerEntries.reason, "report_grant"),
          gt(pointLedgerEntries.delta, 0)
        )
      )
      .limit(1);
    if (uploadGrant[0]) {
      return "user_already_rewarded_for_report_upload";
    }

    const fingerprintGrant = await tx
      .select({ id: pointLedgerEntries.id })
      .from(pointLedgerEntries)
      .where(
        and(
          eq(pointLedgerEntries.userId, input.userId),
          eq(pointLedgerEntries.reportFingerprintId, input.reportFingerprintId),
          eq(pointLedgerEntries.reason, "report_grant"),
          gt(pointLedgerEntries.delta, 0)
        )
      )
      .limit(1);
    if (fingerprintGrant[0]) {
      return "user_already_rewarded_for_fingerprint";
    }

    return null;
  }

  private async classifyGrantUniqueConflict(
    input: PointsLedgerRepositoryGrantInput
  ): Promise<PointsLedgerMutationResult> {
    const replay = await this.findEntryByIdempotencyKey(input.idempotencyKey);
    if (replay) {
      return resolveIdempotentReplay(
        replay,
        grantReportPointIdempotencyFingerprint(input),
        await this.getBalance(input.userId)
      );
    }

    const conflict = await this.db.transaction(async (tx) => {
      return await this.findReportGrantConflict(tx, input);
    });
    return this.denied(
      conflict ?? "fingerprint_auto_grant_limit_reached",
      await this.getBalance(input.userId)
    );
  }

  private async classifyIdempotentReplay(
    idempotencyKey: string,
    fingerprint: PointsLedgerIdempotencyFingerprint,
    userId: string
  ): Promise<PointsLedgerMutationResult> {
    const replay = await this.findEntryByIdempotencyKey(idempotencyKey);
    if (replay) {
      return resolveIdempotentReplay(replay, fingerprint, await this.getBalance(userId));
    }
    throw new Error("Unique conflict did not leave an idempotent ledger entry to replay.");
  }

  private async findEntryByIdempotencyKey(idempotencyKey: string): Promise<PointsLedgerEntry | null> {
    const rows = await this.db
      .select()
      .from(pointLedgerEntries)
      .where(eq(pointLedgerEntries.idempotencyKey, idempotencyKey))
      .limit(1);
    return rows[0] ? mapEntry(rows[0]) : null;
  }

  private async incrementUserBalanceInTx(
    tx: DbTransaction,
    userId: string,
    delta: number,
    now: Date
  ): Promise<number> {
    const balances = await tx
      .update(users)
      .set({
        pointsBalance: sql`${users.pointsBalance} + ${delta}`,
        updatedAt: now
      })
      .where(eq(users.id, userId))
      .returning({ pointsBalance: users.pointsBalance });

    if (!balances[0]) {
      throw new Error(`User ${userId} was not found while applying points ledger entry.`);
    }

    return balances[0].pointsBalance;
  }

  private async updateUserBalanceForAdjustmentInTx(
    tx: DbTransaction,
    input: PointsLedgerRepositoryAdjustInput,
    now: Date
  ): Promise<Array<{ pointsBalance: number }>> {
    return await tx
      .update(users)
      .set({
        pointsBalance: sql`${users.pointsBalance} + ${input.delta}`,
        updatedAt: now
      })
      .where(
        input.delta < 0
          ? and(eq(users.id, input.userId), gte(users.pointsBalance, Math.abs(input.delta)))
          : eq(users.id, input.userId)
      )
      .returning({ pointsBalance: users.pointsBalance });
  }

  private async getBalanceInTx(tx: DbTransaction, userId: string): Promise<number | null> {
    const rows = await tx
      .select({ pointsBalance: users.pointsBalance })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return rows[0]?.pointsBalance ?? null;
  }

  private applied(entry: PointsLedgerEntry, balanceAfter: number): PointsLedgerMutationResult {
    return {
      status: "applied",
      entry,
      ledgerEntryId: entry.id,
      balanceAfter,
      reason: entry.reason
    };
  }

  private denied(
    reason: PointsLedgerResultReason,
    balanceAfter: number | null
  ): PointsLedgerMutationResult {
    return {
      status: "denied",
      entry: null,
      ledgerEntryId: null,
      balanceAfter,
      reason
    };
  }
}

function mapEntry(entry: typeof pointLedgerEntries.$inferSelect): PointsLedgerEntry {
  return {
    id: entry.id,
    userId: entry.userId,
    vehicleId: entry.vehicleId,
    reportUploadId: entry.reportUploadId,
    reportFingerprintId: entry.reportFingerprintId,
    delta: entry.delta,
    reason: entry.reason,
    idempotencyKey: entry.idempotencyKey,
    note: entry.note,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt
  };
}

function requireReturnedRow<T>(rows: T[], operation: string): T {
  const row = rows[0];
  if (!row) {
    throw new Error(`Expected ${operation} to return a row.`);
  }
  return row;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}
