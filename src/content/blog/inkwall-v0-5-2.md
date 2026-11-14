---
title: "Inkwall 0.5.2: an HAProxy security fix"
description: A low-severity fix for HAProxy, where a request too large for one SPOE frame could pass uninspected when a Block-mode policy failed open. Upgrade the chart; with HAProxy configured by hand, add one rule.
date: 2026-11-14
author: The Inkwall team
---

Inkwall 0.5.2 is out, a patch release with one security fix for 0.5. Everyone on 0.5.1 should
upgrade to 0.5.2. On 0.5.0 or 0.4.x, upgrade straight to 0.5.2. It has no API change.

## The advisory

| Advisory | Severity | What | Affected | Fixed in |
|---|---|---|---|---|
| [GHSA-4w3f-28c3-cc6g](https://github.com/inkwall-dev/inkwall/security/advisories/GHSA-4w3f-28c3-cc6g) | Low | Through HAProxy, a request too large for one SPOE frame passed uninspected when a `Block`-mode policy failed open | 0.4.0 to 0.5.1 (HAProxy with `tune.bufsize` raised above the engine's frame size, `Block`-mode policies with `failureMode: Open`) | 0.5.2 |

HAProxy sends each request to the engine in one SPOE frame, and a request that doesn't fit isn't
sent at all: the engine gives no verdict, and the configuration's fail-closed rule decides. With a
`Block`-mode policy that fails open, such a request reached the application without being
inspected, instead of being handled as oversized. That needs HAProxy's buffer (`tune.bufsize`)
raised above the frame size the engine announces; with HAProxy's default buffer, a larger body is
cut and handled as oversized, as documented. Envoy, Traefik and the standalone proxy aren't
affected. In 0.5.2 such a request is handled as `body.onOversize` says: 413 for `Block`-mode
policies, whatever the failure mode.

The advisory has the details, and the workarounds for those who can't upgrade at once: keep
HAProxy's default `tune.bufsize`, use `failureMode: Closed` (the default in `Block` mode), or add
the rule below. 0.4.x isn't patched: upgrade to 0.5.2, or use a workaround.

## What to do

1. Upgrade the chart:

   ```sh
   helm upgrade inkwall oci://ghcr.io/inkwall-dev/charts/inkwall --version 0.5.2 \
     --namespace inkwall-system --reset-then-reuse-values
   ```

   The operator updates the HAProxy Ingresses' snippets by itself; nothing needs a restart for
   this fix.

2. With HAProxy configured by hand, add the new rule of the
   [example configuration](https://github.com/inkwall-dev/inkwall/blob/v0.5.2/examples/haproxy/haproxy.cfg)
   before the fail-closed rule, and leave it out in detect mode:

   ```haproxy
   http-request deny deny_status 413 if { var(txn.inkwall.error) -m int 3 259 }
   ```

[Protecting HAProxy](https://github.com/inkwall-dev/inkwall/blob/v0.5.2/docs/haproxy.md#the-complete-haproxycfg)
has the whole configuration, and the [upgrade guide](/docs/upgrading/) has the notes.
