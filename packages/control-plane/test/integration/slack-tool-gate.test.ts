import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:test";
import { IntegrationSettingsStore } from "../../src/db/integration-settings";
import { cleanD1Tables } from "./cleanup";
import { initNamedSession } from "./helpers";

describe("spawn-time slack-notify tool gate", () => {
  beforeEach(cleanD1Tables);
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not install slack-notify when the repo is outside the Slack enabledRepos allowlist", async () => {
    // Settings and fetch stub must be in place before initNamedSession, since
    // handleInit fires `ctx.waitUntil(warmSandbox())` and that's the spawn whose
    // body we're capturing. Otherwise the warm spawn runs against an empty
    // settings table and we'd be testing the master-switch-off default instead
    // of the allowlist branch.
    const store = new IntegrationSettingsStore(env.DB);
    await store.setGlobal("slack", {
      enabledRepos: ["other/repo"],
      defaults: {
        agentNotificationsEnabled: true,
        mentionsPolicy: "allow",
      },
    });

    let createSandboxBody: Record<string, unknown> | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        createSandboxBody = init?.body ? JSON.parse(init.body as string) : undefined;
        return new Response(
          JSON.stringify({
            success: true,
            data: {
              sandbox_id: "sandbox-acme-web-app-test",
              modal_object_id: "modal-1",
              status: "warming",
              created_at: Date.now(),
            },
          }),
          { status: 200 }
        );
      })
    );

    await initNamedSession(`gate-${Date.now()}`, {
      repoOwner: "acme",
      repoName: "web-app",
    });

    // Wait for the fire-and-forget warm spawn (ctx.waitUntil) to call our
    // stubbed fetch. The DO triggers it during handleInit but doesn't await it.
    await vi.waitFor(() => expect(createSandboxBody).toBeDefined());

    expect(createSandboxBody?.agent_slack_notify_enabled).toBe(false);
  });
});
