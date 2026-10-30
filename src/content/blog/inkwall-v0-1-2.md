---
title: Inkwall v0.1.1 and v0.1.2
description: Two security fixes, Traefik IngressRoute targets, signing key rotation, policy tests in CI, and the operator side of an optional control plane.
date: 2026-10-30
author: The Inkwall team
---

Inkwall v0.1.1 and v0.1.2 are out. Both fix a security issue, so upgrade to **0.1.2**. v0.1.1 also
brings most of what was planned for v0.2.0.

```sh
helm upgrade inkwall oci://ghcr.io/inkwall-dev/charts/inkwall --version 0.1.2 \
  --namespace inkwall-system --reset-then-reuse-values
kubectl -n <traefik namespace> rollout restart deployment/<traefik>
```

## Security fixes

**[GHSA-p4pw-j2x6-qhvj](https://github.com/inkwall-dev/inkwall/security/advisories/GHSA-p4pw-j2x6-qhvj)
(medium, fixed in 0.1.1).** Under concurrent load, the engine could inspect a request with rule
exclusions that belong to another path, so an attack in an excluded argument could get through on a
path where that argument isn't excluded. It affects 0.1.0 policies that, for the same rule, combine
an argument exclusion on every path with argument exclusions limited to paths, and rule sets whose
own SecLang negates an `ARGS` target. Policies without argument exclusions aren't affected. 0.1.1
applies exclusions per request.

**[GHSA-jq3g-jfmx-62m4](https://github.com/inkwall-dev/inkwall/security/advisories/GHSA-jq3g-jfmx-62m4)
(high, fixed in 0.1.2).** In the standalone reverse proxy, a request with an absolute-form target
(`GET http://<host>/path`) could be inspected under another Host than the one the application
received, and skip inspection when no policy covered every host. It affects `inkwall-engine proxy`
in 0.1.0 and 0.1.1. The Kubernetes operator with Traefik and the check API aren't affected. The
proxy now refuses absolute-form targets and invalid Hosts with a 400. If you run the engine as a
proxy, upgrade the binary or image to 0.1.2.

The advisories list workarounds for anyone who can't upgrade yet.

## What's new

- **Traefik `IngressRoute` targets**, next to `Ingress`: the operator adds its middleware first in
  every route of the `IngressRoute`, keeping yours. See [Policies](/docs/policies/).
- **Signing key rotation**: the key bundles are signed with rotates on demand or on a schedule,
  and engines trust the new key before it signs anything, so no request is dropped.
  See [Key rotation](/docs/key-rotation/).
- **`inkwallctl test` against your policies**: give it your `WAFPolicy` files, with the rule sets and
  Ingresses they use, or the bundle the cluster runs, and `--expect allow|deny` fails the build on a
  wrong verdict. See [Testing rules](/docs/testing-rules/).
- **Unwiring you can rely on**: a finalizer makes a deleted policy wait until its routes are
  unwired, and turning injection off, or losing every Traefik pod the engine would go into, unwires
  the routes instead of leaving them pointing at a missing engine. See [Operations](/docs/operations/).
- **An optional control plane, operator side**: a cluster can enroll with a control plane, mirror its
  policies to it read-only, take policies from it in Managed mode, and forward security events with
  a disk buffer. Standalone, the default, never connects, and enforcement never depends on it. See
  [Control plane](/docs/control-plane/).
- **A capped ForwardAuth answer** (0.1.2): on Traefik v3.7 or later, the middleware sets
  `maxResponseBodySize`.
- **New guides**: [Upgrading](/docs/upgrading/), [GitOps with Argo CD and Flux](/docs/gitops/) and
  the [client IP behind a load balancer](/docs/client-ip/).

## Upgrading

From 0.1.0, read [Upgrading](/docs/upgrading/) first: every `WAFPolicy` gets a finalizer, which
matters if Argo CD or Flux manages them, and routes are unwired when injection is off. Use
`--reset-then-reuse-values` (Helm 3.14 or later) or pass your values file again. With
`--reuse-values`, the upgrade from 0.1.0 to 0.1.1 fails on the new `controlPlane` values; 0.1.2
defaults them. Then restart Traefik, so its pods run the 0.1.2 engine. From 0.1.1, upgrading the
chart and restarting Traefik is all there is. If you run the engine on its own, replace the binary
or image.

## What's next

v0.2.0 finishes hardening: bundles over 1 MiB, an operator that holds up with many policies and
engines, and a docs pass. v0.3.0 brings Gateway API `HTTPRoute` targets, with Traefik and with Envoy
Gateway. The [roadmap](/docs/roadmap/) has the details.

Tell us what breaks: [issues](https://github.com/inkwall-dev/inkwall/issues) are welcome, and
security reports go through
[private reporting](https://github.com/inkwall-dev/inkwall/security/advisories/new).
