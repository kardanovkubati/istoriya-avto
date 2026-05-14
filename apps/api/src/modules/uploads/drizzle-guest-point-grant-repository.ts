import { db } from "../../db/client";
import { guestPointGrants } from "../../db/schema";
import type { GuestPointGrantRepository } from "./report-upload-service";

export class DrizzleGuestPointGrantRepository implements GuestPointGrantRepository {
  async createGrant(input: Parameters<GuestPointGrantRepository["createGrant"]>[0]): Promise<void> {
    await db
      .insert(guestPointGrants)
      .values({
        guestSessionId: input.guestSessionId,
        vehicleId: input.vehicleId,
        reportUploadId: input.reportUploadId,
        reportFingerprintId: input.reportFingerprintId,
        points: input.points,
        reason: input.reason
      })
      .onConflictDoNothing({
        target: [guestPointGrants.guestSessionId, guestPointGrants.reportUploadId]
      });
  }
}
