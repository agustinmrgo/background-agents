/**
 * Worker-compatible Vercel Sandbox REST client.
 *
 * The published @vercel/sandbox SDK currently imports Node-only modules, so
 * the Cloudflare Worker control plane talks to Vercel's documented Sandbox API
 * with fetch directly.
 */

import { createLogger } from "../logger";
import type { CorrelationContext } from "../logger";

const log = createLogger("vercel-sandbox-client");

const DEFAULT_VERCEL_API_BASE_URL = "https://vercel.com/api";
const USER_AGENT = "open-inspect/vercel-sandbox";

export interface VercelSandboxClientConfig {
  token: string;
  projectId: string;
  teamId?: string;
  apiBaseUrl?: string;
}

export interface VercelSandboxRoute {
  url?: string;
  subdomain: string;
  port: number;
}

export interface VercelSandboxSession {
  id: string;
  status: "pending" | "running" | "stopping" | "stopped" | "failed" | "aborted" | "snapshotting";
  createdAt: number;
  cwd: string;
  timeout: number;
}

export interface VercelSandboxMetadata {
  name: string;
  currentSessionId: string;
  currentSnapshotId?: string;
  createdAt: number;
  status: VercelSandboxSession["status"];
}

export interface VercelCreateSandboxRequest {
  name: string;
  runtime?: string;
  timeoutMs?: number;
  ports?: number[];
  env?: Record<string, string>;
  tags?: Record<string, string>;
  sourceSnapshotId?: string;
}

export interface VercelCreateSandboxResponse {
  sandbox: VercelSandboxMetadata;
  session: VercelSandboxSession;
  routes: VercelSandboxRoute[];
}

export interface VercelRunCommandRequest {
  sessionId: string;
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  sudo?: boolean;
  timeoutMs?: number;
}

export interface VercelCommandResult {
  commandId: string;
  exitCode: number | null;
}

export interface VercelSnapshotResponse {
  snapshot: {
    id: string;
    status: "created" | "deleted" | "failed";
    createdAt: number;
  };
  session: VercelSandboxSession;
}

export class VercelSandboxApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly responseText?: string
  ) {
    super(message);
    this.name = "VercelSandboxApiError";
  }
}

export class VercelSandboxClient {
  private readonly apiBaseUrl: string;

  constructor(private readonly config: VercelSandboxClientConfig) {
    if (!config.token) throw new Error("VercelSandboxClient requires VERCEL_TOKEN");
    if (!config.projectId) throw new Error("VercelSandboxClient requires VERCEL_PROJECT_ID");
    this.apiBaseUrl = (config.apiBaseUrl || DEFAULT_VERCEL_API_BASE_URL).replace(/\/$/, "");
  }

  async createSandbox(
    request: VercelCreateSandboxRequest,
    correlation?: CorrelationContext
  ): Promise<VercelCreateSandboxResponse> {
    const response = await this.request<VercelCreateSandboxResponse>(
      "/v2/sandboxes",
      {
        method: "POST",
        body: JSON.stringify({
          projectId: this.config.projectId,
          name: request.name,
          runtime: request.runtime,
          timeout: request.timeoutMs,
          ports: request.ports ?? [],
          env: request.env,
          tags: request.tags,
          source: request.sourceSnapshotId
            ? { type: "snapshot", snapshotId: request.sourceSnapshotId }
            : undefined,
        }),
      },
      correlation,
      "createSandbox"
    );

    return response;
  }

  async startCommand(
    request: VercelRunCommandRequest,
    correlation?: CorrelationContext
  ): Promise<VercelCommandResult> {
    const response = await this.request<{ command: { id: string; exitCode: number | null } }>(
      `/v2/sandboxes/sessions/${encodeURIComponent(request.sessionId)}/cmd`,
      {
        method: "POST",
        body: JSON.stringify({
          command: request.command,
          args: request.args ?? [],
          cwd: request.cwd,
          env: request.env ?? {},
          sudo: request.sudo ?? false,
          timeout: request.timeoutMs,
        }),
      },
      correlation,
      "startCommand"
    );

    return { commandId: response.command.id, exitCode: response.command.exitCode };
  }

