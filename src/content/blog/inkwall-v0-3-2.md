---
title: Inkwall v0.3.2
description: WebSockets work through Envoy Gateway and raw Envoy, with the handshake inspected.
date: 2026-11-03
author: The Inkwall team
---

Inkwall v0.3.2 is out. It's a fix-only patch release for 0.3, with one fix. Upgrade the chart as for
0.3.0, then restart the Envoy Gateway proxies so their pods run the 0.3.2 engine:

```sh
helm upgrade inkwall oci://ghcr.io/inkwall-dev/charts/inkwall --version 0.3.2 \
  --namespace inkwall-system --reset-then-reuse-values
kubectl -n inkwall-system rollout status deployment/inkwall-operator
kubectl -n <envoy gateway namespace> rollout restart deployment -l app.kubernetes.io/name=envoy,app.kubernetes.io/managed-by=envoy-gateway
```

## WebSockets work through Envoy

In 0.3.0 and 0.3.1, a WebSocket handshake through the engine's `ext_proc` adapter (Envoy Gateway,
or an Envoy you configure yourself) didn't complete. Envoy sends an upgrade request's headers
without marking the end of the request. The engine then waited for a body, which only comes after
the `101 Switching Protocols`. With a policy in `Block` mode and body inspection on, Envoy held
every handshake until its `ext_proc` timeout. In `Detect` mode, the engine read the WebSocket
frames as a body and logged every handshake as oversized. It failed closed: no request got through
uninspected.

Now a bodiless `GET` with an `Upgrade` header is decided on its headers:

- An attack in its URL or headers is still denied, with 403 and no upgrade.
- A clean one upgrades, and Envoy sends nothing more of the connection to the engine.
- An upgrade request that declares a body still waits for it, and the body is inspected.

The messages after the upgrade aren't inspected, through Envoy or Traefik. Traefik (ForwardAuth)
wasn't affected by the bug.

[Upgrading](/docs/upgrading/) has the details, and the
[release notes](https://github.com/inkwall-dev/inkwall/releases/tag/v0.3.2) the changelog.

## What's next

v0.4.0 adds Istio and raw Envoy, HAProxy, response inspection, gRPC messages, and WebSocket
handshake rules (allowed origins, required headers). The [roadmap](/docs/roadmap/) has the details.

Tell us what breaks: [issues](https://github.com/inkwall-dev/inkwall/issues) are welcome. Security
reports go through
[private reporting](https://github.com/inkwall-dev/inkwall/security/advisories/new).
