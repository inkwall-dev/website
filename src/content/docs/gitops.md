---
title: GitOps
description: The fields the operator writes on your objects, and how to keep Argo CD and Flux from undoing them.
order: 7
---

Your `WAFPolicy` and rule set objects belong in Git, like your routes. To protect a route, though,
the operator writes to it, and a GitOps tool that sets the same field reports drift and undoes it.
This page lists what the operator writes and how to configure Argo CD and Flux; the full guide is
[`docs/gitops.md`](https://github.com/inkwall-dev/inkwall/blob/v0.4.1/docs/gitops.md).

## What the operator writes

With Traefik, the operator adds its ForwardAuth middleware, `inkwall-waf`, to each route a policy
protects. With Envoy Gateway, it adds the engine to the Envoy pods through the Gateway's
`EnvoyProxy`. It changes only its own entries, keeps yours in order, and removes only its own when
the route is no longer protected. It writes with JSON merge patches, as the field manager `inkwall-operator`.

| Object | Field | Value |
|---|---|---|
| `Ingress` | annotation `traefik.ingress.kubernetes.io/router.middlewares` | `<namespace>-inkwall-waf@kubernetescrd` first; your entries after it |
| `Ingress` | annotation `waf.inkwall.dev/wired` | Marks what the operator added |
| `IngressRoute` (`traefik.io`) | `spec.routes[*].middlewares` | `{name: inkwall-waf}` first in every route; your entries after it |
| `IngressRoute` | annotation `waf.inkwall.dev/wired` | `inkwall-waf` |
| `HTTPRoute` (`gateway.networking.k8s.io`, of Traefik's Gateways only) | `spec.rules[*].filters` | An `ExtensionRef` filter to the `inkwall-waf` Middleware, first in every protected rule (with `sectionName`, that rule only); your filters after it |
| `HTTPRoute` | annotation `waf.inkwall.dev/wired` | `inkwall-waf` |
| `EnvoyProxy` (`gateway.envoyproxy.io`) named by a Gateway with a protected route | `spec.provider.kubernetes.envoyDeployment`: `initContainers`, `pod.volumes`, `container.volumeMounts` | The engine, `inkwall-engine`, first among the init containers; its volumes and the mount `inkwall-socket` after yours |
| `EnvoyProxy` | annotations `waf.inkwall.dev/wired`, `waf.inkwall.dev/hash` | `sidecar`, and a hash of the operator's entries |
| `Gateway` (Envoy Gateway's) that names no `EnvoyProxy` | `spec.infrastructure.parametersRef` | The operator's `EnvoyProxy`, `inkwall-waf-<gateway>` |
| `Gateway` | annotation `waf.inkwall.dev/wired` | `inkwall-waf-<gateway>` |
| `WAFPolicy` | `metadata.finalizers` | `waf.inkwall.dev/unwire`: the operator unwires the policy's routes before it can be deleted |
| `WAFPolicy`, rule sets, `InkwallConfig` | `status` | Conditions, bundle version |

The objects the operator creates aren't in your repository, and carry the label
`app.kubernetes.io/managed-by: inkwall-operator`: the `inkwall-waf` Middleware; for Envoy Gateway,
the `Backend` `inkwall-engine`, an `EnvoyExtensionPolicy` `inkwall-waf-<route>` per protected
HTTPRoute, and a `ClientTrafficPolicy` and an `EnvoyProxy` `inkwall-waf-<gateway>` per Gateway that
needs one; the `inkwall-trust` ConfigMaps in the proxy namespaces; and the Secrets in
`inkwall-system`. The engine is injected into Traefik's pods when they're created, so Traefik's
`Deployment` doesn't drift. Envoy Gateway rolls its Envoy `Deployment` when the operator adds the
engine to a Gateway's `EnvoyProxy` or takes it out. The operator never writes your
`InkwallConfig`'s spec or annotations.

## When there is drift

A GitOps tool compares only the fields your manifest sets:

| Your manifest | Drift |
|---|---|
| An `Ingress` without the `router.middlewares` annotation | None |
| An `Ingress` with its own `router.middlewares` annotation | The annotation |
| Any `IngressRoute` | `spec.routes`: Traefik's CRD makes the whole list one value |
| A protected `HTTPRoute` of a Traefik Gateway | `spec.rules`: the Gateway API's CRD makes `rules` and `filters` atomic lists |
| An `EnvoyProxy` that doesn't set those three lists, or a `Gateway` | None |
| An `EnvoyProxy` that sets `initContainers`, `pod.volumes` or `container.volumeMounts` | Those lists. Undoing it takes the engine out of the Envoy pods, and the Gateway's routes go uninspected until the operator adds it back and the pods have it |
| A `WAFPolicy` without `metadata.finalizers` | None |

Undoing the drift is worse than seeing it: the tool removes Inkwall's middleware, and the route
isn't inspected until the operator puts it back, which it does as soon as it sees the change.

## Argo CD

Add these rules to every Application that deploys protected routes:

```yaml
spec:
  ignoreDifferences:
    # Only needed for Ingresses whose manifest sets this annotation.
    - group: networking.k8s.io
      kind: Ingress
      jsonPointers:
        - /metadata/annotations/traefik.ingress.kubernetes.io~1router.middlewares
    - group: traefik.io
      kind: IngressRoute
      jqPathExpressions:
        # A route with only Inkwall's Middleware: its whole list.
        - '.spec.routes[]? | select(.middlewares == [{"name": "inkwall-waf"}]) | .middlewares'
        # A route with yours too: only Inkwall's entry.
        - '.spec.routes[]?.middlewares[]? | select(.name == "inkwall-waf")'
    - group: gateway.networking.k8s.io
      kind: HTTPRoute
      jqPathExpressions:
        # A rule with only Inkwall's filter: its whole list.
        - '.spec.rules[]? | select(.filters == [{"type": "ExtensionRef", "extensionRef": {"group": "traefik.io", "kind": "Middleware", "name": "inkwall-waf"}}]) | .filters'
        # A rule with yours too: only Inkwall's filter.
        - '.spec.rules[]?.filters[]? | select(.type == "ExtensionRef" and .extensionRef == {"group": "traefik.io", "kind": "Middleware", "name": "inkwall-waf"})'
    # Only needed for EnvoyProxies whose manifest sets these lists.
    - group: gateway.envoyproxy.io
      kind: EnvoyProxy
      jqPathExpressions:
        - '.spec.provider.kubernetes.envoyDeployment.initContainers[]? | select(.name == "inkwall-engine")'
        - '.spec.provider.kubernetes.envoyDeployment.pod.volumes[]? | select(.name | startswith("inkwall-"))'
        - '.spec.provider.kubernetes.envoyDeployment.container.volumeMounts[]? | select(.name == "inkwall-socket")'
  syncPolicy:
    syncOptions:
      - ApplyOutOfSyncOnly=true
```

`ignoreDifferences` only changes the diff: a sync still applies your manifest and removes Inkwall's
entry until the operator adds it back. `ApplyOutOfSyncOnly=true` makes a sync skip the routes you
didn't change. With the `Ingress` rule, Argo CD ignores the whole annotation, your own middlewares
included: to apply a change to it alone, change another field in the same commit, or sync once with
"Apply out of sync only" off.

When Argo CD prunes a `WAFPolicy`, the deletion waits for the operator to unwire its routes. If the
operator is gone, the policy stays `Terminating`; remove the finalizer as in
[Operations](/docs/operations/).

## Flux

Flux applies with server-side apply and resets the fields your manifests set at each interval. An
`Ingress` without its own `router.middlewares` annotation never drifts; one with it, and every
`IngressRoute` and protected `HTTPRoute`, loses Inkwall's entry at each interval until the operator
adds it back.

Flux 2.9 and later can leave fields out with `spec.ignore` on the `Kustomization`:

```yaml
apiVersion: kustomize.toolkit.fluxcd.io/v1
kind: Kustomization
metadata:
  name: shop
  namespace: flux-system
spec:
  interval: 10m
  path: ./shop
  prune: true
  sourceRef:
    kind: GitRepository
    name: shop
  ignore:
    # Only needed for Ingresses whose manifest sets this annotation.
    - paths:
        - /metadata/annotations/traefik.ingress.kubernetes.io~1router.middlewares
      target:
        group: networking.k8s.io
        kind: Ingress
    # One path per route of the IngressRoute: /spec/routes/0, /spec/routes/1, ...
    - paths:
        - /spec/routes/0/middlewares
      target:
        group: traefik.io
        kind: IngressRoute
        name: web
    # One path per protected rule of the HTTPRoute: /spec/rules/0, /spec/rules/1, ...
    - paths:
        - /spec/rules/0/filters
      target:
        group: gateway.networking.k8s.io
        kind: HTTPRoute
        name: web
```

A JSON pointer can't pick one list entry, so the route's whole `middlewares` list, or a rule's
`filters` list, is ignored, yours included: to change your own, remove the rule, change them, and
add it back. An `EnvoyProxy` whose manifest sets the lists the operator writes to needs the same
kind of rule, on the whole lists under `/spec/provider/kubernetes/envoyDeployment`. Scope every rule with a
`target`. With an older Flux, annotate the route `kustomize.toolkit.fluxcd.io/ssa: IfNotPresent`:
Flux creates it and never updates it.

## Installing the chart with a GitOps tool

The operator also writes to the chart's webhook configurations: the `failurePolicy` (`Fail` while a
policy blocks) and `objectSelector` (which selects no pod while Traefik's integration is disabled)
of `inkwall-operator-mutating`, and the `caBundle` of both
webhook configurations. Ignore those fields in the Application or `HelmRelease` that installs the
chart; the [guide](https://github.com/inkwall-dev/inkwall/blob/v0.4.1/docs/gitops.md#installing-the-chart-with-a-gitops-tool)
has both configurations.

Keep the `InkwallConfig` and your policies apart from the chart (another Application, or a
Kustomization whose `dependsOn` names the chart's), and let the tool retry until the operator is
ready: the validating webhook refuses `WAF*` objects while no operator replica answers. Upgrade the
chart with the tool, not with `helm upgrade`.

Keep `rbac.integrations.traefik`, `envoyGateway`, `istio`, `istioIngress` and `haproxy` `true` (the default) or `false` in Git rather
than `auto`: Argo CD renders the chart without asking the cluster, so `auto` grants every role, and
Flux asks the cluster only when it upgrades the release, so a proxy installed later stays disabled
until the next change. For the same reason, list your proxy namespaces in
`injection.proxyNamespaces` yourself: the chart's check for engine pods outside them can't run
when Argo CD renders it. The chart README covers
[proxy namespaces](https://github.com/inkwall-dev/inkwall/blob/v0.4.1/deploy/helm/inkwall/README.md#proxy-namespaces)
and [integration permissions](https://github.com/inkwall-dev/inkwall/blob/v0.4.1/deploy/helm/inkwall/README.md#integration-permissions).

## Check it worked

After a sync, and after the next Flux interval, the routes are still wired and the policies `Ready`:

```sh
kubectl -n shop get ingress web \
  -o jsonpath='{.metadata.annotations.traefik\.ingress\.kubernetes\.io/router\.middlewares}{"\n"}'
kubectl -n shop get ingressroute web -o jsonpath='{.spec.routes[*].middlewares[*].name}{"\n"}'
kubectl -n shop get httproute web -o jsonpath='{.spec.rules[*].filters[*].extensionRef.name}{"\n"}'
kubectl get wafpolicy -A
```

Each route prints `shop-inkwall-waf@kubernetescrd` or `inkwall-waf` first.
