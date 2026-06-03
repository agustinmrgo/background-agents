/**
 * Managed Vercel base-runtime snapshot builder.
 *
 * This creates a temporary Vercel Sandbox, applies the shared runtime
 * bootstrap, snapshots the resulting filesystem, and stops the temporary
 * session. The returned immutable snapshot ID can be passed to Terraform as
 * VERCEL_BASE_SNAPSHOT_ID for the control plane deployment.
 */

import { createLogger } from "../logger";
import type { CorrelationContext } from "../logger";
import {
  DEFAULT_VERCEL_RUNTIME,
  DEFAULT_VERCEL_RUNTIME_REPO_REF,
  DEFAULT_VERCEL_RUNTIME_REPO_URL,
  buildVercelBootstrapScript,
} from "./vercel-bootstrap";
import type { VercelSandboxClient } from "./vercel-client";

const log = createLogger("vercel-base-snapshot");

const DEFAULT_BASE_SNAPSHOT_NAME_PREFIX = "openinspect-base";
const DEFAULT_BASE_SNAPSHOT_TIMEOUT_MS = 30 * 60 * 1000;
const BOOTSTRAP_TIMEOUT_MS = 20 * 60 * 1000;

export interface BuildVercelBaseSnapshotConfig {
  runtime?: string;
  runtimeRepoUrl?: string;
  runtimeRepoRef?: string;
  sourceVersion?: string;
  namePrefix?: string;
  now?: number;
  correlation?: CorrelationContext;
}

export interface BuildVercelBaseSnapshotResult {
  snapshotId: string;
  sandboxName: string;
  sessionId: string;
}

export async function buildVercelBaseSnapshot(
  client: VercelSandboxClient,
  config: BuildVercelBaseSnapshotConfig = {}
): Promise<BuildVercelBaseSnapshotResult> {
  const runtimeRepoUrl = config.runtimeRepoUrl || DEFAULT_VERCEL_RUNTIME_REPO_URL;
  const runtimeRepoRef = config.runtimeRepoRef || DEFAULT_VERCEL_RUNTIME_REPO_REF;
  const sandboxName = buildBaseSnapshotSandboxName({
    prefix: config.namePrefix || DEFAULT_BASE_SNAPSHOT_NAME_PREFIX,
    sourceVersion: config.sourceVersion,
    now: config.now ?? Date.now(),
  });

  const created = await client.createSandbox(
    {
      name: sandboxName,
      runtime: config.runtime || DEFAULT_VERCEL_RUNTIME,
      timeoutMs: DEFAULT_BASE_SNAPSHOT_TIMEOUT_MS,
      ports: [],
      tags: {
        openinspect_framework: "open-inspect",
        openinspect_kind: "base-runtime-build",
        openinspect_runtime_ref: runtimeRepoRef,
        ...(config.sourceVersion ? { openinspect_source_version: config.sourceVersion } : {}),
      },
    },
    config.correlation
  );

  const sessionId = created.session.id;
  try {
    const result = await client.runCommandAndWait(
      {
        sessionId,
        command: "bash",
        args: ["-lc", buildVercelBootstrapScript({ runtimeRepoUrl, runtimeRepoRef })],
        timeoutMs: BOOTSTRAP_TIMEOUT_MS,
      },
      config.correlation
    );

    if (result.exitCode !== 0) {
      throw new Error(`Vercel base runtime bootstrap failed with exit code ${result.exitCode}`);
    }

    const snapshot = await client.snapshotSession(
      sessionId,
      { expirationMs: 0 },
      config.correlation
    );

    if (snapshot.snapshot.status !== "created") {
      throw new Error(`Vercel base snapshot status was ${snapshot.snapshot.status}`);
    }

    log.info("vercel_base_snapshot.created", {
      snapshot_id: snapshot.snapshot.id,
      sandbox_name: sandboxName,
      session_id: sessionId,
      runtime_repo_ref: runtimeRepoRef,
    });

    return {
      snapshotId: snapshot.snapshot.id,
      sandboxName,
      sessionId,
    };
  } finally {
    try {
      await client.stopSession(sessionId, config.correlation);
    } catch (error) {
      log.warn("vercel_base_snapshot.stop_failed", {
        session_id: sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export function buildBaseSnapshotSandboxName(params: {
  prefix: string;
  sourceVersion?: string;
  now: number;
}): string {
  const source = params.sourceVersion ? params.sourceVersion.slice(0, 12) : "manual";
  const raw = `${params.prefix}-${source}-${params.now}`;
  const normalized = raw
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return normalized.slice(0, 96) || `${DEFAULT_BASE_SNAPSHOT_NAME_PREFIX}-${params.now}`;
}
