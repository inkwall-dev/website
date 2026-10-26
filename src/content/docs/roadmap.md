---
title: Roadmap
description: What v0.1.0 ships, and what the next milestones bring.
order: 6
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

## v0.2.0: hardening

- Traefik `IngressRoute` targets, not only `Ingress`.
- Rotating the bundle signing key without dropping a request.
- Memory that stays flat with many policies (shared compiled rule sets), and bundles over 1 MiB.
- `inkwallctl test` against a `WAFPolicy` or a bundle, for CI.
- Unwiring when the configuration is deleted or injection is turned off.

## v0.3.0: the next proxy

Gateway API `HTTPRoute` targets with Envoy Gateway (`ext_proc` / `ext_authz`).

## v1.0.0: a stable API

The CRDs out of `v1alpha1`, with an upgrade path and a compatibility promise.

## Later

ingress-nginx (a Lua plugin), HAProxy (SPOE), Caddy (a module), and an optional control plane for
policies across clusters and attack analytics.
