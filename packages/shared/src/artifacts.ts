import type {
  ArtifactMetadata,
  ArtifactType,
  ManualPullRequestArtifactMetadata,
  PreviewArtifactMetadata,
  PullRequestArtifactMetadata,
  ScreenshotArtifactMetadata,
  VideoArtifactMetadata,
} from "./types";

const PR_STATES = new Set(["open", "closed", "merged", "draft"]);
const PREVIEW_STATUSES = new Set(["active", "outdated", "stopped"]);
const SCREENSHOT_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export function normalizeArtifactMetadata(
  artifactType: ArtifactType,
  metadata: unknown
): ArtifactMetadata | null {
  if (!isRecord(metadata)) return null;

  switch (artifactType) {
    case "pr":
      return nonEmpty(normalizePullRequestMetadata(metadata));
    case "branch":
      return nonEmpty(normalizeManualPullRequestMetadata(metadata));
    case "preview":
      return nonEmpty(normalizePreviewMetadata(metadata));
    case "screenshot":
      return nonEmpty(normalizeScreenshotMetadata(metadata));
    case "video":
      return nonEmpty(normalizeVideoMetadata(metadata));
  }
}

function normalizePullRequestMetadata(
  metadata: Record<string, unknown>
): PullRequestArtifactMetadata {
  return {
    ...(isPositiveNumber(metadata.number) ? { number: metadata.number } : {}),
    ...(typeof metadata.state === "string" && PR_STATES.has(metadata.state)
      ? { state: metadata.state as PullRequestArtifactMetadata["state"] }
      : {}),
    ...stringField(metadata, "head"),
    ...stringField(metadata, "base"),
  };
}

function normalizeManualPullRequestMetadata(
  metadata: Record<string, unknown>
): ManualPullRequestArtifactMetadata {
  return {
    ...(metadata.mode === "manual_pr" ? { mode: "manual_pr" as const } : {}),
    ...stringField(metadata, "head"),
    ...stringField(metadata, "base"),
    ...stringField(metadata, "createPrUrl"),
    ...stringField(metadata, "provider"),
  };
}

function normalizePreviewMetadata(metadata: Record<string, unknown>): PreviewArtifactMetadata {
  return {
    ...(typeof metadata.previewStatus === "string" && PREVIEW_STATUSES.has(metadata.previewStatus)
      ? { previewStatus: metadata.previewStatus as PreviewArtifactMetadata["previewStatus"] }
      : {}),
  };
}

function normalizeScreenshotMetadata(
  metadata: Record<string, unknown>
): Partial<ScreenshotArtifactMetadata> {
  return {
    ...stringField(metadata, "objectKey"),
    ...(typeof metadata.mimeType === "string" && SCREENSHOT_MIME_TYPES.has(metadata.mimeType)
      ? { mimeType: metadata.mimeType as ScreenshotArtifactMetadata["mimeType"] }
      : {}),
    ...(isNonNegativeNumber(metadata.sizeBytes) ? { sizeBytes: metadata.sizeBytes } : {}),
    ...dimensionsField(metadata, "viewport"),
    ...stringField(metadata, "sourceUrl"),
    ...booleanField(metadata, "fullPage"),
    ...booleanField(metadata, "annotated"),
    ...stringField(metadata, "caption"),
  };
}

function normalizeVideoMetadata(metadata: Record<string, unknown>): Partial<VideoArtifactMetadata> {
  return {
    ...stringField(metadata, "objectKey"),
    ...(metadata.mimeType === "video/mp4" ? { mimeType: "video/mp4" as const } : {}),
    ...(isNonNegativeNumber(metadata.sizeBytes) ? { sizeBytes: metadata.sizeBytes } : {}),
    ...stringField(metadata, "caption"),
    ...(isPositiveNumber(metadata.durationMs) ? { durationMs: metadata.durationMs } : {}),
    ...(isNonNegativeNumber(metadata.createdAt) ? { createdAt: metadata.createdAt } : {}),
    ...(isPositiveNumber(metadata.recordingStartedAt)
      ? { recordingStartedAt: metadata.recordingStartedAt }
      : {}),
    ...(isPositiveNumber(metadata.recordingEndedAt)
      ? { recordingEndedAt: metadata.recordingEndedAt }
      : {}),
    ...dimensionsField(metadata, "dimensions"),
    ...booleanField(metadata, "truncated"),
    ...(metadata.hasAudio === false ? { hasAudio: false as const } : {}),
    ...(metadata.captureSurface === "browser" ? { captureSurface: "browser" as const } : {}),
    ...(metadata.source === "agent" ? { source: "agent" as const } : {}),
    ...stringField(metadata, "sourceUrl"),
    ...stringField(metadata, "endUrl"),
  };
}

function stringField<T extends string>(
  metadata: Record<string, unknown>,
  name: T
): { [K in T]?: string } {
  const value = metadata[name];
  return (typeof value === "string" && value.length > 0 ? { [name]: value } : {}) as {
    [K in T]?: string;
  };
}

function booleanField<T extends string>(
  metadata: Record<string, unknown>,
  name: T
): { [K in T]?: boolean } {
  const value = metadata[name];
  return (typeof value === "boolean" ? { [name]: value } : {}) as { [K in T]?: boolean };
}

function dimensionsField<T extends string>(
  metadata: Record<string, unknown>,
  name: T
): { [K in T]?: { width: number; height: number } } {
  const value = metadata[name];
  if (!isRecord(value) || !isPositiveNumber(value.width) || !isPositiveNumber(value.height)) {
    return {};
  }

  return { [name]: { width: value.width, height: value.height } } as {
    [K in T]?: { width: number; height: number };
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function nonEmpty<T extends object>(value: T): T | null {
  return Object.keys(value).length > 0 ? value : null;
}
