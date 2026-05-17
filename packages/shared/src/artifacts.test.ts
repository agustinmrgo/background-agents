import { describe, expect, it } from "vitest";
import { normalizeArtifactMetadata } from "./artifacts";

describe("artifact metadata normalization", () => {
  it("normalizes pull request metadata field by field", () => {
    expect(
      normalizeArtifactMetadata("pr", {
        number: 42,
        state: "open",
        head: "feature/video",
        base: "main",
        ignored: "value",
      })
    ).toEqual({
      number: 42,
      state: "open",
      head: "feature/video",
      base: "main",
    });
  });

  it("normalizes manual pull request branch metadata", () => {
    expect(
      normalizeArtifactMetadata("branch", {
        mode: "manual_pr",
        head: "feature/video",
        base: "main",
        createPrUrl: "https://github.com/acme/app/compare/main...feature/video",
        provider: "github",
      })
    ).toEqual({
      mode: "manual_pr",
      head: "feature/video",
      base: "main",
      createPrUrl: "https://github.com/acme/app/compare/main...feature/video",
      provider: "github",
    });
  });

  it("normalizes preview status metadata", () => {
    expect(normalizeArtifactMetadata("preview", { previewStatus: "outdated" })).toEqual({
      previewStatus: "outdated",
    });
  });

  it("normalizes screenshot metadata and drops invalid fields", () => {
    expect(
      normalizeArtifactMetadata("screenshot", {
        objectKey: "sessions/s1/media/a1.png",
        mimeType: "image/png",
        sizeBytes: -1,
        viewport: { width: 1440, height: 900 },
        sourceUrl: "http://127.0.0.1:3000",
        fullPage: true,
        annotated: false,
        caption: "Dashboard",
      })
    ).toEqual({
      objectKey: "sessions/s1/media/a1.png",
      mimeType: "image/png",
      viewport: { width: 1440, height: 900 },
      sourceUrl: "http://127.0.0.1:3000",
      fullPage: true,
      annotated: false,
      caption: "Dashboard",
    });
  });

  it("normalizes video metadata and only preserves hasAudio when false", () => {
    expect(
      normalizeArtifactMetadata("video", {
        objectKey: "sessions/s1/media/a1.mp4",
        mimeType: "video/mp4",
        sizeBytes: 4096,
        caption: "Menu opens",
        durationMs: 1450,
        createdAt: 4000,
        recordingStartedAt: 1000,
        recordingEndedAt: 2450,
        dimensions: { width: 1280, height: 720 },
        truncated: false,
        hasAudio: true,
        captureSurface: "browser",
        source: "agent",
        sourceUrl: "http://127.0.0.1:3000/start",
        endUrl: "http://127.0.0.1:3000/end",
      })
    ).toEqual({
      objectKey: "sessions/s1/media/a1.mp4",
      mimeType: "video/mp4",
      sizeBytes: 4096,
      caption: "Menu opens",
      durationMs: 1450,
      createdAt: 4000,
      recordingStartedAt: 1000,
      recordingEndedAt: 2450,
      dimensions: { width: 1280, height: 720 },
      truncated: false,
      captureSurface: "browser",
      source: "agent",
      sourceUrl: "http://127.0.0.1:3000/start",
      endUrl: "http://127.0.0.1:3000/end",
    });
  });

  it("preserves video hasAudio false", () => {
    expect(normalizeArtifactMetadata("video", { hasAudio: false })).toEqual({ hasAudio: false });
  });

  it("returns null for missing, non-object, or empty metadata", () => {
    expect(normalizeArtifactMetadata("screenshot", null)).toBeNull();
    expect(normalizeArtifactMetadata("screenshot", "not-json")).toBeNull();
    expect(normalizeArtifactMetadata("screenshot", { sizeBytes: -1 })).toBeNull();
  });
});
