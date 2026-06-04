// Sandbox provider capabilities and backend selection.
//
// This module is the single, provider-agnostic source of truth for:
//   - which sandbox backends exist and how the SANDBOX_PROVIDER value is parsed
//   - what each backend can do (the capability table)
//
// The control plane (lifecycle manager, routes, durable object) and the web app
// both read capabilities from here instead of re-deriving behavior by comparing
// the provider name (e.g. `=== "modal"`). Adding or changing a provider is a
// single edit to PROVIDER_CAPABILITIES.

/**
 * Canonical sandbox backends.
 *
 * Vercel is on the roadmap but not yet implemented as a provider; it is added
 * to this union (and to PROVIDER_CAPABILITIES, the factory, and the web parser)
 * together with its provider class.
 */
export type SandboxBackendName = "modal" | "daytona";

/**
 * Parse the configured sandbox backend name.
 *
 * Defaults to Modal to preserve existing deployments. Throws on an unknown
 * value so misconfiguration fails loudly rather than silently falling back.
 */
export function parseSandboxBackendName(value: string | undefined): SandboxBackendName {
  const normalized = value?.trim().toLowerCase();

  if (!normalized || normalized === "modal") {
    return "modal";
  }
  if (normalized === "daytona") {
    return "daytona";
  }

  throw new Error(`Unsupported SANDBOX_PROVIDER: ${value}`);
}

/**
 * Capabilities supported by a sandbox provider.
 *
 * Each flag describes provider-agnostic intent ("supports Docker", "supports
 * prebuilt images") so callers can gate behavior on the capability rather than
 * on the provider name. Distinct features get distinct flags — never let "is
 * modal" stand in for an unrelated capability.
 */
export interface SandboxProviderCapabilities {
  /** Whether the provider supports filesystem snapshots */
  supportsSnapshots: boolean;
  /** Whether the provider supports restoring from snapshots */
  supportsRestore: boolean;
  /** Whether the provider supports pre-warming sandboxes */
  supportsWarm: boolean;
  /** Whether the provider can resume a previously stopped sandbox in place */
  supportsPersistentResume?: boolean;
  /** Whether the provider can stop a sandbox explicitly via API */
  supportsExplicitStop?: boolean;
  /** Whether the provider can run Docker Engine inside sandboxes */
  supportsDocker?: boolean;
  /** Whether the provider supports pre-built per-repo images (repo image builds) */
  supportsPrebuiltImages?: boolean;
  /** Whether the provider exposes a management dashboard URL for sandbox objects */
  supportsDashboardUrl?: boolean;
}

/**
 * Authoritative capability table, keyed by backend.
 *
 * This is build-time data shipped to both the control plane and the web bundle.
 * Provider classes set their `capabilities` from this table; routes and the web
 * client read it via {@link getProviderCapabilities}.
 */
export const PROVIDER_CAPABILITIES: Record<SandboxBackendName, SandboxProviderCapabilities> = {
  modal: {
    supportsSnapshots: true,
    supportsRestore: true,
    supportsWarm: true,
    supportsPersistentResume: false,
    supportsExplicitStop: false,
    supportsDocker: true,
    supportsPrebuiltImages: true,
    supportsDashboardUrl: true,
  },
  daytona: {
    supportsSnapshots: false,
    supportsRestore: false,
    supportsWarm: false,
    supportsPersistentResume: true,
    supportsExplicitStop: true,
    supportsDocker: false,
    supportsPrebuiltImages: false,
    supportsDashboardUrl: false,
  },
};

/**
 * Look up provider capabilities from a raw SANDBOX_PROVIDER value.
 *
 * Defaults to Modal (via {@link parseSandboxBackendName}); throws on an unknown
 * provider name.
 */
export function getProviderCapabilities(value: string | undefined): SandboxProviderCapabilities {
  return PROVIDER_CAPABILITIES[parseSandboxBackendName(value)];
}
