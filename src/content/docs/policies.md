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
| `targetRefs` | The routes to protect: `Ingress` objects served by Traefik, and Traefik `IngressRoute` objects (`group: traefik.io`). The API also accepts a Gateway API `HTTPRoute`, but the operator doesn't resolve those yet and reports `TargetUnsupported` |
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

### Deleting a policy

The operator holds each `WAFPolicy` with the finalizer `waf.inkwall.dev/unwire` until it has removed
its middleware from the policy's routes, keeping yours. A policy deleted while the operator is down
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
| `Accepted` | The policy is valid and its references resolve | `InvalidRef`, `TargetUnsupported` |
| `Programmed` | Traefik sends the routes to the engine | `PendingRestart` (restart Traefik to inject the engine), `SidecarMissing`, `InjectionDisabled`, `WiringFailed` |
| `Enforced` | Every engine runs the bundle with this policy | `EnginesBehind`, `EngineNack`, `NoEngines` |
| `Ready` | All three | The first failing condition's reason |

```console
$ kubectl get wafpolicy -A
NAMESPACE   NAME   MODE    READY   BUNDLE   AGE
shop        web    Block   True    2        3s
$ kubectl wait wafpolicy/web -n shop --for=condition=Ready
```
