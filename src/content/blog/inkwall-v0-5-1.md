---
title: "Inkwall 0.5.1: security fixes"
description: A low-severity fix for detect mode through Envoy, and Go 1.27.4 for a net/http panic. Upgrade the chart and restart the proxies that run the engine.
date: 2026-11-13
author: The Inkwall team
---

Inkwall 0.5.1 is out, a patch release with security fixes for 0.5. Everyone on 0.5.0 should
upgrade to 0.5.1. On 0.4.x, upgrade straight to 0.5.1. It has no API or chart change.

## The advisory

| Advisory | Severity | What | Affected | Fixed in |
|---|---|---|---|---|
| [GHSA-839p-9ccr-29jj](https://github.com/inkwall-dev/inkwall/security/advisories/GHSA-839p-9ccr-29jj) | Low | Through Envoy, a request carrying a valid operator probe header passed uninspected on routes in `Detect` mode | 0.5.0 (Envoy Gateway, Istio and raw Envoy, policies in `Detect` mode) | 0.5.1 |

In `Detect` mode Envoy ignores the engine's answer to the operator's probe and forwards the
request, so a request with a valid probe header for its host and path reached the application
without being inspected or logged. `Detect` mode never blocks, so what was lost is detection, not
blocking. HAProxy, Traefik and the standalone proxy aren't affected. In 0.5.1 the engine inspects
and logs such a request like any other.

The advisory has the details, and the workarounds for those who can't upgrade at once: use `Block`
mode on routes where detecting every request matters, or
[rotate the signing key](/docs/key-rotation/), which changes the probe key, if a probe header may
have been exposed.

## Go 1.27.4

0.5.1 is built with Go 1.27.4, for [GO-2026-6859](https://pkg.go.dev/vuln/GO-2026-6859): an
HTTP/1 server using `net/http`'s `MaxBytesReader` could panic when its limit was exceeded while the
handler wrote headers. The engine's and the operator's HTTP servers use it.

## What to do

1. Upgrade the chart:

   ```sh
   helm upgrade inkwall oci://ghcr.io/inkwall-dev/charts/inkwall --version 0.5.1 \
     --namespace inkwall-system --reset-then-reuse-values
   ```

2. Restart the proxies whose pods run the engine, so they get the new engine: Traefik, Istio's
   ingress gateways and the HAProxy Kubernetes Ingress Controller. Istio rolls its Gateway API
   gateways and Envoy Gateway re-creates its own; with `spec.engine.rollout: Automatic`, the
   operator restarts the pods it injects. A standalone `inkwall-engine proxy`, raw Envoy or HAProxy
   setup: run the new engine image.

`Block` mode is unchanged, and `Detect`-mode routes through Istio and Envoy Gateway stay
`Unverified`, as in 0.5.0. The [upgrade guide](/docs/upgrading/) has the notes.
