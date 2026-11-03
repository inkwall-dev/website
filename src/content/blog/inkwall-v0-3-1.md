---
title: Inkwall v0.3.1
description: gRPC calls are no longer denied, status never claims protection that isn't there, suspending works with a bundle too large, a clean uninstall, and a version command.
date: 2026-11-03
author: The Inkwall team
---

Inkwall v0.3.1 is out, a patch release for 0.3.0. Upgrade the chart as for 0.3.0, and restart
Traefik so its pods run the 0.3.1 engine:

```sh
helm upgrade inkwall oci://ghcr.io/inkwall-dev/charts/inkwall --version 0.3.1 \
  --namespace inkwall-system --reset-then-reuse-values
kubectl -n inkwall-system rollout status deployment/inkwall-operator
kubectl -n <traefik namespace> rollout restart deployment/<traefik>
```

## gRPC calls are no longer denied

In 0.3.0, the embedded Core Rule Set denied every gRPC call in `Block` mode (403) and logged it in
`Detect` mode, through Envoy Gateway and Traefik alike: `application/grpc` wasn't an allowed content
type (rule 920420), and the protobuf body was parsed as form data (920270, 921150).

Now a `POST` with a gRPC content type (`application/grpc`, `+proto`, `grpc-web`, `grpc-web+proto`)
**and** a body in gRPC framing is evaluated on its path, query and headers (the gRPC metadata)
through every rule, without its body. An attack in the metadata, path or query is still denied. A
request that only claims to be gRPC (a JSON or form body, bad framing, another method) is inspected
in full, as before. Message bodies aren't inspected yet: that is planned for 0.4.0
([#275](https://github.com/inkwall-dev/inkwall/issues/275)). See [gRPC](/docs/grpc/), with what
streaming calls do through each proxy.

## Status never claims protection that isn't there

- **Suspended.** While `InkwallConfig.spec.suspend` is `true`, every `WAFPolicy` is
  `Enforced=False` and `Ready=False`, reason `Suspended`, and the `InkwallConfig` has a new
  `Suspended` condition. In 0.3.0 they could stay `Ready=True` while nothing was inspected.
- **Bundle too large.** When the bundle is too large to publish, the policies it would add or change
  are `Accepted=False`, reason `BundleTooLarge`, with the sizes, until it fits. In 0.3.0 they kept
  their previous conditions.
- **Envoy Gateway.** Routes aren't reported `Programmed` while the operator can't raise Envoy's
  buffer limit for them.

## And more

- **Suspending works when the bundle is too large.** In 0.3.0, `spec.suspend` did nothing while the
  bundle was too large to publish, exactly when something was already wrong. Now the bundle the
  engines run is published again, suspended. See [Operations](/docs/operations/).
- **`helm uninstall` leaves nothing behind**: it also deletes the operator's `inkwall-trust`
  ConfigMaps, the engine reports, the `inkwall-bundle-reader` Role and RoleBinding, and the leader
  Lease.
- **A `version` command**: `inkwallctl version`, `inkwall-engine version` and
  `inkwall-operator version` (or `--version`) print the version, the commit and the Go version.
- The cluster state the operator sends to a connected [control plane](/docs/control-plane/) lists
  every integration, Envoy Gateway included, with its proxy pods.
- Dependencies: grpc-go 1.85 and the other Go modules updated.

[Upgrading](/docs/upgrading/) lists what changes by itself. The
[release notes](https://github.com/inkwall-dev/inkwall/releases/tag/v0.3.1) have the full
changelog.

## What's next

v0.4.0: Istio and raw Envoy, HAProxy, response inspection, gRPC messages and WebSocket. The
[roadmap](/docs/roadmap/) has the details.

Tell us what breaks: [issues](https://github.com/inkwall-dev/inkwall/issues) are welcome, and
security reports go through
[private reporting](https://github.com/inkwall-dev/inkwall/security/advisories/new).
