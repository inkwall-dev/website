---
title: "Inkwall 0.5.3 and 0.4.2: security fixes"
description: A low-severity fix for Traefik in 0.5.3, where an invalid X-Forwarded-Host was quoted in the engine's error log, and 0.4.2 built with Go 1.27.4. Upgrade the chart and restart the proxies that run the engine.
date: 2026-11-15
author: The Inkwall team
---

Inkwall 0.5.3 and 0.4.2 are out, patch releases for the 0.5 and 0.4 lines. Everyone on 0.5.x
should upgrade to 0.5.3. On 0.4.x, upgrade to 0.5.3, or to 0.4.2 to stay on 0.4. Neither has an
API or chart change.

## 0.5.3: the advisory, updated

| Advisory | Severity | What | Affected | Fixed in |
|---|---|---|---|---|
| [GHSA-m382-qw6g-4qmj](https://github.com/inkwall-dev/inkwall/security/advisories/GHSA-m382-qw6g-4qmj) | Low | Request values from unparseable requests are written to the engine's error log | Every release up to 0.4.2, and 0.5.0 to 0.5.2 through Traefik (ForwardAuth) | 0.5.3 |

When an adapter can't read a request it was asked to check, the engine logs the error. Before
0.5.0, that error quoted the value it couldn't read, and a request target's query string can carry
secrets such as `?token=`. 0.5.0 kept request values out of every parse-error log line but one:
through Traefik's ForwardAuth, an invalid `X-Forwarded-Host` was still quoted. The advisory now
says so, and 0.5.3 logs that header by name only. The request is still refused with 400.

A correctly configured proxy doesn't send such requests to the engine; Traefik sends a Host it has
already validated. Through Envoy, Istio, HAProxy and the standalone proxy, 0.5.0 already kept
request values out of these log lines. The advisory's workaround, for those who can't upgrade at once: restrict access to the
engine's logs, and make sure the proxy forwards only origin-form request targets. 0.4.x isn't
patched for this advisory: upgrade to 0.5.3, or apply the workaround.

## 0.4.2: Go 1.27.4

0.4.2 is built with Go 1.27.4, for [GO-2026-6859](https://pkg.go.dev/vuln/GO-2026-6859): an HTTP/1
server using `net/http`'s `MaxBytesReader` could panic when its limit was exceeded while the
handler wrote headers. The engine's and the operator's HTTP servers use it. 0.5.1 made the same
change for 0.5.

## What to do

1. Upgrade the chart, to 0.5.3 (or 0.4.2):

   ```sh
   helm upgrade inkwall oci://ghcr.io/inkwall-dev/charts/inkwall --version 0.5.3 \
     --namespace inkwall-system --reset-then-reuse-values
   ```

2. Restart the proxies whose pods run the engine so they get the new engine. For 0.5.3, only the
   engine injected into Traefik changes: restart Traefik's pods, or let
   `spec.engine.rollout: Automatic` do it. For 0.4.2, restart Traefik, Istio's Gateways, HAProxy
   and the Envoy Gateway proxies.

The [upgrade guide](/docs/upgrading/) has the notes, and the release notes of
[0.5.3](https://github.com/inkwall-dev/inkwall/releases/tag/v0.5.3) and
[0.4.2](https://github.com/inkwall-dev/inkwall/releases/tag/v0.4.2) have the rest.
