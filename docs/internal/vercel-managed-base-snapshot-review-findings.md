# Vercel Managed Base Snapshot Review Findings

This is an internal review log for the Vercel managed base snapshot work. It captures the earlier
review findings that have already shaped the PR, plus the remaining structural findings from the
latest thermo review pass.

## Resolved Findings

### Runtime Source Parity

The first implementation built the Vercel base snapshot from a configured repo URL and branch,
defaulting to the public repository's moving `main`. The worker being deployed came from the
checked-out commit, so the control plane and the runtime inside the Vercel snapshot could come from
different source revisions.

That did not match the Modal and Daytona pattern, where Terraform derives runtime artifacts from
`var.project_root` and the local checkout being deployed.

Resolution:

- Removed runtime Git source support for Vercel base snapshots.
- Moved the Vercel base snapshot build into Terraform via the `vercel-sandbox-infra` module.
- Built the runtime archive from the local `packages/sandbox-runtime` directory.
- Included the sandbox runtime, Vercel bootstrap, Vercel client, and base snapshot builder files in
  the Terraform source hash.
- Wired the deterministic managed snapshot name into the deployed worker through
  `VERCEL_BASE_SNAPSHOT_NAME`.

### Repo Image Callback Coordinator

The callback coordinator approach was too indirect for the Vercel repo image flow. It introduced an
extra control abstraction around a provider-specific lifecycle: start a Vercel sandbox, let the
runtime build the repo image, receive completion, snapshot the sandbox, then mark the repo image
ready.

The concern was that this made the callback path harder to reason about and harder to debug when a
build remained stuck in `building`.

Resolution:

- Removed the extra callback coordinator abstraction.
- Let the Vercel provider launch the sandbox runtime directly with repo-image callback metadata.
- The runtime reports build success or failure back to the control plane.
- The control plane snapshots the Vercel build session and records the resulting provider image ID.
- Added callback auth and route-level observability so failed callback handling is easier to see in
  Cloudflare logs.

### Provider-Scoped Repo Image Lookup

`RepoImageStore.getLatestReady` accepted an optional provider even though provider is now part of the
repo-image identity. That optionality could hide caller mistakes and allow a future Vercel session to
retrieve a Modal image, or the reverse.

Resolution:

- Made `provider` required for `getLatestReady`.
- Kept cross-provider lookup as a separate, explicitly named `getLatestReadyForAnyProvider` method.
- Updated lifecycle and test callers to use provider-scoped lookups.

### Callback Failure Visibility

The production pre-build flow exposed that a Vercel repo image could remain in `building` if the
callback did not complete successfully. There was not enough signal to immediately distinguish
between a failed runtime callback, blocked request, auth failure, or snapshot completion failure.

Resolution:

- Added additional callback request/auth logging.
- Fixed the Vercel callback request behavior that was being blocked before the control-plane route
  could handle it.
- Added Vercel completion handling that records build failure if snapshot creation or ready-state
  transition fails.

### Vercel Callback Secret Exposure

The first Vercel callback flow passed `INTERNAL_CALLBACK_SECRET` into the Vercel build sandbox so
the runtime could mint the same internal HMAC token used by trusted service-to-service routes. That
was not acceptable because repo-controlled setup code runs in the build sandbox and can read process
environment variables.

Resolution:

- Stopped passing `INTERNAL_CALLBACK_SECRET` into Vercel repo-image build sandboxes.
- Generated a random callback token per Vercel repo-image build.
- Stored only a hash of the callback token in D1.
- Sent the raw token only to the runtime entrypoint command for that build.
- Verified and consumed the token only on `/repo-images/build-complete` or
  `/repo-images/build-failed`.
- Kept Modal on the existing internal HMAC callback path because the Modal shim remains the trusted
  callback signer.

### Vercel Callback Session Binding

The first Vercel success callback trusted the request body to provide the Vercel session to snapshot.
With a valid callback credential, a body could point the control plane at a different Vercel session.

Resolution:

- Added `provider_session_id` to the repo-image build row.
- Bound the created Vercel build session before launching the runtime entrypoint.
- Required Vercel success and failure callbacks to include the matching `provider_session_id`.
- Made callback token consumption single-use.
- Made ready/failed transitions provider-bound and conditional on `status = 'building'`.

### Vercel Callback Router Authentication

After moving Vercel to a per-build callback token, the repo-image callback routes still sat behind
the global router's internal HMAC gate. That meant real Vercel runtime callbacks would be rejected
before the route-level per-build token verification could run.

Resolution:

- Made only `/repo-images/build-complete` and `/repo-images/build-failed` public at the global
  router layer.
- Kept both routes self-authenticating in `repo-images.ts`.
- Modal callbacks still require the existing internal HMAC inside the route handler.
- Vercel callbacks require the per-build token plus matching `provider_session_id`.
- Added full-router integration coverage for Vercel callback acceptance, missing token, mismatched
  session, and replay rejection.

### Callback Body Parsing On Public Routes

After making the callback routes public at the global router layer, the route handlers parsed JSON
before route-level authentication. That did not bypass callback credentials, but it created avoidable
unauthenticated parsing work on public endpoints.

Resolution:

- Moved Modal callback HMAC authentication before JSON parsing.
- Added a Vercel pre-parse bearer-token shape check before JSON parsing.
- Kept Vercel's D1-backed single-use callback token and `provider_session_id` verification after
  parsing because that verification depends on callback body fields.
- Added full-router regression coverage for unauthenticated Modal callbacks with malformed bodies
  and malformed Vercel callback bearer tokens.

## Open Findings

### Repo Image Route Owns Provider Orchestration

`packages/control-plane/src/routes/repo-images.ts` is now doing more than route handling. The route
authenticates and parses repo-image requests, but it also branches on the backend, snapshots Vercel
build sessions, marks repo images ready or failed, and deletes replaced provider images.

This works, but it makes the route layer responsible for provider lifecycle policy. That will get
harder to maintain as repo-image behavior diverges across Modal, Daytona, and Vercel.

Recommended follow-up:

- Extract a repo-image build backend or coordinator service.
- Keep route handlers responsible for auth, parsing, and response formatting.
- Move provider-specific behavior behind methods such as `triggerBuild`, `completeBuild`, and
  `deleteProviderImage`.
- Let the Modal backend require `provider_image_id` from the callback.
- Let the Vercel backend require `provider_session_id`, snapshot the session, and then mark the image
  ready.

### Vercel Provider Construction Is Duplicated

Vercel provider construction is duplicated in the repo-image route and the Session Durable Object.
Both places map environment variables into a Vercel client and `VercelSandboxProvider` config.

The duplicated fields include token, team ID, project ID, API base URL, base snapshot ID/name,
runtime, snapshot expiration, and code-server password secret. Drift between those two construction
sites would be easy to miss.

Recommended follow-up:

- Introduce a shared provider factory, for example `createVercelProviderFromEnv(env)`.
- Reuse it from both the Session Durable Object and repo-image route.
- Consider a broader `createSandboxProviderFromEnv(env, provider)` factory if that keeps provider
  selection cleaner.

## Current Review Notes

- No changed file crossed the 1,000-line threshold during the latest thermo review pass.
- The local-runtime snapshot build now matches the intended source-parity model: Terraform builds
  from the checked-out source instead of a repo URL or moving branch.
- The remaining concerns are structural maintainability issues, not known production blockers.
