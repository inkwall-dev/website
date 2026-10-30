---
title: Inkwall v0.1.3 and v0.2.0
description: A security fix for restarted engines, bundles split into chunk Secrets, an operator that holds up with many engines, and what Traefik does when the engine is unreachable.
date: 2026-10-30
author: The Inkwall team
---

Inkwall v0.1.3 and v0.2.0 are out. Both fix a security issue, so upgrade to **0.2.0**, or to
**0.1.3** if you need to stay on 0.1 for now. Most of what was planned for v0.2.0 already shipped
in 0.1.1; 0.2.0 brings the rest of its hardening.

```sh
helm upgrade inkwall oci://ghcr.io/inkwall-dev/charts/inkwall --version 0.2.0 \
  --namespace inkwall-system --reset-then-reuse-values
kubectl -n <traefik namespace> rollout restart deployment/<traefik>
```

## Security fix

**[GHSA-9x6c-5v2m-835r](https://github.com/inkwall-dev/inkwall/security/advisories/GHSA-9x6c-5v2m-835r)
(medium, fixed in 0.1.3 and 0.2.0).** When the engine container restarted inside a running proxy
pod (a crash, an out-of-memory kill, a liveness restart), it opened its request port before
applying the bundle in its cache. For about 0.1 s it allowed requests uninspected, as if no policy
applied, even under a block-mode policy: measured with Traefik, 39 attacks got through over 4
restarts. Traefik sends requests to its pod's engine even while the pod isn't ready.

It affects 0.1.0 to 0.1.2. New proxy pods aren't affected: the engine's startup probe waits for
the first bundle before Traefik starts. Neither are the standalone reverse proxy and the check API
configured with flags, which have no bundle. The engine now applies its cached bundle before it
opens its port; while it loads, Traefik answers 500, and never forwards a request uninspected.

The fix is in the engine: upgrade the chart, then restart Traefik so its pods run the new engine.
If you can't upgrade yet, the advisory has a workaround (`spec.engine.bootstrapMode: DenyAll`).

## What's new in 0.2.0

- **Bundles split into chunk Secrets.** The bundle of a cluster's policies is kept in the Secret
  `inkwall-bundle`, where engines read it when they start without the operator. Past 900 KiB
  compressed, it is now split into chunk Secrets, up to 7.2 MiB. Bundles name the Core Rule Set
  rather than embed it, so most clusters never get there: in the scale test, 5,000 policies took
  134 KiB. See [Operations](/docs/operations/).
- **An operator that holds up with many engines.** Each stream used to encode the bundle on its
  own, so the operator held a copy per engine: about 2 GiB at 5,000 policies and 500 engines in our
  scale test. It now encodes each bundle once. In the same test, the operator peaked at 518 MiB
  with 500 engines and 507 MiB with 50, and a policy change reached every engine in 3.5 s
  (median). The test runs on one machine with fake engines; the numbers are in
  [How it works](/docs/how-it-works/).
- **Engine streams kept alive while a send waits.** At 500 engines, waiting for a send slot counted
  against a stream's idle timeout, so engines were disconnected and sent the bundle again. The
  operator now keeps reading their heartbeats meanwhile.
- **What Traefik does when the engine is unreachable**, measured, tested and documented: Traefik
  answers 500 and forwards nothing, at once if the engine refuses the connection, after 30 s if it
  hangs, in detect mode as in block mode. Traefik's ForwardAuth has no setting to let requests
  through instead. See [Operations](/docs/operations/) for what keeps such an outage short.
- **Tests.** An operator scale test with fake engines; nightly fuzzing of the request, bundle and
  event parsers; a `helm upgrade` test from the last release, which sends attacks through Traefik
  during the upgrade; a faster end-to-end CI.
- **Docs.** The main repository has a [docs index](https://github.com/inkwall-dev/inkwall/blob/v0.2.0/docs/README.md),
  a [glossary](https://github.com/inkwall-dev/inkwall/blob/v0.2.0/docs/glossary.md), and guides for
  [testing policies offline](/docs/testing-rules/) and
  [running the engine without Kubernetes](https://github.com/inkwall-dev/inkwall/blob/v0.2.0/docs/standalone-proxy.md).

0.2.0 also has what 0.1.1 and 0.1.2 brought ([release post](/blog/inkwall-v0-1-2/)): `IngressRoute`
targets, signing key rotation, `inkwallctl test` against your policies, unwiring with a finalizer,
the operator side of an optional control plane, and the capped ForwardAuth answer.

## Upgrading

From 0.1.1 or later, the CRDs and the chart's values don't change: upgrade the chart, then restart
Traefik. Engines from 0.1.x can't read a bundle split into chunks, which is one more reason to
restart. From 0.1.0, read [Upgrading](/docs/upgrading/) first: every `WAFPolicy` gets a finalizer,
which matters if Argo CD or Flux manages them. Before rolling back to 0.1.x, check that the bundle
isn't split into chunks: 0.1.x can't read it.

To verify the images, the chart and the checksums, use cosign v3 or later; cosign v2 reports
`no signatures found`. See [Getting started](/docs/getting-started/).

## What's next

v0.3.0 brings Gateway API `HTTPRoute` targets, with Traefik and with Envoy Gateway, proxy discovery
behind one integration interface, engine request metrics sent to the optional control plane, and
migrating ingress-nginx ModSecurity annotations to `WAFPolicy`. The [roadmap](/docs/roadmap/) has
the details.

Tell us what breaks: [issues](https://github.com/inkwall-dev/inkwall/issues) are welcome, and
security reports go through
[private reporting](https://github.com/inkwall-dev/inkwall/security/advisories/new).
