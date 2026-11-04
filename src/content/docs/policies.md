---
title: Policies
description: WAFPolicy, rule sets and how Inkwall validates them before they are saved.
order: 4
---

> The API is `waf.inkwall.dev/v1alpha1` and will change. Samples:
> [`operator/config/samples`](https://github.com/inkwall-dev/inkwall/tree/main/operator/config/samples).

## WAFPolicy

A `WAFPolicy` protects routes in its namespace:

```yaml
apiVersion: waf.inkwall.dev/v1alpha1
kind: WAFPolicy
metadata:
  name: demo
  namespace: inkwall-demo
spec:
  targetRefs:
  - kind: Ingress
    name: demo
  mode: Block               # Detect (the default) logs; Block rejects
  timeout: 250ms            # inspection deadline per request, at most 1s
  skip:
    paths: ["/health"]      # never inspected
  ruleSets:
  - ref: {kind: ClusterWAFRuleSet, name: owasp-crs-v4}
    paranoiaLevel: 1
    inboundAnomalyThreshold: 5
  - ref: {kind: WAFRuleSet, name: shop-custom}
  exclusions:               # turn a rule off where it causes false positives
  - ruleIDs: [942100]
    when: {path: "/search", argument: q}
  body:
    maxBytes: 65536
```

| Field | What it does |
|---|---|
| `targetRefs` | The routes to protect: `Ingress` objects served by Traefik or the HAProxy Kubernetes Ingress Controller, Traefik `IngressRoute` objects (`group: traefik.io`), Gateway API `HTTPRoute` objects (`group: gateway.networking.k8s.io`) served by Traefik, Envoy Gateway or Istio, optionally one rule (`sectionName`), and Istio `VirtualService` objects (`group: networking.istio.io`) |
| `mode` | `Detect` (log, let through) or `Block` (reject) |
| `failureMode` | What happens when a request can't be inspected in time: `Closed` (503) or `Open`. Unset: closed in block mode, open in detect mode |
| `timeout` | Inspection deadline per request, more than 0 and at most 1s |
| `skip.paths`, `skip.bodyPaths` | Paths never inspected, or whose body isn't; exact (`/healthz`) or prefix (`/static/*`) |
| `ruleSets` | The rules to run, in order; with no entry, the Core Rule Set with its defaults |
| `exclusions` | Rule IDs to turn off, everywhere or for a path, an argument or both |
| `body` | Whether bodies are inspected, how much of them, and what happens to larger ones; `grpcMessages: Inspect` reads the text in gRPC messages ([gRPC](/docs/grpc/)) |
| `responses` | Whether the app's responses are inspected too, for data leaks ([below](#responses)) |
| `webSocket` | The origins a WebSocket handshake may come from, and the headers it must have ([below](#websocket-handshakes)) |

### IngressRoute targets

A Traefik `IngressRoute` needs its group:

```yaml
spec:
  targetRefs:
  - group: traefik.io
    kind: IngressRoute
    name: web
```

Its hosts and paths come from its routes' `match` rules, which may combine `Host`, `Path` and
`PathPrefix` with `&&`. A rule with anything else (`||`, `!`, other matchers) isn't accepted.

### HTTPRoute targets

A Gateway API `HTTPRoute`, served by Envoy Gateway or by Traefik's Gateway API provider, needs its
group, and may name one of its rules with `sectionName`:

```yaml
spec:
  targetRefs:
  - {group: gateway.networking.k8s.io, kind: HTTPRoute, name: web}
  - {group: gateway.networking.k8s.io, kind: HTTPRoute, name: api, sectionName: orders}
```

Its routes are its `hostnames` × each rule's `matches`: `Exact` and `PathPrefix` paths, and
methods. A `RegularExpression` path, or `headers` or `queryParams` matches, aren't accepted
(`TargetUnsupported`). A wildcard hostname (`*.example.com`) covers subdomains at any depth, as the
Gateway API defines; an `Ingress` wildcard covers one label. When two targets give the same host,
path and methods, the most specific wins: a rule (`sectionName`), then a whole `HTTPRoute`, then an
`Ingress` or an `IngressRoute`.

One policy can target routes of both proxies. Traefik wires an HTTPRoute only when every Gateway it
is attached to is Traefik's, so a route also attached to another proxy's Gateway is `WiringFailed`:
give each proxy its own HTTPRoute. An HTTPRoute of another Gateway API controller is resolved into
the bundle, but not wired (`ControllerUnsupported`). The proxy needs the Gateway API:

- **Traefik:** install the Gateway API CRDs and turn on its Gateway API provider
  (`providers.kubernetesGateway.enabled=true` in its chart).
- **Envoy Gateway** (v1.9; not with `mergeGateways`, nor Envoy as a DaemonSet): turn on its Backend
  API (`config.envoyGateway.extensionApis.enableBackend=true` in its chart).
- **Istio** (1.28 or later): its Gateway API implementation (on by default) and the Gateway API
  CRDs. The operator adds the engine to a Gateway's pods through the ConfigMap the Gateway names,
  and an `EnvoyFilter` sends the protected routes to it
  ([Istio](https://github.com/inkwall-dev/inkwall/blob/v0.4.0/docs/istio.md)).

### VirtualService targets

An Istio `VirtualService`, served by Istio's ingress gateways, needs its group:

```yaml
spec:
  targetRefs:
  - {group: networking.istio.io, kind: VirtualService, name: web}
```

Every http route of the VirtualService needs a `name`. Its routes are its `hosts` with each http
route's `uri` (`exact` or `prefix`) and `method` (`exact`) matches; anything else (a `regex`,
`headers`, `queryParams`, a `delegate`, a short mesh host name) is refused (`TargetUnsupported`).
The ingress gateway's pods (labelled `istio: ingressgateway`) get the engine from the Pod webhook
when they are created: restart those that ran before Inkwall. See
[VirtualServices](https://github.com/inkwall-dev/inkwall/blob/v0.4.0/docs/istio.md#virtualservices).

### Responses

```yaml
spec:
  responses:
    inspect: true
    maxBytes: 65536         # the default
    onOversize: Deny        # or Allow
```

The engine also inspects what the app answers, for data leaks: the Core Rule Set's `RESPONSE-95x`
rules find SQL errors, stack traces and directory listings. In `Block` mode a response that leaks
is replaced with 403; in `Detect` mode it is logged, with `"phase":"response"` in the event. Only
Envoy Gateway sends responses to the engine: on a Traefik or Istio route, such a policy is
`Programmed=False` (`ResponsesNotInspected`), naming the routes, while their requests are still
inspected. It costs about 0.85 ms of engine CPU per KiB of response, so a route of large HTML pages
is CPU-bound in the engine: raise `timeout` with `maxBytes`, and measure first
([response inspection](https://github.com/inkwall-dev/inkwall/blob/v0.4.0/docs/design/0006-adapter-protocols.md#response-inspection-v040)).

### WebSocket handshakes

```yaml
spec:
  webSocket:
    allowedOrigins: ["https://app.example.com", "https://*.example.com"]
    requiredHeaders: [Authorization]
```

A browser sends a page's cookies with a WebSocket handshake to any site, so a page on another site
can open a WebSocket to your app as the signed-in user. A handshake from an origin
`allowedOrigins` doesn't list (`*.` for subdomains), or without a header `requiredHeaders` names,
gets 403 before the upgrade in `Block` mode, and is logged with reason `websocket` in `Detect`
mode. `allowMissingOrigin: true` lets a client that sends no `Origin` through. The handshake's URL
and headers are inspected by the rules through every proxy; the messages after the upgrade are not,
except by the engine's own reverse proxy
([WebSocket](https://github.com/inkwall-dev/inkwall/blob/v0.4.0/docs/websocket.md)).

### Engines before 0.4.0

`webSocket`, `body.grpcMessages: Inspect` and `responses` are new in 0.4.0, and an older engine
ignores them. While one runs a policy that sets them, the policy is `Enforced=False`, reason
`EnginesOutdated`, naming the first such engine: restart the proxy's pods so they get the 0.4.0
engine.

### Deleting a policy

The operator holds each `WAFPolicy` with the finalizer `waf.inkwall.dev/unwire` until it has
unwired the policy's routes, keeping your own middlewares. A policy deleted while the operator is down
waits for it, and its routes stay protected meanwhile; see [Operations](/docs/operations/).

## Rule sets

A `ClusterWAFRuleSet` can be used from any namespace, a `WAFRuleSet` from its own. The rules come
from exactly one source:

```yaml
apiVersion: waf.inkwall.dev/v1alpha1
kind: WAFRuleSet
metadata:
  name: shop-custom
  namespace: inkwall-demo
spec:
  source:
    seclang: |
      SecRule REQUEST_HEADERS:User-Agent "@contains sqlmap" "id:100001,phase:1,deny,status:403"
    # or: builtin: crs-v4
    # or: configMapRef: {name: my-rules, key: rules.conf}
```

## Validation before saving

Mistakes are caught when you save, not when traffic arrives:

- The CRD schema rejects malformed objects: unknown modes, timeouts over 1s, relative or encoded
  paths, a target listed twice.
- The operator's webhook compiles rule sets with the engine's own Coraza version, loaded after the
  Core Rule Set as the engine loads them, and names the line of the first error:

```console
$ kubectl apply -f bad-rules.yaml
The WAFRuleSet "bad" is invalid: spec.source.seclang: Invalid value: line 2:
failed to compile the directive "secrule": operator nosuchop not found
```

Rule sets may only use directives that add, remove or change rules (`SecRule`, `SecAction`,
`SecMarker`, `SecRuleRemoveBy*`, `SecRuleUpdate*`). Settings that change the whole engine, such as
`SecRuleEngine`, or that write files, such as `SecAuditLog`, are rejected: rule sets are written by
application teams, and those settings belong to the platform.

## Status

Each policy reports how far it got, as conditions that work with `kubectl wait` and Argo CD:

| Condition | True when | Typical reasons when false |
|---|---|---|
| `Accepted` | The policy is valid, its references resolve, and the bundle with it fits | `InvalidRef`, `Conflict`, `TargetUnsupported`, `BundleTooLarge` |
| `Programmed` | The proxy of every target sends its routes to the engine | `PendingRestart` (restart Traefik to inject the engine), `SidecarMissing`, `InjectionDisabled`, `IntegrationDisabled`, `ControllerUnsupported`, `WiringFailed`, `ResponsesNotInspected` (the policy inspects responses on a proxy that doesn't send them), `Unverified` (HAProxy: the operator's probe hasn't proven the filter on every pod yet), `Unwired` (after `helm uninstall`) |
| `Enforced` | Every engine runs a bundle with this policy as it is, and inspection isn't suspended | `EnginesBehind`, `EngineNack`, `EnginesUnreported`, `EnginesOutdated` (an engine before 0.4.0 runs a policy with a 0.4.0 field), `NoEngines`, `Suspended` |
| `Ready` | All three | `Suspended` while inspection is [suspended](/docs/operations/), else the first failing condition's reason |

`status.bundleVersion` is the first bundle that enforces the policy as it is now; a bundle that
changes only other policies leaves it, so the `BUNDLE` column differs between policies. The
`Enforced` messages don't count engines (`every engine runs bundle 42 or later`,
`some engines don't run bundle 42 yet`, `some engines rejected bundle 42 (first: ns/pod: error)`),
so a proxy rollout doesn't rewrite every policy's status; `inkwall_operator_engines{state}` has the
counts.

```console
$ kubectl get wafpolicy -A
NAMESPACE   NAME   MODE    READY   BUNDLE   AGE
shop        web    Block   True    2        3s
$ kubectl wait wafpolicy/web -n shop --for=condition=Ready
```
