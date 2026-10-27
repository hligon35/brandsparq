export const PILOT_EVIDENCE = [
  { id: "ci", label: "Green CI" },
  { id: "staging", label: "Staging isolation" },
  { id: "routing", label: "Access routing" },
  { id: "providers", label: "Provider acceptance" },
  { id: "restore", label: "Backup restoration" },
  { id: "android", label: "Android device acceptance" },
  { id: "ios", label: "iOS device acceptance" },
  { id: "advisories", label: "Dependency risk review" },
] as const;
export type PilotMode = "normal" | "hold" | "supervised";
export type PilotEvidence = Record<(typeof PILOT_EVIDENCE)[number]["id"], string>;
export type PilotDestination = { clientId: string; socialAccountId: string };
export type PilotConfiguration = {
  mode: "hold" | "supervised";
  expectedRevision: number;
  endsAt?: string;
  releaseCommit?: string;
  evidence?: Partial<PilotEvidence>;
  destinations?: PilotDestination[];
};
export type PilotOverview = {
  mode: PilotMode;
  revision: number;
  endsAt: string | null;
  expired: boolean;
  releaseCommit: string | null;
  deployedCommit?: string | null;
  evidence: Partial<PilotEvidence>;
  destinations: PilotDestination[];
  availableDestinations: Array<
    PilotDestination & { clientName: string; platform: string; accountName: string }
  >;
  inFlight: number;
};
