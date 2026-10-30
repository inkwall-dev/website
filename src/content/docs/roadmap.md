---
title: Roadmap
description: What v0.2.0 ships, and what the next milestones bring.
order: 11
---

Each release is a [milestone on GitHub](https://github.com/inkwall-dev/inkwall/milestones), with
its issues.

## v0.1.0: the first release

- **Engine**: OWASP Coraza with the Core Rule Set v4; reverse proxy, Traefik ForwardAuth and the
  `/v1/check` API; detect and block modes, explicit failure behaviour; `inkwallctl test` and
  `bench`.
- **Operator**: `WAFPolicy` and rule set CRDs validated when saved; signed, versioned policy bundles
  pushed to every engine; the engine injected into Traefik's pods; `Ingress` routes wired;
  `Accepted` → `Programmed` → `Enforced` → `Ready` status.
- **Resilience**: engines keep enforcing without the operator, and start from the cluster's bundle;
  proxy pods can't start without the engine while a policy blocks; uninstall unwires the routes
  first.
- **Release**: images for amd64 and arm64, a Helm chart on GHCR and binaries, all signed, with SBOM
  and provenance.

## v0.1.1 to v0.1.3

Three security releases. 0.1.1 also brought most of the v0.2.0 work forward
([release post](/blog/inkwall-v0-1-2/)):

- Traefik `IngressRoute` targets, not only `Ingress`.
- [Rotating the bundle signing key](/docs/key-rotation/) without dropping a request.
- [`inkwallctl test`](/docs/testing-rules/) against `WAFPolicy` objects or a
  cluster's bundle, for CI.
- Unwiring with a finalizer: when a policy is deleted, when injection is turned off, or when no
  Traefik pod would get the engine.
- The operator side of an optional [control plane](/docs/control-plane/): enrollment, a read-only
  GitOps mirror, Managed mode, and security events forwarded with a disk buffer.
- The ForwardAuth middleware caps the engine's answer (`maxResponseBodySize`); guides for
  [GitOps](/docs/gitops/) and the [client IP](/docs/client-ip/) behind a load balancer.
- Fixes for [GHSA-p4pw-j2x6-qhvj](https://github.com/inkwall-dev/inkwall/security/advisories/GHSA-p4pw-j2x6-qhvj)
  and [GHSA-jq3g-jfmx-62m4](https://github.com/inkwall-dev/inkwall/security/advisories/GHSA-jq3g-jfmx-62m4)
  (0.1.1, 0.1.2), and
  [GHSA-9x6c-5v2m-835r](https://github.com/inkwall-dev/inkwall/security/advisories/GHSA-9x6c-5v2m-835r)
  (0.1.3).

## v0.2.0: hardening, today

The rest of the milestone ([release post](/blog/inkwall-v0-2-0/)):

- Bundles past 900 KiB compressed split into chunk Secrets, up to 7.2 MiB.
- An operator that holds up with many policies and engines: each bundle encoded once for every
  engine, and engine streams kept alive while a send waits. A scale test with fake engines measures
  it, up to 5,000 policies and 500 engines ([How it works](/docs/how-it-works/)).
- [What Traefik does when the engine is unreachable](/docs/operations/), measured, tested and
  documented: a 500, in every mode.
- A restarted engine enforces its cached bundle from its first request (the fix for
  GHSA-9x6c-5v2m-835r, also in 0.1.3).
- Nightly fuzzing of the request, bundle and event parsers; an upgrade test from the last release;
  a faster end-to-end CI.
- Docs: an index, a glossary, guides for [testing policies](/docs/testing-rules/) and the
  standalone proxy, and a writing pass over the guides and design documents.

## v0.3.0: Gateway API, next

- Gateway API `HTTPRoute` targets, with Traefik's Gateway API provider and with Envoy Gateway
  (`ext_proc` / `ext_authz`).
- Proxy discovery behind one integration interface.
- Engine request counts and latency, sent to the optional control plane.
- A faster operator with thousands of policies: it stops rewriting every policy's status for each
  bundle.
- `inkwallctl`: migrating ingress-nginx ModSecurity annotations to `WAFPolicy`, and testing
  policies that target `IngressRoute` objects.

## v1.0.0: a stable API

The CRDs out of `v1alpha1`, with an upgrade path and a compatibility promise.

## Later

ingress-nginx (a Lua plugin), HAProxy (SPOE) and Caddy (a module).