  async runCommandAndWait(
    request: VercelRunCommandRequest,
    correlation?: CorrelationContext
  ): Promise<VercelCommandResult> {
    const text = await this.requestText(
      `/v2/sandboxes/sessions/${encodeURIComponent(request.sessionId)}/cmd`,
      {
        method: "POST",
        body: JSON.stringify({
          command: request.command,
          args: request.args ?? [],
          cwd: request.cwd,
          env: request.env ?? {},
          sudo: request.sudo ?? false,
          wait: true,
          timeout: request.timeoutMs,
        }),
      },
      correlation,
      "runCommandAndWait"
    );

    return parseCommandNdjson(text);
  }

  async snapshotSession(
    sessionId: string,
    opts: { expirationMs?: number } = {},
    correlation?: CorrelationContext
  ): Promise<VercelSnapshotResponse> {
    const body =
      opts.expirationMs === undefined
        ? undefined
        : JSON.stringify({ expiration: opts.expirationMs });
    return this.request<VercelSnapshotResponse>(
      `/v2/sandboxes/sessions/${encodeURIComponent(sessionId)}/snapshot`,
      { method: "POST", body },
      correlation,
      "snapshotSession"
    );
  }

  async stopSession(sessionId: string, correlation?: CorrelationContext): Promise<void> {
    await this.request<unknown>(
      `/v2/sandboxes/sessions/${encodeURIComponent(sessionId)}/stop`,
      { method: "POST" },
      correlation,
      "stopSession"
    );
  }

  async deleteSnapshot(snapshotId: string, correlation?: CorrelationContext): Promise<void> {
    await this.request<unknown>(
      `/v2/sandboxes/snapshots/${encodeURIComponent(snapshotId)}`,
      { method: "DELETE" },
      correlation,
      "deleteSnapshot"
    );
  }

  private async request<T>(
    path: string,
    init: RequestInit,
    correlation: CorrelationContext | undefined,
    endpoint: string
  ): Promise<T> {
    const text = await this.requestText(path, init, correlation, endpoint);
    try {
      return JSON.parse(text || "{}") as T;
    } catch (error) {
      throw new VercelSandboxApiError(
        `Vercel Sandbox API returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
        200,
        text
      );
    }
  }

  private async requestText(
    path: string,
    init: RequestInit,
    correlation: CorrelationContext | undefined,
    endpoint: string
  ): Promise<string> {
    const startTime = Date.now();
    let httpStatus: number | undefined;
    let outcome: "success" | "error" = "error";

    try {
      const url = new URL(`${this.apiBaseUrl}${path}`);
      if (this.config.teamId) {
        url.searchParams.set("teamId", this.config.teamId);
      }

      const headers = new Headers(init.headers);
      headers.set("Authorization", `Bearer ${this.config.token}`);
      headers.set("Content-Type", headers.get("Content-Type") || "application/json");
      headers.set("User-Agent", USER_AGENT);
      if (correlation?.trace_id) headers.set("x-trace-id", correlation.trace_id);
      if (correlation?.request_id) headers.set("x-request-id", correlation.request_id);
      if (correlation?.session_id) headers.set("x-session-id", correlation.session_id);
      if (correlation?.sandbox_id) headers.set("x-sandbox-id", correlation.sandbox_id);

      const response = await fetch(url.toString(), { ...init, headers });
      httpStatus = response.status;
      const text = await response.text();
      if (!response.ok) {
        throw new VercelSandboxApiError(
          `Vercel Sandbox API error: ${response.status} ${text}`,
          response.status,
          text
        );
      }

      outcome = "success";
      return text;
    } finally {
      log.info("vercel_sandbox.request", {
        event: "vercel_sandbox.request",
        endpoint,
        trace_id: correlation?.trace_id,
        request_id: correlation?.request_id,
        http_status: httpStatus,
        duration_ms: Date.now() - startTime,
        outcome,
      });
    }
  }
}

function parseCommandNdjson(text: string): VercelCommandResult {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  let commandId = "";
  let exitCode: number | null = null;

  for (const line of lines) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== "object" || !("command" in parsed)) continue;
    const command = (parsed as { command?: { id?: unknown; exitCode?: unknown } }).command;
    if (!command) continue;
    if (typeof command.id === "string") commandId = command.id;
    if (typeof command.exitCode === "number") exitCode = command.exitCode;
  }

  if (!commandId) {
    throw new VercelSandboxApiError(
      "Vercel command stream did not include a command id",
      200,
      text
    );
  }

  return { commandId, exitCode };
}

export function createVercelSandboxClient(config: VercelSandboxClientConfig): VercelSandboxClient {
  return new VercelSandboxClient(config);
}
