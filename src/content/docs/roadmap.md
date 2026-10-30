---
title: Roadmap
description: What v0.1.2 ships, and what the next milestones bring.
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

## v0.1.1 and v0.1.2: today

Two security releases, which also brought most of the v0.2.0 work forward
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
  and [GHSA-jq3g-jfmx-62m4](https://github.com/inkwall-dev/inkwall/security/advisories/GHSA-jq3g-jfmx-62m4).

## v0.2.0: hardening

The rest of the milestone:

- Bundles over 1 MiB, split into chunks.
- An operator that holds up with many policies and engines.
- A faster end-to-end CI.
- Docs: an index, and a writing pass over the guides and design documents.

## v0.3.0: Gateway API

Gateway API `HTTPRoute` targets, with Traefik's Gateway API provider and with Envoy Gateway
(`ext_proc` / `ext_authz`); proxy discovery behind one integration interface; and migrating
ingress-nginx ModSecurity annotations to `WAFPolicy`.

## v1.0.0: a stable API

The CRDs out of `v1alpha1`, with an upgrade path and a compatibility promise.

## Later

ingress-nginx (a Lua plugin), HAProxy (SPOE) and Caddy (a module).
