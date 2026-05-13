import type { VehiclePreviewReadModel } from "../vehicles/report-read-model";
import type { ListingSnapshotPublicData } from "./search-contract";

export type StoredListingSnapshot = {
  id: string;
  sourceKind: "avito";
  listingId: string;
  canonicalUrl: string;
  vehicleId: string | null;
  status: "captured" | "unavailable" | "manual_review";
  originalObjectKey: string | null;
  fetchedAt: string;
  originalExpiresAt: string | null;
  normalizedData: ListingSnapshotPublicData | null;
};

export type SaveListingSnapshotInput = {
  sourceKind: "avito";
  listingId: string;
  canonicalUrl: string;
  vehicleId: string | null;
  status: "captured" | "unavailable" | "manual_review";
  originalObjectKey: string | null;
  fetchedAt: Date;
  originalExpiresAt: Date | null;
  normalizedData: ListingSnapshotPublicData | null;
};

export interface SearchRepository {
  findPreviewByVin(vin: string): Promise<VehiclePreviewReadModel | null>;
  findPreviewsByIdentifier(input: {
    kind: "plate";
    value: string;
    limit: number;
  }): Promise<VehiclePreviewReadModel[]>;
  findListingSnapshot(input: {
    sourceKind: "avito";
    listingId: string;
  }): Promise<StoredListingSnapshot | null>;
  saveListingSnapshot(input: SaveListingSnapshotInput): Promise<StoredListingSnapshot>;
}
