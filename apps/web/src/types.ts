import type {
  ContextResponse,
  CreateShareLinkResponse,
  SearchResultResponse,
  UnlockIntentResponse,
  VehicleFullReportResponse
} from "./lib/api";

export type SearchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; data: SearchResultResponse }
  | { status: "error"; message: string };

export type ContextState =
  | { status: "loading" }
  | { status: "success"; data: ContextResponse }
  | { status: "error"; message: string };

export type CandidateUnlockState =
  | { status: "intent_loading" }
  | { status: "intent"; unlock: UnlockIntentResponse["unlock"] }
  | { status: "commit_loading"; unlock: Extract<UnlockIntentResponse["unlock"], { status: "ready" }> }
  | { status: "unlocked"; warning: string | undefined }
  | { status: "error"; message: string };

export type UnlockStates = Record<string, CandidateUnlockState>;

export type Candidate = SearchResultResponse["candidates"][number];

export type ReportViewState =
  | { status: "closed" }
  | { status: "loading"; vehicleId: string }
  | { status: "ready"; vehicleId: string; data: VehicleFullReportResponse; mode: "owner" | "share" }
  | { status: "error"; vehicleId: string | null; message: string };

export type ShareState =
  | { status: "idle" }
  | { status: "creating" }
  | { status: "ready"; share: CreateShareLinkResponse["share"] }
  | { status: "error"; message: string };
