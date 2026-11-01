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
| `targetRefs` | The routes to protect: `Ingress` objects served by Traefik, Traefik `IngressRoute` objects (`group: traefik.io`), and Gateway API `HTTPRoute` objects (`group: gateway.networking.k8s.io`) served by Traefik or Envoy Gateway, optionally one rule (`sectionName`) |
| `mode` | `Detect` (log, let through) or `Block` (reject) |
| `failureMode` | What happens when a request can't be inspected in time: `Closed` (503) or `Open`. Unset: closed in block mode, open in detect mode |
| `timeout` | Inspection deadline per request, more than 0 and at most 1s |
| `skip.paths`, `skip.bodyPaths` | Paths never inspected, or whose body isn't; exact (`/healthz`) or prefix (`/static/*`) |
| `ruleSets` | The rules to run, in order; with no entry, the Core Rule Set with its defaults |
| `exclusions` | Rule IDs to turn off, everywhere or for a path, an argument or both |
| `body` | Whether bodies are inspected, how much of them, and what happens to larger ones |

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
| `Accepted` | The policy is valid and its references resolve | `InvalidRef`, `Conflict`, `TargetUnsupported` |
| `Programmed` | The proxy of every target sends its routes to the engine | `PendingRestart` (restart Traefik to inject the engine), `SidecarMissing`, `InjectionDisabled`, `IntegrationDisabled`, `ControllerUnsupported`, `WiringFailed`, `Unwired` (after `helm uninstall`) |
| `Enforced` | Every engine runs a bundle with this policy as it is | `EnginesBehind`, `EngineNack`, `EnginesUnreported`, `NoEngines` |
| `Ready` | All three | The first failing condition's reason |

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
