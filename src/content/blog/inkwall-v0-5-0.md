---
title: Inkwall v0.5.0
description: Tune the Core Rule Set on the policy, exclude a cookie or a header, deny clients by IP list, inspect responses through Istio, roll out new engines automatically, and see what happens with inkwallctl status, metrics and a dashboard.
date: 2026-11-09
author: The Inkwall team
---

Inkwall v0.5.0 is out. It makes what 0.4.0 shipped easier to tune, to watch and to run at scale:
the Core Rule Set's settings and narrower exclusions on the policy, IP lists, responses through
Istio, an opt-in automatic engine rollout, and a cluster that says what it is doing. Upgrade from
0.4.x after reading [what needs action](#what-needs-action-on-upgrade):

```sh
helm upgrade inkwall oci://ghcr.io/inkwall-dev/charts/inkwall --version 0.5.0 \
  --namespace inkwall-system --reset-then-reuse-values --dry-run
helm upgrade inkwall oci://ghcr.io/inkwall-dev/charts/inkwall --version 0.5.0 \
  --namespace inkwall-system --reset-then-reuse-values
kubectl -n inkwall-system rollout status deployment/inkwall-operator
kubectl -n <traefik namespace> rollout restart deployment/<traefik>
```

## Tuning on the policy

- **The Core Rule Set's own settings.** A policy's CRS binding takes `crs`: `allowedMethods`, for
  REST APIs that send `PUT`, `PATCH` or `DELETE`, which the CRS denies by default;
  `allowedRequestContentTypes`; `detectionParanoiaLevel`, which logs a higher level's rules without
  blocking on them; and `outboundAnomalyThreshold`. `inkwallctl migrate ingress-nginx` maps the
  matching `tx.*` settings to them.
- **Exclusions for a cookie, a header or an argument name**: `when: {cookie: session}`, `header` or
  `argumentName`, beside `argument`, for false positives on a session cookie, a `Referer` or a JSON
  header.
- **IP allow and deny lists.** A `WAFIPList` lists client addresses, and `spec.ipLists` names
  them: a denied client gets 403 before any rule, an allowed one isn't inspected. They match the
  client IP the engine resolves, and behind an AWS ALB or another HTTP load balancer, the
  `InkwallConfig` now says which `X-Forwarded-For` entries to trust (`trustedProxies`,
  `trustedHops`).
- **`inkwallctl tune`** reads detect mode's security events and suggests the narrowest exclusions,
  and **`inkwallctl test --suite`** runs a file of cases, each a request and optionally its
  response, with the verdict expected, and writes JUnit for CI.

See [Policies](/docs/policies/) and [Testing rules](/docs/testing-rules/).

## Responses through Istio

A policy with `responses.inspect` now has the responses of its Istio HTTPRoutes and VirtualServices
inspected, as through Envoy Gateway; in 0.4.0 they were `ResponsesNotInspected`. In `Detect` mode,
a request the rules flag is let through and its response is inspected too, so an SQL error or a
leak in the answer to a probe is its own event. And Istio routes are proven before they are
`Programmed`: the operator sends its signed probe through every gateway pod, on every listener a
protected route is served on, as it does for HAProxy. See [Proxies](/docs/proxies/).

## Rolling out new engines

Proxy pods that run an old engine wait for a restart (`PendingRestart`). With
`InkwallConfig.spec.engine.rollout: Automatic`, the operator restarts the Traefik, HAProxy and
Istio ingress gateway pods it injects itself: one at a time, through the Eviction API, so
PodDisruptionBudgets hold, waiting for each replacement to be ready with the new engine. A refused
eviction or a replacement not ready in 5 minutes pauses it, and the `EngineRollout` condition says
why. `Manual` stays the default. See [Operations](/docs/operations/).

## Seeing what happens

- **`inkwallctl status`** checks the whole cluster: the proxies, the policies that aren't `Ready`,
  the engines and their versions, with what to do. `kubectl get wafpolicies` has a `REASON` column,
  and the `InkwallConfig` reports the bundle, the engines and the signing key's rotation.
- **Where a rule matched**: security events and `inkwallctl test` say `rule@variable`
  (`942100@ARGS:q`), never the value, and the anomaly score.
- **Metrics, alerts and a dashboard**: rule matches, adapter errors, bundle age and compile time,
  WebSockets, and policies by condition and reason; the chart ships a ServiceMonitor, a PodMonitor,
  alerts with runbooks and a Grafana dashboard, off by default.
- **Health checks for Argo CD and Flux**, so a sync waits for a policy to be `Ready`.
- **One denial response everywhere**: every denial carries `X-Request-Id`, the ID of its security
  event, and `jsonDenials` answers JSON clients with a JSON body.
- **Fewer secrets in events**: an engine no longer sends what a rule matched in an argument or
  header whose name looks like a credential, and `InkwallConfig.spec.events.redact` redacts more.

See [Monitoring](/docs/monitoring/).

## gRPC and the standalone proxy

`body.grpc: Deny` refuses gRPC and gRPC-Web on routes that serve none, before any rule.
`inkwall-engine proxy` now speaks gRPC: HTTP/2 from clients with `--h2c` or over TLS, and to an
HTTP/2 upstream. It reloads its rules on `SIGHUP` or with `--watch-rules`, keeping the old ones if
the new ones don't compile; it has limits for long-lived connections; and it scores each WebSocket
message on its own, with fewer false positives and about a third less work per message. See
[gRPC](/docs/grpc/).

## Less memory, more scale

The Core Rule Set is now compiled once for every paranoia level, anomaly threshold and body limit:
about 2.1 MiB and 10 to 30 ms less for each combination that compiled its own. The operator's
scale test now measures the wiring controller: at 5,000 Istio VirtualServices, which didn't fit
before, every policy was wired in 22 s, and the operator peaked at 449 MiB. `Enforced` counts only
the engines that serve a policy, so an engine of another proxy no longer holds it back. See
[How it works](/docs/how-it-works/).

## Tested harder

The OWASP CRS regression suite now runs through every adapter, response rules included, beside an
adapter parity test, upgrades from each supported release through more than Traefik, and the
end-to-end tests for WebSocket and gRPC through Istio. Nightly runs qualify the release, stress it,
and break the operator on purpose. A tag without green CI is refused, what was published
is verified, and the binaries ship with SBOMs and build provenance.

## What needs action on upgrade

- **Try the upgrade with `--dry-run` first.** The chart checks its values against a schema and
  fails on a key it doesn't have or a wrong type, where 0.4.x ignored it.
- **Upgrade the chart before using the new fields**, which need the 0.5.0 CRDs. A policy that uses
  one is `Enforced=False` (`EnginesOutdated`) while an engine before 0.5.0 runs it: restart the
  proxy pods that run the engine (Traefik, the HAProxy controller, Istio's ingress gateways), or
  turn on the automatic rollout.
- **Istio policies are `Unverified` after the upgrade** until the probes answer, within seconds of
  the gateways running 0.5.0 engines. Routes whose policies are all in `Detect` mode stay
  `Unverified`, and routes the probe can't reach are `NotProbeable`, so they aren't `Ready`: alerts
  on `Ready` should expect it.
- **Security event log lines are rate-limited**, to 10 per second for each policy and rule. A
  pipeline that counts attacks from log lines should count from the metrics or the events.
- **Metrics change**: WebSocket messages move to `inkwall_websocket_messages_total`;
  `inkwall_requests_total` also counts requests no policy covers and those let through while
  suspended; `inkwall_policy_requests_total` is opt-in.
- **Text output changes**: `inkwallctl test` adds `matches=` and `score=`, and `kubectl get
  wafpolicies` adds `REASON`. Scripts that parse by position should use JSON or custom columns.
- **The operator's ClusterRole** gains `events` and `pods/eviction`.

The [upgrade guide](/docs/upgrading/) has the rest.

## What's next

v0.6.0 brings assistants: `inkwallctl explain`, for a denied request or a policy that isn't
`Ready`, and an MCP server with read-only tools. It also takes responses through HAProxy, Traefik
and the reverse proxy, and gRPC streams inspected per message. v1.0.0 takes the CRDs out of
`v1alpha1`. See the [roadmap](/docs/roadmap/).
