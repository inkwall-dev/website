---
title: Upgrading
description: Upgrade from 0.5.x to 0.6.0, from 0.5.3 to 0.5.4, from 0.5.1 to 0.5.2, from 0.5.0 to 0.5.1, from 0.4.x to 0.5.0, from 0.4.2 to 0.4.3, from 0.4.1 to 0.4.2, from 0.4.0 to 0.4.1, from 0.3.3 to 0.3.4, from 0.3.2 to 0.3.3, from 0.2.2 to 0.2.3, from 0.3.x to 0.4.0, from 0.3.1 to 0.3.2, from 0.3.0 to 0.3.1, and from 0.2.x to 0.3.0, what to check first, what changes by itself, protecting HTTPRoutes, and how to roll back.
order: 2
---

The latest release is **0.6.0**, and the latest patch releases of the older lines are **0.5.4**
and **0.4.3**, with the same security fixes. From any 0.5 release, upgrade straight to 0.6.0 as
[below](#from-05x-to-060), or to 0.5.4 to stay on 0.5, as in
[From 0.5.3 to 0.5.4](#from-053-to-054). From any 0.4 release, upgrade to 0.5.4 first, with
`--version 0.5.4` in the commands of [From 0.4.x to 0.5.0](#from-04x-to-050), and read the 0.5
sections; to stay on 0.4, upgrade to 0.4.3, as in [From 0.4.2 to 0.4.3](#from-042-to-043).
0.6, 0.5 and 0.4 get fixes. 0.3 left support with 0.6.0 and is not patched for the advisories
fixed in 0.6.0, 0.5.4 and 0.4.3: from any 0.3 release, upgrade to 0.4.3 first, with
`--version 0.4.3` in the commands of [From 0.3.x to 0.4.0](#from-03x-to-040), read both sections,
then upgrade onward.
From any 0.2 release, upgrade to 0.3.0 first, as in
[From 0.2.x to 0.3.0](#from-02x-to-030); to stay on 0.2, upgrade to 0.2.3, a security patch
release, as in [From 0.2.2 to 0.2.3](#from-022-to-023). From 0.1.x, upgrade to 0.2.3 first, then
to 0.3.0. The
full guide is
[`docs/upgrading.md`](https://github.com/inkwall-dev/inkwall/blob/v0.6.0/docs/upgrading.md).

## From 0.5.x to 0.6.0

Upgrade the chart, which upgrades the CRDs too, try it with `--dry-run` first, then restart the
proxies whose pods run the engine so they run the 0.6.0 engine (Envoy Gateway and Istio roll their
Gateways' pods themselves; with `InkwallConfig.spec.engine.rollout: Automatic` the operator
restarts the pods it injects for you):

```sh
helm upgrade inkwall oci://ghcr.io/inkwall-dev/charts/inkwall --version 0.6.0 \
  --namespace inkwall-system --reset-then-reuse-values --dry-run
helm upgrade inkwall oci://ghcr.io/inkwall-dev/charts/inkwall --version 0.6.0 \
  --namespace inkwall-system --reset-then-reuse-values
kubectl -n inkwall-system rollout status deployment/inkwall-operator
kubectl -n <traefik namespace> rollout restart deployment/<traefik>
```

Restart the HAProxy controller and Istio's ingress gateways the same way. Until a pod runs the
0.6.0 engine, a policy that uses a 0.6.0 field is `Enforced=False` (`EnginesOutdated`). If you
install the CRDs yourself, apply 0.6.0's first, as in [From 0.4.x to 0.5.0](#from-04x-to-050)
with `--version 0.6.0`.

**With Traefik, upgrade Traefik and its CRDs together to v3.7 or later** to get its faster
Middleware ([below](#what-changes-by-itself-in-060)); before v3.7 nothing changes for Traefik.

### What's new in 0.6.0

Nothing below changes a policy you have: the new fields, flags and chart values are off unless you
set them.

- **Responses through HAProxy.** A policy with `responses.inspect` has the responses of its HAProxy
  Kubernetes Ingress Controller Ingresses inspected, as through Envoy Gateway and Istio: the
  operator injects the engine with `--response-messages` and adds the response rules to each
  Ingress's backend snippet. Restart the controller's pods after the upgrade: until every pod runs
  an engine injected by 0.6.0, such a policy stays `Programmed=False` (`ResponsesNotInspected`),
  naming the pods. A pinned `spec.engine.image` must be 0.6.0 or later. With HAProxy configured by
  hand, `inkwall-engine spoe --inspect-responses` and the new lines of `examples/haproxy/spoe.conf`
  and `haproxy.cfg`
  ([responses](https://github.com/inkwall-dev/inkwall/blob/v0.6.0/docs/haproxy.md#responses)).
- **The standalone proxy inspects responses**: `inkwall-engine proxy --inspect-responses`, with at
  most `--max-held-response-bytes` (64 MiB) of bodies held at once
  ([responses](https://github.com/inkwall-dev/inkwall/blob/v0.6.0/docs/standalone-proxy.md#responses)).
- **Streamed responses, event by event**: `responses: {inspect: true, streams: Inspect}` inspects
  each Server-Sent Event and each message of a gRPC response on its own, through Envoy Gateway and
  Istio (`--response-streams inspect` for raw Envoy and the standalone proxy); in `Block` mode a
  leaking event ends the stream. HAProxy doesn't send a streamed body, so such a policy is
  `ResponsesNotInspected` on its Ingresses.
- **gRPC streams, one message at a time**: with `body.grpcMessages: Inspect`,
  `body.grpcStreams: PerMessage` inspects each message as it arrives, through Envoy Gateway, Istio
  and raw Envoy, so long client streams and bidirectional calls work in `Block` mode. The messages
  before a denied one have already reached the application, which is why it is off by default.
  With streamed responses inspected, a gRPC server's messages and its status message are inspected
  too ([gRPC](/docs/grpc/)).
- **Rule sets before the CRS**: `placement: BeforeCRS` on a rule set binding loads it before the
  CRS's initialization, so its `setvar:tx.…` and `ctl:ruleRemoveById` rules change what the CRS
  does. It can't use `SecRuleRemoveBy*` or `SecRuleUpdate*` ([Policies](/docs/policies/)).
- **`inkwallctl explain`** says why a policy isn't `Ready` and why a request was denied, and
  **`inkwallctl mcp`** serves those answers to an AI assistant, read-only
  ([Monitoring](/docs/monitoring/)). `explain request` reads the engines' logs: it needs `get` on
  `pods/log`.
- **The operator's metrics over HTTPS**: `metrics.secure.enabled=true` serves `/metrics` only to
  tokens the API server allows to get it. Bind the new `inkwall-operator-metrics-reader`
  ClusterRole to Prometheus' service account first. Off by default, also with `--reuse-values`
  ([Monitoring](/docs/monitoring/#metrics-over-https)).
- **`WAFIPList` in Managed mode**: a control plane can deliver the IP lists its policies name, and
  sees every `WAFIPList` in the cluster state ([Control plane](/docs/control-plane/)).

### What changes by itself in 0.6.0

- **Traefik adds about 1.3 ms instead of 8 ms.** Traefik's ForwardAuth allocated its
  `maxBodySize` (10 MiB) for every request, body or not. On Traefik v3.7 and later, the operator's
  `inkwall-waf` Middleware becomes a `chain` of two new ones in the same namespace:
  `inkwall-waf-body`, a Buffering Middleware that bounds request bodies (10 MiB + 1, in memory;
  responses aren't buffered), then `inkwall-waf-auth`, the ForwardAuth, with no body limit of its
  own. Routes keep referring to `inkwall-waf`, the engine inspects the same requests, and the
  operator rewrites the Middlewares on its first reconcile, with no restart of Traefik. **A body
  over 10 MiB + 1 now gets 413 from Traefik instead of 401**, and a chunked request body reaches
  the application with a `Content-Length`. A Middleware named `inkwall-waf-body` or
  `inkwall-waf-auth` that the operator didn't create stops the wiring in its namespace
  (`WiringFailed`): rename it. Before Traefik v3.7 (by its CRD or its image tag), the Middleware
  stays as it was.
- **`Enforced` waits for every serving pod's engine.** A running proxy pod that serves a policy
  but whose engine isn't connected to the operator (starting or reconnecting) now makes the policy
  `Enforced=False` (`EnginesBehind`) until its engine connects and runs the bundle. Expect a few
  seconds of `EnginesBehind` after a proxy pod starts.
- **The probe proves responses, and reaches your app.** For a policy with `responses.inspect`, the
  operator's probe also proves that the route's responses reach the engine, through every Istio
  gateway pod and every HAProxy controller pod: a `GET` (or `HEAD`) with
  `User-Agent: inkwall-operator-probe` on the reserved path
  `.well-known/inkwall-probe/<nonce>?inkwall-probe-leg=response`, per pod and listener every
  5 minutes, **in `Block` mode too**. Your app can answer 404: the engine replaces its answer.
  Until the probe has passed, the policy is `Unverified`; where a pod's engine doesn't see the
  responses, `ResponsesNotInspected`, naming the pod.
- **`Detect`-mode Istio routes become `Programmed`**: the engine keeps a receipt of each probe it
  verified, and the operator proves the route by it. Pods with an engine older than 0.6.0 report
  no receipts, so their routes stay `Unverified` until restarted. In `Detect` mode the probe now
  reaches your app (a `GET` on `.well-known/inkwall-probe/<nonce>`), and a rule matching only a
  method other than `GET` or `HEAD` is `NotProbeable` there.
- **HAProxy: a request or a response too large for one SPOE frame is handled as oversized**: 413
  for such a request and 502 for such a response, for `Block`-mode policies, as `body.onOversize`
  and `responses.onOversize` say. By hand, copy the two rules on `txn.inkwall.error` from
  `examples/haproxy/haproxy.cfg`.
- **In Managed mode, a `WAFIPList` labelled `inkwall.dev/source: saas` is the control plane's**:
  the webhook refuses deleting it, and the next snapshot that doesn't carry it deletes it. One you
  labelled yourself is pruned: find them with
  `kubectl get wafiplist -A -l inkwall.dev/source=saas` and remove the label first.
- **`GOMEMLIMIT` from the container's cgroup**: the engine and the operator set it to 90% of the
  cgroup's memory limit when `MEMORY_LIMIT` isn't set, so a standalone engine in
  `docker run --memory 256m` gets one too. `MEMORY_LIMIT`, and `GOMEMLIMIT` set by hand, still
  win.
- **A pinned older engine starts.** The operator reads the engine's release from
  `spec.engine.image`'s tag and leaves out the flags it doesn't know, instead of injecting them and
  leaving the pod crash-looping; an image whose tag isn't a release gets only the flags every
  release knows. The new `EngineConfigured` condition on the `InkwallConfig`, and a Warning Event,
  name the settings left out. Pin a custom build with its version in the tag
  (`:0.6.0@sha256:...`).

The security fixes of 0.6.0, also in 0.5.4 and 0.4.3, change these:

- **A request whose path a proxy may route differently is inspected by every policy it could
  select.** A path with dot segments (`/a/../b`), encoded characters (`%2F`, `%2e`) or repeated
  slashes can match one route as received and another once decoded; when those forms select
  different policies, each inspects the request and the strictest verdict wins. Plain paths don't
  change
  ([GHSA-c52q-5h8m-279w](https://github.com/inkwall-dev/inkwall/security/advisories/GHSA-c52q-5h8m-279w)).
- **Policies of different namespaces on a shared proxy fleet**
  ([GHSA-r2m3-77h9-hq8v](https://github.com/inkwall-dev/inkwall/security/advisories/GHSA-r2m3-77h9-hq8v)):
  - A policy applies to an HTTPRoute only once a Gateway accepts it (a parent in
    `status.parents` with `Accepted=True`); until then it is `Accepted=False`
    (`TargetNotAttached`). Envoy Gateway and Istio Gateways are wired only for the routes they
    accept; until then the policy is `Programmed=False` (`Pending`).
  - Where the engine can't tell which of two namespaces' overlapping routes the proxy used, the
    overlap goes to the stricter policy, or else the older one, no longer the more specific
    target; both policies say so (`RouteOverlap`).
  - A policy whose rule sets don't compile together is left out (`Accepted=False`,
    `RuleSetsIncompatible`), or keeps its previous version, instead of breaking the bundle for
    every engine.
  - Each engine is recorded under the pod its token is bound to, so engines that report the same
    ID no longer share one record in `inkwallctl status` or `Enforced`.

  After the upgrade, run `kubectl get wafpolicy -A` and look for policies that are now
  `Accepted=False`.
- **The standalone proxy and HAProxy forward only WebSocket upgrades.** Any other `Upgrade`
  (`h2c`, `websocket, h2c`, `TLS/1.2`, ...) is removed with `HTTP2-Settings`, and the request
  reaches the upstream as plain HTTP/1.1; a client that offers `h2c` gets HTTP/1.1
  ([GHSA-9rmr-w4mp-34f3](https://github.com/inkwall-dev/inkwall/security/advisories/GHSA-9rmr-w4mp-34f3)).
  The operator rewrites the HAProxy Ingresses' snippets on its first reconcile. With HAProxy
  configured by hand, add the two rules after the engine's verdict
  ([WebSocket](https://github.com/inkwall-dev/inkwall/blob/v0.6.0/docs/haproxy.md#websocket)):

  ```haproxy
  http-request del-header upgrade unless { req.fhdr_cnt(upgrade) eq 1 } { req.fhdr(upgrade) -m str -i websocket }
  http-request del-header http2-settings
  ```
- **Response bodies are read in more media types, and whole.** With `responses.inspect`, bodies
  of `text/csv`, JavaScript, `application/xhtml+xml`, any `+json` or `+xml` type, a malformed
  media type, or no type at all are inspected too. On those routes the engine removes the
  request's `Range` and `If-Range`, so clients get `200` with the whole body instead of `206`; a
  partial body the app sends anyway, or one with several `Content-Encoding` values, counts as
  uninspected and gets `responses.onOversize`
  ([GHSA-6vg9-25gh-3327](https://github.com/inkwall-dev/inkwall/security/advisories/GHSA-6vg9-25gh-3327)).
  With HAProxy configured by hand and responses inspected, copy the new `del-header range`,
  `del-header if-range` and `wait-for-body` lines of `examples/haproxy/haproxy.cfg`, and
  `whole=var(txn.inkwall.response_whole)` in `spoe.conf`'s `inkwall-response` message.
- **gRPC messages: every text field is read** (`body.grpcMessages: Inspect`). A field with a
  control or invisible character is now inspected, the character read as a space, and a binary
  field gives its runs of readable characters. If a policy's events show a new false positive,
  exclude that field (`when: {argument: "3"}`). A match on XML text, a gRPC field or a WebSocket
  message leaves no snippet in security events
  ([GHSA-m6qq-cj2f-9h75](https://github.com/inkwall-dev/inkwall/security/advisories/GHSA-m6qq-cj2f-9h75)).
- **`inkwallctl migrate ingress-nginx` leaves chained `ctl` rules out** as `TODO`, instead of
  turning them into exclusions or `skip.paths` entries for every request: run the migration again
  and convert those chains by hand. With `-f`, an object whose name isn't a valid Kubernetes name
  is refused, and `--output` writes only inside its directory
  ([GHSA-pjxq-6323-wcr3](https://github.com/inkwall-dev/inkwall/security/advisories/GHSA-pjxq-6323-wcr3)).

### Rolling back to 0.5.x

After a rollback to 0.5.x, the older operator rewrites Traefik's `inkwall-waf` to its single
ForwardAuth in place, and leaves `inkwall-waf-body` and `inkwall-waf-auth` unused until 0.6.0 takes
them back. To remove them:

```sh
kubectl delete middlewares.traefik.io -A -l app.kubernetes.io/managed-by=inkwall-operator \
  --field-selector metadata.name=inkwall-waf-body
kubectl delete middlewares.traefik.io -A -l app.kubernetes.io/managed-by=inkwall-operator \
  --field-selector metadata.name=inkwall-waf-auth
```

## From 0.5.3 to 0.5.4

0.5.4 is a patch release with security fixes and no API change: upgrade the chart as for 0.5.3,
then restart the proxies whose pods run the engine (Traefik, Istio's ingress gateways and HAProxy;
Istio rolls its Gateway API gateways and Envoy Gateway re-creates its own) so their engines are
0.5.4, or let `spec.engine.rollout: Automatic` do it. Run the 0.5.4 image or binary of the
standalone proxy and `inkwallctl`:

```sh
helm upgrade inkwall oci://ghcr.io/inkwall-dev/charts/inkwall --version 0.5.4 \
  --namespace inkwall-system --reset-then-reuse-values
kubectl -n inkwall-system rollout status deployment/inkwall-operator
kubectl -n <traefik namespace> rollout restart deployment/<traefik>
kubectl get wafpolicy -A
```

What changes by itself is the security part of
[What changes by itself in 0.6.0](#what-changes-by-itself-in-060), without the lines for HAProxy's
responses, which 0.5 doesn't inspect through HAProxy: the six advisories,
[GHSA-c52q-5h8m-279w](https://github.com/inkwall-dev/inkwall/security/advisories/GHSA-c52q-5h8m-279w),
[GHSA-r2m3-77h9-hq8v](https://github.com/inkwall-dev/inkwall/security/advisories/GHSA-r2m3-77h9-hq8v),
[GHSA-9rmr-w4mp-34f3](https://github.com/inkwall-dev/inkwall/security/advisories/GHSA-9rmr-w4mp-34f3),
[GHSA-6vg9-25gh-3327](https://github.com/inkwall-dev/inkwall/security/advisories/GHSA-6vg9-25gh-3327),
[GHSA-m6qq-cj2f-9h75](https://github.com/inkwall-dev/inkwall/security/advisories/GHSA-m6qq-cj2f-9h75)
and [GHSA-pjxq-6323-wcr3](https://github.com/inkwall-dev/inkwall/security/advisories/GHSA-pjxq-6323-wcr3).
In short:

- A policy on an HTTPRoute that no Gateway accepts, or overlapping another namespace's route, is
  now `Accepted=False` (`TargetNotAttached`, `RouteOverlap`): check `kubectl get wafpolicy -A`
  after the upgrade.
- The standalone proxy and the operator's HAProxy snippets forward only WebSocket upgrades. With
  HAProxy configured by hand, add the two rules of
  [What changes by itself in 0.6.0](#what-changes-by-itself-in-060) after the engine's verdict.
- With `responses.inspect`, more media types are read, `Range` and `If-Range` are removed, and a
  partial body counts as uninspected.
- gRPC message fields with control characters are inspected, and matches on XML text, gRPC fields
  and WebSocket messages leave no snippet in security events.
- `inkwallctl migrate ingress-nginx` leaves chained `ctl` rules out as `TODO`: run it again and
  convert them by hand.

## From 0.5.1 to 0.5.2

0.5.2 is a patch release with one security fix and no API change: upgrade the chart as for 0.5.1.
The operator updates the HAProxy Ingresses' snippets by itself, so nothing needs a restart for this
fix:

```sh
helm upgrade inkwall oci://ghcr.io/inkwall-dev/charts/inkwall --version 0.5.2 \
  --namespace inkwall-system --reset-then-reuse-values
kubectl -n inkwall-system rollout status deployment/inkwall-operator
```

What changes by itself:

- **Through HAProxy, a request too large for one SPOE frame is handled as oversized.** HAProxy
  sends each request to the engine in one frame, and a request that doesn't fit isn't sent at all.
  With `tune.bufsize` raised above the engine's frame size, such a request had no verdict, so a
  `Block`-mode policy with `failureMode: Open` let it through uninspected
  ([GHSA-4w3f-28c3-cc6g](https://github.com/inkwall-dev/inkwall/security/advisories/GHSA-4w3f-28c3-cc6g)).
  It is now handled as `body.onOversize` says: 413 for `Block`-mode policies, whatever the failure
  mode.

With HAProxy configured by hand, add the new rule of the example configuration before the
fail-closed rule, and leave it out in detect mode
([the complete haproxy.cfg](https://github.com/inkwall-dev/inkwall/blob/v0.6.0/docs/haproxy.md#the-complete-haproxycfg)):

```haproxy
http-request deny deny_status 413 if { var(txn.inkwall.error) -m int 3 259 }
```

## From 0.5.0 to 0.5.1

0.5.1 is a patch release with security fixes and no API or chart change: upgrade the chart as for
0.5.0, then restart the proxies whose pods run the engine (Traefik, Istio's ingress gateways and
HAProxy; Istio rolls its Gateway API gateways and Envoy Gateway re-creates its own) so their
engines are 0.5.1, or let `spec.engine.rollout: Automatic` do it:

```sh
helm upgrade inkwall oci://ghcr.io/inkwall-dev/charts/inkwall --version 0.5.1 \
  --namespace inkwall-system --reset-then-reuse-values
kubectl -n inkwall-system rollout status deployment/inkwall-operator
kubectl -n <traefik namespace> rollout restart deployment/<traefik>
```

What changes by itself:

- **Through Envoy, `Detect` mode inspects requests that carry the probe header.** In `Detect`
  mode Envoy ignores the engine's answer to the operator's probe and forwards the request, so a
  request carrying a valid probe header reached the application without being inspected or
  logged ([GHSA-839p-9ccr-29jj](https://github.com/inkwall-dev/inkwall/security/advisories/GHSA-839p-9ccr-29jj)).
  The engine now inspects and logs it like any other request, through Envoy Gateway, Istio and raw
  Envoy. `Block` mode is unchanged, and `Detect`-mode routes through Istio and Envoy Gateway stay
  `Unverified`, as in 0.5.0.
- **Built with Go 1.27.4**, for
  [GO-2026-6859](https://pkg.go.dev/vuln/GO-2026-6859): an HTTP/1 server using `net/http`'s
  `MaxBytesReader` could panic when its limit was exceeded while the handler wrote headers. The
  engine's and the operator's HTTP servers use it.

## From 0.4.x to 0.5.0

The chart now checks its values against a schema, so try the upgrade first: it fails on a key the
chart doesn't have or a wrong type, naming it, where 0.4.x ignored it. `--reuse-values` from 0.4.x
passes. Then upgrade the chart, with Helm 3 or 4, and restart the proxies whose pods run the
engine, so they run the 0.5.0 engine:

```sh
helm upgrade inkwall oci://ghcr.io/inkwall-dev/charts/inkwall --version 0.5.0 \
  --namespace inkwall-system --reset-then-reuse-values --dry-run
helm upgrade inkwall oci://ghcr.io/inkwall-dev/charts/inkwall --version 0.5.0 \
  --namespace inkwall-system --reset-then-reuse-values
kubectl -n inkwall-system rollout status deployment/inkwall-operator
kubectl -n <traefik namespace> rollout restart deployment/<traefik>
```

Restart the HAProxy controller and Istio's ingress gateways the same way; Envoy Gateway and Istio
roll their Gateways' pods themselves. With the new automatic rollout
([below](#whats-new-in-050)), the operator restarts the pods it injects for you. Until a pod runs
the 0.5.0 engine, a policy that uses a 0.5.0 field is `Enforced=False` (`EnginesOutdated`),
naming it.

The chart upgrades the CRDs too (`crds.install`), and the new fields need them: upgrade the chart
before you use them. If you install the CRDs yourself, apply 0.5.0's first:

```sh
helm template inkwall oci://ghcr.io/inkwall-dev/charts/inkwall --version 0.5.0 \
  --show-only templates/crds.yaml | kubectl apply --server-side -f -
```

### What's new in 0.5.0

Nothing below changes a policy you have: the new fields and settings are off unless you set them.

- **The Core Rule Set's own settings** on a policy's CRS binding, `crs`: `allowedMethods` (for
  REST APIs that send `PUT`, `PATCH` or `DELETE`), `allowedRequestContentTypes`,
  `detectionParanoiaLevel` and `outboundAnomalyThreshold`. See [Policies](/docs/policies/).
- **Exclusions for a cookie, a header or an argument name**: `when: {cookie: session}`, `header` or
  `argumentName`, beside `argument`.
- **IP allow and deny lists**: a new kind, `WAFIPList`, and `WAFPolicy.spec.ipLists`. They match
  the client IP the engine resolves: get that right first ([Client IP](/docs/client-ip/)).
- **`body.grpc: Deny`** refuses gRPC on routes that serve none ([gRPC](/docs/grpc/)).
- **Responses through Istio.** A policy with `responses.inspect` has the responses of its Istio
  HTTPRoutes and VirtualServices inspected, as through Envoy Gateway; they were
  `ResponsesNotInspected` in 0.4.x.
- **The client IP behind an HTTP load balancer**: `InkwallConfig.spec.engine.clientIP`
  (`trustedProxies`, `trustedHops`), for Envoy Gateway, Istio and HAProxy behind an AWS ALB or
  another load balancer that appends to `X-Forwarded-For` ([Client IP](/docs/client-ip/)).
- **Automatic engine rollout, opt-in**: with `InkwallConfig.spec.engine.rollout: Automatic`, the
  operator evicts the Traefik, HAProxy and Istio ingress gateway pods it injects that run an old
  engine, one at a time ([Operations](/docs/operations/)). The operator's ClusterRole gains
  `pods/eviction` for it.
- **`inkwallctl`**: `status` for the whole cluster ([Monitoring](/docs/monitoring/)), `tune` to
  suggest exclusions from detect mode's events, and `test --suite` with JUnit output
  ([Testing rules](/docs/testing-rules/)).
- **The standalone proxy**: gRPC and HTTP/2 (`--h2c`, `--tls-cert`/`--tls-key`, `--upstream-h2c`,
  `--upstream-ca`), its rules reloaded on `SIGHUP` or with `--watch-rules`, and limits for
  long-lived connections (`--websocket-idle-timeout`, `--max-connections`, `--body-read-timeout`).
- **The chart**: a monitoring kit (ServiceMonitor, PodMonitor, alerts and a Grafana dashboard),
  NetworkPolicies, private registries, image digests, extra env and volumes, and topology spread,
  all off by default.
- **Health checks for Argo CD and Flux** for the Inkwall kinds ([GitOps](/docs/gitops/)).
- **`InkwallConfig.spec.events.redact`** redacts more of the security events' snippets, or all of
  them, and `spec.engine.jsonDenials` answers JSON clients with a JSON body.

### What changes by itself in 0.5.0

- **Istio policies are `Unverified` after the upgrade** until the operator's probes have answered
  (seconds, once the gateways' engines are 0.5.0). Some stay out of `Programmed`, and so out of
  `Ready`: routes whose policies are all in `Detect` mode stay `Unverified`, and routes the probe
  can't reach are `NotProbeable` (every match a regular expression, mutual TLS or passthrough, or
  a match on header or query values over TLS, which the probe doesn't send). Alerts on `Ready`
  should expect it.
- **Security event log lines are rate-limited**: at most 10 per second for each policy and rule
  (the engine's `--event-log-rate`); the rest are counted in
  `inkwall_security_event_logs_suppressed_total`, and still go to the operator. A pipeline that
  counts attacks from log lines should count from the metrics or the events. Each line now says
  where rules matched (`matches`), never the value.
- **Fewer snippets in security events**: what a rule matched in an argument or header whose name
  looks like a credential is no longer sent.
- **Metrics**: WebSocket messages are counted in `inkwall_websocket_messages_total`, no longer in
  `inkwall_requests_total`; `inkwall_requests_total` now also counts the requests no policy covers
  (`no-policy`) and those let through while inspection is suspended (`suspended`), so its totals
  rise by them; `inkwall_policy_requests_total` is opt-in; `inkwall_operator_engines` has an
  `integration` label (sum over it for the old totals).
- **`Enforced` counts the engines that serve the policy**: an engine of another proxy that is
  behind, rejects a bundle or is too old no longer makes a policy `Enforced=False`. It also checks
  the newest field a policy sets, not only the first.
- **In `Detect` mode with `responses.inspect`**, the responses of flagged requests are inspected
  too, and the request's event may list a few more rules, since the rules run to the end.
- **Text output**: `inkwallctl test` adds `matches=` and `score=` after `interrupting=`, and
  `kubectl get wafpolicies` adds `REASON` before `BUNDLE`. Scripts that parse by position should
  use `--json`, `-o jsonpath` or `-o custom-columns`.
- **The `InkwallConfig` reports the cluster's state** (the bundle, the engines, the signing key),
  with the conditions `SigningKeyRotation` and `IntegrationsConfigured`, and the operator records
  an Event on a policy when `Ready`, `Programmed` or `Enforced` changes. Its ClusterRole gains
  `events` `create` and `patch`.
- **Istio ingress gateways**: the VirtualServices' filters move into the `EnvoyFilter` objects
  `inkwall-istio-ingress-00` to `-31`. GitOps tools that ignore the operator's objects by label
  need no change.
- **`X-Forwarded-For` entries with a port** are read as the address; before, such an entry ended
  the walk. A request body exactly `body.maxBytes` long is now inspected instead of denied with
  413.
- **The standalone proxy** closes WebSockets with `1001` on shutdown instead of dropping them, a
  body read that hits a deadline gets 408 instead of 400, its upstream connections are kept for
  reuse, and responses are flushed as they come. Each WebSocket message is scored on its own, not
  on top of the handshake's score.
- **ForwardAuth refuses an invalid `X-Forwarded-Host`** with 400, as the reverse proxy refuses such
  a Host. Traefik sends a Host it has already validated, so its requests aren't affected.
- **Less engine memory**: policies that differ only in their paranoia level, anomaly threshold or
  body limits share one compiled Core Rule Set.
- **Helm 4**: the chart keeps the operator's Pod webhook settings on upgrade. With Helm 4, roll
  back to 0.4.x with `helm rollback --force-conflicts`.

## From 0.4.2 to 0.4.3

0.4.3 is a patch release with the same security fixes as 0.5.4 and no API change: upgrade the
chart as for 0.4.2, then restart the pods that run the engine (Traefik, Istio's Gateways, HAProxy
and the Envoy Gateway proxies) so their engines are 0.4.3; 0.4 has no automatic rollout. Run the
0.4.3 image or binary of the standalone proxy and `inkwallctl`:

```sh
helm upgrade inkwall oci://ghcr.io/inkwall-dev/charts/inkwall --version 0.4.3 \
  --namespace inkwall-system --reset-then-reuse-values
kubectl -n inkwall-system rollout status deployment/inkwall-operator
kubectl -n <traefik namespace> rollout restart deployment/<traefik>
kubectl get wafpolicy -A
```

What changes by itself is as in [From 0.5.3 to 0.5.4](#from-053-to-054), without the part on
event snippets, which doesn't apply to 0.4. Check `kubectl get wafpolicy -A` for policies that are
now `Accepted=False`, add the two HAProxy rules to a configuration written by hand, and run
`inkwallctl migrate ingress-nginx` again. 0.4 is supported until 0.7.0.

## From 0.4.1 to 0.4.2

0.4.2 is a patch release with no API or chart change: upgrade the chart as for 0.4.1, then restart
the pods that run the engine (Traefik, Istio's Gateways, HAProxy and the Envoy Gateway proxies) so
their engines are 0.4.2:

```sh
helm upgrade inkwall oci://ghcr.io/inkwall-dev/charts/inkwall --version 0.4.2 \
  --namespace inkwall-system --reset-then-reuse-values
kubectl -n inkwall-system rollout status deployment/inkwall-operator
kubectl -n <traefik namespace> rollout restart deployment/<traefik>
```

What changes by itself:

- **Built with Go 1.27.4**, for
  [GO-2026-6859](https://pkg.go.dev/vuln/GO-2026-6859), as 0.5.1 is: an HTTP/1 server using
  `net/http`'s `MaxBytesReader` could panic when its limit was exceeded while the handler wrote
  headers. The engine's and the operator's HTTP servers use it.

0.4.x is not patched for
[GHSA-m382-qw6g-4qmj](https://github.com/inkwall-dev/inkwall/security/advisories/GHSA-m382-qw6g-4qmj)
(request values in the engine's parse-error log lines): upgrade to 0.5.3 or later, or apply its
workaround.

## From 0.4.0 to 0.4.1

0.4.1 is a patch release with security fixes: upgrade the chart as for 0.4.0, then restart the pods
that run the engine (Traefik, Istio's Gateways, HAProxy and the Envoy Gateway proxies) so their
engines are 0.4.1:

```sh
helm upgrade inkwall oci://ghcr.io/inkwall-dev/charts/inkwall --version 0.4.1 \
  --namespace inkwall-system --reset-then-reuse-values
kubectl -n inkwall-system rollout status deployment/inkwall-operator
kubectl -n <traefik namespace> rollout restart deployment/<traefik>
```

What changes by itself:

- **Rule sets can't use `@inspectFile` or `@rbl`.** These operators reach outside the engine (a
  program, a DNS query). The webhook and the operator reject rule sets that use them, and the
  engine never runs them. A rule set that already uses them keeps loading, but those rules never
  match, and editing it is rejected until they are removed. Look for them in your rule sets.
- **Path exclusions apply only to plain paths.** An exclusion with a `path` now applies only to a
  request path that is plain ASCII, without `%`, `;`, `\`, `//` or `.` and `..` segments, as skip
  paths already did. A request with any other path gets the policy's rules without that exclusion.
- **The response to an upgrade request is inspected unless it is a 101.** On a route whose policy
  inspects responses (Envoy Gateway, raw Envoy), an upstream that ignores `Upgrade` and answers
  with an ordinary response has that response inspected. WebSockets work as before.
- **The standalone proxy inspects the headers it forwards.** Headers that the `Connection` header
  names, which the proxy drops, are no longer inspected either.
- **The engine sets a Go memory limit.** It sets `GOMEMLIMIT` to 90% of its container's memory
  limit, as the operator does, unless `GOMEMLIMIT` is set. A request body over the inspected limit
  keeps only the inspected part in the engine's memory.

## From 0.3.3 to 0.3.4

0.3.4 is a patch release with no API or chart change: upgrade the chart as for 0.3.3, with
`--version 0.3.4`, then restart Traefik and the Envoy Gateway proxies so their engines are 0.3.4.
What changes by itself:

- **Built with Go 1.27.4**, for
  [GO-2026-6859](https://pkg.go.dev/vuln/GO-2026-6859), as 0.4.2 and 0.5.1 are: an HTTP/1 server
  using `net/http`'s `MaxBytesReader` could panic when its limit was exceeded while the handler
  wrote headers.

0.3.4 is the last 0.3 release: 0.3 left support with 0.6.0 (the newest three minor versions are
supported). 0.3.x is not patched for the advisories fixed in later releases, such as
[GHSA-m382-qw6g-4qmj](https://github.com/inkwall-dev/inkwall/security/advisories/GHSA-m382-qw6g-4qmj)
and the six fixed in 0.6.0, 0.5.4 and 0.4.3: upgrade to 0.4.3 or later.

## From 0.3.2 to 0.3.3

0.3.3 is a patch release with the same security fixes for 0.3, but the one for response inspection,
which 0.3 doesn't have: upgrade the chart as for 0.3.0, with `--version 0.3.3`, then restart Traefik
and the Envoy Gateway proxies so their engines are 0.3.3. What changes by itself is as in
[From 0.4.0 to 0.4.1](#from-040-to-041), without the item on upgrade requests.

## From 0.2.2 to 0.2.3

0.2.3 is a patch release with security fixes for 0.2: upgrade the chart as for 0.2.2, with
`--version 0.2.3`, then restart Traefik so its engine is 0.2.3:

```sh
helm upgrade inkwall oci://ghcr.io/inkwall-dev/charts/inkwall --version 0.2.3 \
  --namespace inkwall-system --reset-then-reuse-values
kubectl -n inkwall-system rollout status deployment/inkwall-operator
kubectl -n <traefik namespace> rollout restart deployment/<traefik>
```

What changes by itself:

- **Rule sets can't use `@inspectFile` or `@rbl`.** These operators reach outside the engine (a
  program, a DNS query). The webhook and the operator reject rule sets that use them, and the
  engine never runs them. A rule set that already uses them keeps loading, but those rules never
  match, and editing it is rejected until they are removed. Look for them in your rule sets.
- **Path exclusions apply only to plain paths.** An exclusion with a `path` now applies only to a
  request path that is plain ASCII, without `%`, `;`, `\`, `//` or `.` and `..` segments, as skip
  paths already did. A request with any other path gets the policy's rules without that exclusion.

The 0.2 line's full guide is
[`docs/upgrading.md` at v0.2.3](https://github.com/inkwall-dev/inkwall/blob/v0.2.3/docs/upgrading.md).

## From 0.3.x to 0.4.0

Upgrade the chart, with the values you installed it with, then restart the proxies whose pods
start with the engine, so they run the 0.4.0 engine:

```sh
helm upgrade inkwall oci://ghcr.io/inkwall-dev/charts/inkwall --version 0.4.0 \
  --namespace inkwall-system --reset-then-reuse-values
kubectl -n inkwall-system rollout status deployment/inkwall-operator
kubectl -n <traefik namespace> rollout restart deployment/<traefik>
```

The chart upgrades the CRDs too (`crds.install`). If you install the CRDs yourself, apply 0.4.0's
first:

```sh
helm template inkwall oci://ghcr.io/inkwall-dev/charts/inkwall --version 0.4.0 \
  --show-only templates/crds.yaml | kubectl apply --server-side -f -
```

Envoy Gateway's Envoy pods get the 0.4.0 engine as the operator updates them. Pods of Istio's
ingress gateways and of the HAProxy Kubernetes Ingress Controller that ran before the upgrade get
the engine only when restarted.

### What's new in 0.4.0

Nothing below changes a policy you have: the new fields are off unless you set them.

- **Istio** (1.28 or later): the `HTTPRoute` routes of its Gateways, and `VirtualService` targets
  (`group: networking.istio.io`) served by its ingress gateways. See [Proxies](/docs/proxies/).
- **The HAProxy Kubernetes Ingress Controller** (3.1 or later) is wired by the operator; an HAProxy
  you configure yourself can call `inkwall-engine spoe`, and an Envoy you configure yourself
  `inkwall-engine ext-proc`.
- **`WAFPolicy` fields:** `responses` (inspect the app's responses, through Envoy Gateway),
  `body.grpcMessages: Inspect` (the text in gRPC messages) and `webSocket` (allowed origins and
  required headers for WebSocket handshakes). See [Policies](/docs/policies/) and
  [gRPC](/docs/grpc/). A policy that sets one isn't `Enforced` (`EnginesOutdated`) while an engine
  before 0.4.0 runs it.
- **WebSocket messages, through the engine's reverse proxy**, with `--websocket-messages inspect`.
- **New chart values**, each granting a `ClusterRole`, `true` by default (also with
  `--reuse-values`): `rbac.integrations.istio` (`inkwall-operator-istio`: `EnvoyFilter` objects,
  ConfigMaps, Gateways), `rbac.integrations.istioIngress` (`inkwall-operator-istio-ingress`: reads
  VirtualServices and Istio's Gateways, writes `EnvoyFilter` objects) and
  `rbac.integrations.haproxy` (`inkwall-operator-haproxy`: the backend snippet annotations of the
  controller's Ingresses). `auto` grants one only when the cluster serves that proxy's API, `false`
  never; without its role, the operator disables that integration (`IntegrationDisabled`).

### What changes by itself in 0.4.0

- **Three more default proxy namespaces:** `istio-ingress`, `istio-system` and
  `haproxy-controller`. If you set `injection.proxyNamespaces`, your value is kept: add your Istio
  Gateways' and the HAProxy controller's namespaces to it. Changing the value restarts the
  operator.
- **New Pod webhooks.** Pods labelled `istio: ingressgateway` in the proxy namespaces get the engine
  when they are created, as Traefik's do; while a policy is in `Block` mode, they can't start while
  the operator is down. Set `rbac.integrations.istioIngress=false` to leave them alone. The HAProxy
  controller's pods get the engine from a webhook of their own. A cluster without these proxies is
  unaffected.
- **A denied gRPC call is answered as gRPC:** `grpc-status` 7 and a `grpc-message` naming the
  request ID. Through Envoy Gateway, raw Envoy and the engine's reverse proxy the HTTP status is
  200, as for any gRPC error, so Envoy's access log shows 200 for these denials; through Traefik it
  stays 403. Update dashboards or alerts that count denied gRPC calls by HTTP 403.
- **gRPC-Web text calls pass when clean.** In 0.3.x the Core Rule Set denied every one in `Block`
  mode (rule 920420), and logged it in `Detect` mode.
- **Bundles carry a probe key:** the first bundle after the upgrade is a new version with the same
  policies. Engines before 0.4.0 ignore the key.
- **New reasons to account for:** `Enforced` can be `EnginesOutdated`, `Programmed` can be
  `ResponsesNotInspected` or `Unverified`, and security events and `inkwall_requests_total` have a
  new reason, `websocket`; security events have a `phase` field (`request` or `response`). Update
  alerts or scripts that match on these.

## From 0.3.1 to 0.3.2

0.3.2 is a patch release: upgrade the chart as for 0.3.0, with `--version 0.3.2`, and restart the
Envoy Gateway proxies (its Envoy Deployments, in Envoy Gateway's namespace) so their pods run the
0.3.2 engine:

```sh
helm upgrade inkwall oci://ghcr.io/inkwall-dev/charts/inkwall --version 0.3.2 \
  --namespace inkwall-system --reset-then-reuse-values
kubectl -n inkwall-system rollout status deployment/inkwall-operator
kubectl -n <envoy gateway namespace> rollout restart deployment -l app.kubernetes.io/name=envoy,app.kubernetes.io/managed-by=envoy-gateway
```

What changes by itself:

- **WebSockets work through Envoy Gateway.** The engine decides a WebSocket handshake on its
  headers, and lets Envoy pass the upgraded connection without sending it to the engine. In 0.3.0
  and 0.3.1, a policy in `Block` mode with body inspection held every handshake until one of
  Envoy's timeouts, and one in `Detect` mode logged every handshake as an oversized body when the
  connection closed. It failed closed: nothing got through uninspected. The handshake's URL and
  headers are inspected as any request's, and a denied one gets 403 and no upgrade; the messages
  after the upgrade are not inspected. Traefik was not affected.

## From 0.3.0 to 0.3.1

0.3.1 is a patch release: upgrade the chart as for 0.3.0, with `--version 0.3.1`, and restart
Traefik so its pods run the 0.3.1 engine:

```sh
helm upgrade inkwall oci://ghcr.io/inkwall-dev/charts/inkwall --version 0.3.1 \
  --namespace inkwall-system --reset-then-reuse-values
kubectl -n inkwall-system rollout status deployment/inkwall-operator
kubectl -n <traefik namespace> rollout restart deployment/<traefik>
```

What changes by itself:

- **gRPC calls are no longer denied.** In 0.3.0 the Core Rule Set denied every gRPC call in `Block`
  mode and logged it in `Detect` mode. Now a gRPC call is inspected on its path, query and headers,
  but not its messages; see [gRPC](/docs/grpc/).
- **A suspended cluster is reported on every policy.** While `InkwallConfig.spec.suspend` is
  `true`, every `WAFPolicy` is `Enforced=False` and `Ready=False`, reason `Suspended`; in 0.3.0
  they could stay `Ready=True` while nothing was inspected. The `InkwallConfig` has a new
  `Suspended` condition.
- **A policy left out of a bundle too large to publish says so.** When the bundle doesn't fit its
  Secrets (over 7,200 KiB compressed), the policies it would add or change are `Accepted=False` and
  `Ready=False`, reason `BundleTooLarge`, until it fits. In 0.3.0 they kept the conditions of their
  previous spec, `Accepted=True` included, while engines ran that previous spec.
- **Suspending works when the bundle is too large.** In 0.3.0, `spec.suspend` did nothing while
  the bundle was too large to publish; now the bundle the engines run is published again,
  suspended.
- **Envoy Gateway routes aren't reported `Programmed`** while the operator can't raise Envoy's
  buffer limit for them.
- **`helm uninstall` leaves nothing behind**: it also deletes the operator's `inkwall-trust`
  ConfigMaps, the engine reports, the `inkwall-bundle-reader` Role and RoleBinding, and the leader
  Lease. See [Operations](/docs/operations/).

## From 0.2.x to 0.3.0

0.3.0 includes every security fix since 0.2.0:
[GHSA-r78f-635q-r8w2](https://github.com/inkwall-dev/inkwall/security/advisories/GHSA-r78f-635q-r8w2)
(fixed in 0.2.1 and 0.1.4) and
[GHSA-r5cq-6vq5-q8qg](https://github.com/inkwall-dev/inkwall/security/advisories/GHSA-r5cq-6vq5-q8qg)
(fixed in 0.2.2 and 0.1.5). You need the values you installed the chart with, and Helm 3.14 or later
for `--reset-then-reuse-values`.

### Before you upgrade

- **Check the policies that target an `HTTPRoute`.** 0.2.x accepted such targets but never
  enforced them: those policies were `Accepted=False` (`TargetUnsupported`). From 0.3.0, every
  `HTTPRoute` they target that Traefik or Envoy Gateway serves is wired and inspected, in the
  policy's mode. List them, and set `mode: Detect` on any you aren't sure of:

  ```sh
  kubectl get wafpolicy -A -o json |
    jq -r '.items[] | select(any(.spec.targetRefs[]; .kind == "HTTPRoute")) | "\(.metadata.namespace)/\(.metadata.name) \(.spec.mode // "Detect")"'
  ```

- **List your proxy's namespace, if it isn't a default one.** From 0.2.0 or 0.2.1, the upgrade adds
  `injection.proxyNamespaces` (0.2.2 already has it): only proxy pods in those namespaces get the
  engine and read access to the policy bundle. The default is `traefik`, `kube-system` and
  `envoy-gateway-system`. If your proxy runs elsewhere, add its namespace in step 1 below. While
  pods that run the engine are in a namespace the value doesn't list, `helm upgrade` stops with
  `pods with the Inkwall engine run in namespace(s) …, which injection.proxyNamespaces doesn't list`
  and changes nothing. Helm checks this only when it reaches the cluster: with `helm template` or
  Argo CD, list the namespaces yourself. See [Operations](/docs/operations/).
- **Remove `spec.engine.socketDir` from your `InkwallConfig`**, if you set it. It never had an
  effect, and is now deprecated: setting or changing it draws a warning. An `InkwallConfig` that
  has it keeps working.
- **Check how the chart grants the integrations' permissions.** Each integration now has a
  `ClusterRole` of its own, `inkwall-operator-traefik` and `inkwall-operator-envoy-gateway`, chosen
  by the new values `rbac.integrations.traefik` and `rbac.integrations.envoyGateway`. The default,
  `true` (also with `--reuse-values`, which has no such values), grants both, so a proxy installed
  after Inkwall is protected. With `auto`, a role is granted only if the proxy's CRDs are installed
  when you run `helm upgrade`: run it again once a proxy is installed, or its integration stays
  disabled (`IntegrationDisabled`). With Argo CD or Flux, keep both values `true` or `false` in Git
  ([GitOps](/docs/gitops/)).
- **Update what parses the `Enforced` condition's message** (alerts, scripts): see
  [below](#what-changes-by-itself).

### Upgrade

1. Upgrade the chart, with the values you installed it with:

   ```sh
   helm upgrade inkwall oci://ghcr.io/inkwall-dev/charts/inkwall --version 0.3.0 \
     --namespace inkwall-system --reset-then-reuse-values
   ```

   If your proxy runs outside the default proxy namespaces, add them, with the defaults you still
   need: `--set 'injection.proxyNamespaces={ingress,envoy-gateway-system}'`.

   `--reset-then-reuse-values` takes the new chart's defaults, then your values. Passing your values
   file again (`-f values.yaml`) works too.

   The chart upgrades the CRDs with it (`crds.install`, on by default). If you install the CRDs
   yourself, apply the new ones first:

   ```sh
   helm template inkwall oci://ghcr.io/inkwall-dev/charts/inkwall --version 0.3.0 \
     --show-only templates/crds.yaml | kubectl apply --server-side -f -
   ```

2. Wait for the operator:

   ```sh
   kubectl -n inkwall-system rollout status deployment/inkwall-operator
   ```

3. Restart Traefik, so its pods run the 0.3.0 engine:

   ```sh
   kubectl -n <traefik namespace> rollout restart deployment/<traefik>
   ```

If Argo CD or Flux installs the chart, change the chart version in Git instead; see
[GitOps](/docs/gitops/).

### What's new

The upgrade adds no new kinds, and no chart values besides `rbac.integrations` (and
`injection.proxyNamespaces` from 0.2.0 or 0.2.1).

- **`HTTPRoute` targets are wired**: through Traefik's Gateway API provider (an `ExtensionRef`
  filter to the `inkwall-waf` Middleware), or through Envoy Gateway (an `EnvoyExtensionPolicy`
  calling the engine over ext_proc). `sectionName` protects one named rule of a route.
- **`InkwallConfig.status.proxies`** lists the proxy controllers of the cluster's IngressClasses and
  GatewayClasses, and how far Inkwall wires their routes: `Full`, `Partial` or `Unsupported`. It is
  written into an existing `InkwallConfig` named `default` only.
- **A webhook for `InkwallConfig`**, with `failurePolicy: Ignore`: it only warns.
- **Integrations checked at start and every minute.** An integration whose permissions the operator
  lacks is disabled instead of stalling the others: policies on its proxy's routes are
  `Programmed=False` (`IntegrationDisabled`), and the proxy is `Unsupported` in `status.proxies`.
- **`GOMEMLIMIT`.** The operator sets it to 90% of its container's memory limit
  (`operator.resources.limits.memory`, 512Mi by default), unless `GOMEMLIMIT` is set.
- **New metrics**: `inkwall_operator_wired_targets{integration}`,
  `inkwall_operator_wiring_failures{integration}`, `inkwall_operator_engines_left_out`,
  `inkwall_operator_request_stats_dropped_total{reason}` and
  `inkwall_operator_state_engines_left_out`.
- **`inkwall-engine ext-proc`**, Envoy's external processing over gRPC; **`inkwallctl migrate
  ingress-nginx`** ([Migrating from ingress-nginx](/docs/migrating-from-ingress-nginx/)); and
  `inkwallctl test --ingress` reads `IngressRoute` and `HTTPRoute` objects, strictly
  ([Testing rules](/docs/testing-rules/)).

### What changes by itself

- **`HTTPRoute` targets are enforced**, as [above](#before-you-upgrade).
- **The `Enforced` condition's messages no longer count engines.** `every engine runs bundle 42 or
  later`, `some engines don't run bundle 42 yet` and `some engines rejected bundle 42 (first:
  shop/traefik-abc: error)`, instead of `5/6 engines on bundle 42` and `1/6 engines rejected bundle
  42`. So a proxy rollout no longer rewrites every policy's status; `inkwall_operator_engines{state}`
  has the counts. A new reason, `EnginesUnreported`, says a replica's engine report left engines
  out.
- **A policy's status is written only when it changes.** `status.bundleVersion` is now the first
  bundle that enforces the policy as it is, not the newest bundle, so the `BUNDLE` column of
  `kubectl get wafpolicy` differs between policies. Policies upgraded from 0.2.x keep their version
  until their next change.
- **`Programmed=False` after uninstall.** The `helm uninstall` hook sets `Programmed=False` and
  `Ready=False`, reason `Unwired`, on every policy whose routes it unwired.
- **Request counts.** Engines count, per policy, the requests they allow, deny and detect, with
  their latency; the operator sends the totals to a connected [control plane](/docs/control-plane/).
  `Standalone`, the default, sends nothing.
- **Limits on what an engine sends.** The operator refuses an engine whose `Hello` or heartbeat
  carries oversized fields, keeps the first 1,000 security events of a message and counts the rest
  as dropped, and cuts a rejection's error to 1 KiB.
- **Less of the cluster in the operator's cache**: one informer per integration selector, so custom
  `InkwallConfig` selectors no longer make it cache every pod.
- **Your `ClientTrafficPolicy` wins.** When you add one for a Gateway that has the operator's
  (`inkwall-waf-<gateway>`), the operator deletes its own.

Traefik's pods keep their 0.2.x engine until they restart. It keeps enforcing its rules, but sends
no request counts, and matches an `HTTPRoute`'s wildcard hostname against a single DNS label only.
Envoy Gateway's pods need no restart: 0.2.x never put an engine in them, and Envoy Gateway rolls
them itself when the operator changes their `EnvoyProxy`. An engine image set in
`InkwallConfig.spec.engine.image` stays as it is: change it to 0.3.0 yourself.

### Protecting HTTPRoutes

- **Traefik:** install the Gateway API CRDs (the
  [standard channel](https://gateway-api.sigs.k8s.io/guides/getting-started/#installing-gateway-api))
  and turn on Traefik's Gateway API provider (`providers.kubernetesGateway.enabled=true` in its
  chart). The operator wires the HTTPRoutes whose parent Gateway has a GatewayClass of controller
  `traefik.io/gateway-controller`.
- **Envoy Gateway** (v1.9; not with `mergeGateways`, nor Envoy as a DaemonSet): turn on its Backend
  API with `--set config.envoyGateway.extensionApis.enableBackend=true` on its chart, as in
  [Getting started](/docs/getting-started/).

The operator looks for these CRDs every 30 s, so they can be installed before or after the
upgrade. The Gateway API's v1.7 CRDs need Kubernetes 1.31 or later. Then target the routes:

```yaml
spec:
  targetRefs:
    - {group: gateway.networking.k8s.io, kind: HTTPRoute, name: web}
    - {group: gateway.networking.k8s.io, kind: HTTPRoute, name: api, sectionName: orders}
```

A route of another Gateway API controller is resolved into the bundle, but not wired: the policy
is `Programmed=False` (`ControllerUnsupported`).

### Check it worked

```sh
helm -n inkwall-system list
kubectl get wafpolicy -A
kubectl get inkwallconfig default -o jsonpath='{range .status.proxies[*]}{.controllerName} {.support}{"\n"}{end}'
kubectl -n <traefik namespace> get pods -l app.kubernetes.io/name=traefik \
  -o jsonpath='{range .items[*]}{.metadata.name} {.spec.initContainers[?(@.name=="inkwall-engine")].image}{"\n"}{end}'
```

The chart shows 0.3.0, the policies are `Ready`, the proxies you run are `Full`, and Traefik's pods
run `ghcr.io/inkwall-dev/inkwall-engine:0.3.0`.

### Roll back

0.2.x neither wires nor unwires HTTPRoutes. Before `helm rollback`, unprotect them: remove the
`HTTPRoute` entries from every policy's `targetRefs`, or delete those policies. The operator then
removes its filters from the HTTPRoutes, takes the engine out of the `EnvoyProxy` objects and
deletes its Envoy Gateway objects. Wait until the first command prints nothing and the second finds
no resources:

```sh
kubectl get httproutes.gateway.networking.k8s.io,gateways.gateway.networking.k8s.io,envoyproxies.gateway.envoyproxy.io -A \
  -o jsonpath='{range .items[?(@.metadata.annotations.waf\.inkwall\.dev/wired)]}{.kind} {.metadata.namespace}/{.metadata.name}{"\n"}{end}'
kubectl get envoyextensionpolicies.gateway.envoyproxy.io,backends.gateway.envoyproxy.io,clienttrafficpolicies.gateway.envoyproxy.io,envoyproxies.gateway.envoyproxy.io \
  -A -l app.kubernetes.io/managed-by=inkwall-operator
```

Then roll back, and restart Traefik so its pods run the older engine again:

```sh
helm -n inkwall-system rollback inkwall
kubectl -n <traefik namespace> rollout restart deployment/<traefik>
```

Roll back to 0.2.2 rather than 0.2.0 or 0.2.1, which are affected by GHSA-r5cq-6vq5-q8qg.

## From 0.1.x

Upgrade to 0.2.2 first, then to 0.2.3 ([From 0.2.2 to 0.2.3](#from-022-to-023)). On the way, every `WAFPolicy` gets the finalizer `waf.inkwall.dev/unwire`
(from 0.1.0), which matters if Argo CD or Flux manages them ([GitOps](/docs/gitops/)), and bundles
past 900 KiB compressed are split into chunk Secrets, which 0.1.x can't read. The full guide's
[0.1.x section](https://github.com/inkwall-dev/inkwall/blob/v0.6.0/docs/upgrading.md#from-01x-to-022)
lists every change and how to roll back.
