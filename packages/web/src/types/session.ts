import type {
  ManualPullRequestArtifactMetadata,
  PreviewArtifactMetadata,
  PullRequestArtifactMetadata,
  PullRequestArtifactState,
  SandboxEvent as SharedSandboxEvent,
  ScreenshotArtifactMetadata,
  VideoArtifactMetadata,
} from "@open-inspect/shared";

// Session-related type definitions

type MediaMimeType = ScreenshotArtifactMetadata["mimeType"] | VideoArtifactMetadata["mimeType"];

export type UiArtifactMetadata = {
  number?: PullRequestArtifactMetadata["number"];
  state?: PullRequestArtifactState;
  head?: PullRequestArtifactMetadata["head"] | ManualPullRequestArtifactMetadata["head"];
  base?: PullRequestArtifactMetadata["base"] | ManualPullRequestArtifactMetadata["base"];
  mode?: ManualPullRequestArtifactMetadata["mode"];
  createPrUrl?: ManualPullRequestArtifactMetadata["createPrUrl"];
  provider?: ManualPullRequestArtifactMetadata["provider"];
  previewStatus?: PreviewArtifactMetadata["previewStatus"];
  objectKey?: string;
  mimeType?: MediaMimeType;
  sizeBytes?: number;
  viewport?: ScreenshotArtifactMetadata["viewport"];
  sourceUrl?: string;
  endUrl?: string;
  fullPage?: boolean;
  annotated?: boolean;
  caption?: string;
  durationMs?: number;
  createdAt?: number;
  recordingStartedAt?: number;
  recordingEndedAt?: number;
  dimensions?: VideoArtifactMetadata["dimensions"];
  truncated?: boolean;
  hasAudio?: false;
  captureSurface?: "browser";
  source?: "agent";
  prNumber?: number;
  prState?: PullRequestArtifactState;
  filename?: string;
};

export interface Artifact {
  id: string;
  type: "pr" | "screenshot" | "video" | "preview" | "branch";
  url: string | null;
  metadata?: UiArtifactMetadata;
  createdAt: number;
}

export type SandboxEvent = SharedSandboxEvent;

export interface Task {
  content: string;
  status: "pending" | "in_progress" | "completed";
  activeForm?: string;
}

export interface FileChange {
  filename: string;
  additions: number;
  deletions: number;
}
