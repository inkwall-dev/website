---
title: "Inkwall 0.6.1: a Traefik advisory and fixes"
description: A patch release for 0.6. Traefik before v3.7 forwards h2c upgrades past the engine, so use Traefik v3.7 or later; Enforced now waits for every raw Envoy and standalone engine; and five more fixes.
date: 2026-11-18
author: The Inkwall team
---

Inkwall 0.6.1 is out, a patch release for 0.6 with no API change. Everyone on 0.6.0 should
upgrade. If you run Inkwall with Traefik, check its version too: it needs to be v3.7 or later.

## The advisory

[GHSA-r678-m82v-mwxw](https://github.com/inkwall-dev/inkwall/security/advisories/GHSA-r678-m82v-mwxw)
(medium). Traefik v3.0 to v3.6 forwards a request's `Upgrade: h2c` header to the app. An app that
accepts the upgrade switches the connection to HTTP/2, and the requests the client sends on it go
straight to the app: no Traefik Middleware sees them, ForwardAuth included, so the engine doesn't
inspect them. Traefik v3.7 and later remove the header, and aren't affected.

The fix is Traefik's: upgrade Traefik and its CRDs to v3.7 or later. Inkwall can't block the
upgrade itself, because ForwardAuth doesn't pass `Upgrade` to the engine. From 0.6.1, a policy
whose routes an older Traefik serves says so in its `Programmed` message, naming the image, so you
can find the routes at risk:

```sh
kubectl get wafpolicy -A -o jsonpath='{range .items[*]}{.metadata.namespace}/{.metadata.name}: {.status.conditions[?(@.type=="Programmed")].message}{"\n"}{end}' | grep 'before v3.7'
```

Until you upgrade Traefik, make sure the apps behind it don't accept h2c upgrades.

## Fixed

- **`Enforced` waits for every engine of raw Envoy and the standalone proxy.** The operator doesn't
  know these proxies' pods, so it counted only the engines connected at the time. An engine that
  was reconnecting, or cut off from the operator, still ran the policy's previous rules while the
  policy said `Enforced`. Now the policy stays `EnginesBehind` until that engine reconnects and
  runs the current version, for as long as its pod exists. Traefik, Envoy Gateway, Istio and
  HAProxy weren't affected.
- **A rule set whose last `SecRule` ends in an open `chain` is refused** (`RuleCompileError`),
  instead of compiling with the chain's first rule acting alone.
- **A panic while reading one proxy connection no longer stops the engine.** That connection
  fails, and `inkwall_panics_total` counts it.
- **Server-Sent Events:** the first event of a stream that starts with a byte order mark is
  inspected.
- **`inkwallctl status`** shows that responses are inspected through Istio and HAProxy.

We found these in a review of 0.6.0: the docs against the code, a security review, and a battle
test that ran every proxy for five hours under chaos. The `Enforced` fix came from that soak, and
a 45-minute run with the engines cut off from the operator for three minutes at a time confirmed
it.

## Upgrading

Upgrade the chart, then restart the proxies whose pods run the engine so they get the 0.6.1
engine, or let `spec.engine.rollout: Automatic` do it:

```sh
helm upgrade inkwall oci://ghcr.io/inkwall-dev/charts/inkwall --version 0.6.1 \
  --namespace inkwall-system --reset-then-reuse-values
```

The full notes are on the [release](https://github.com/inkwall-dev/inkwall/releases/tag/v0.6.1).
0.6, 0.5 and 0.4 are supported; the advisory's advice, upgrading Traefik, applies to all three.
