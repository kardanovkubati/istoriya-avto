import { and, eq } from "drizzle-orm";
import { db } from "../../db/client";
import {
  listingSnapshots,
  vehicleIdentifiers,
  vehicleReportSnapshots,
  vehicles
} from "../../db/schema";
import type { VehiclePreviewReadModel } from "../vehicles/report-read-model";
import type { ListingSnapshotPublicData } from "./search-contract";
import type {
  SaveListingSnapshotInput,
  SearchRepository,
  StoredListingSnapshot
} from "./search-repository";

export class DrizzleSearchRepository implements SearchRepository {
  async findPreviewByVin(vin: string): Promise<VehiclePreviewReadModel | null> {
    const [snapshot] = await db
      .select({
        previewData: vehicleReportSnapshots.previewData
      })
      .from(vehicleReportSnapshots)
      .innerJoin(vehicles, eq(vehicleReportSnapshots.vehicleId, vehicles.id))
      .where(eq(vehicles.vin, vin))
      .limit(1);

    return (snapshot?.previewData as VehiclePreviewReadModel | undefined) ?? null;
  }

  async findPreviewsByIdentifier(input: {
    kind: "plate";
    value: string;
    limit: number;
  }): Promise<VehiclePreviewReadModel[]> {
    const snapshots = await db
      .select({
        previewData: vehicleReportSnapshots.previewData
      })
      .from(vehicleIdentifiers)
      .innerJoin(
        vehicleReportSnapshots,
        eq(vehicleIdentifiers.vehicleId, vehicleReportSnapshots.vehicleId)
      )
      .where(
        and(eq(vehicleIdentifiers.kind, input.kind), eq(vehicleIdentifiers.value, input.value))
      )
      .limit(input.limit);

    return snapshots.map((snapshot) => snapshot.previewData as VehiclePreviewReadModel);
  }

  async findListingSnapshot(input: {
    sourceKind: "avito";
    listingId: string;
  }): Promise<StoredListingSnapshot | null> {
    const [snapshot] = await db
      .select()
      .from(listingSnapshots)
      .where(
        and(
          eq(listingSnapshots.sourceKind, input.sourceKind),
          eq(listingSnapshots.listingId, input.listingId)
        )
      )
      .limit(1);

    return snapshot === undefined ? null : mapListingSnapshot(snapshot);
  }

  async saveListingSnapshot(input: SaveListingSnapshotInput): Promise<StoredListingSnapshot> {
    const [snapshot] = await db
      .insert(listingSnapshots)
      .values({
        sourceKind: input.sourceKind,
        listingId: input.listingId,
        canonicalUrl: input.canonicalUrl,
        vehicleId: input.vehicleId,
        status: input.status,
        originalObjectKey: input.originalObjectKey,
        fetchedAt: input.fetchedAt,
        originalExpiresAt: input.originalExpiresAt,
        normalizedData: (input.normalizedData ?? {}) as Record<string, unknown>,
        updatedAt: input.fetchedAt
      })
      .onConflictDoUpdate({
        target: [listingSnapshots.sourceKind, listingSnapshots.listingId],
        set: {
          canonicalUrl: input.canonicalUrl,
          vehicleId: input.vehicleId,
          status: input.status,
          originalObjectKey: input.originalObjectKey,
          fetchedAt: input.fetchedAt,
          originalExpiresAt: input.originalExpiresAt,
          normalizedData: (input.normalizedData ?? {}) as Record<string, unknown>,
          updatedAt: input.fetchedAt
        }
      })
      .returning();

    if (snapshot === undefined) {
      throw new Error("listing_snapshot_save_failed");
    }

    return mapListingSnapshot(snapshot);
  }
}

function mapListingSnapshot(row: typeof listingSnapshots.$inferSelect): StoredListingSnapshot {
  return {
    id: row.id,
    sourceKind: row.sourceKind as StoredListingSnapshot["sourceKind"],
    listingId: row.listingId,
    canonicalUrl: row.canonicalUrl,
    vehicleId: row.vehicleId,
    status: row.status,
    originalObjectKey: row.originalObjectKey,
    fetchedAt: row.fetchedAt.toISOString(),
    originalExpiresAt: row.originalExpiresAt?.toISOString() ?? null,
    normalizedData:
      row.status === "captured"
        ? (row.normalizedData as ListingSnapshotPublicData)
        : null
  };
}
