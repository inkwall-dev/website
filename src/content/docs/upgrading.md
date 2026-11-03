---
title: Upgrading
description: Upgrade from 0.3.0 to 0.3.1, and from 0.2.x to 0.3.0, what to check first, what changes by itself, protecting HTTPRoutes, and how to roll back.
order: 2
---

The latest release is **0.3.1**, a patch release for 0.3.0. From 0.3.0, upgrade as
[below](#from-030-to-031). From any 0.2 release, upgrade to 0.3.0 first, as in
[From 0.2.x to 0.3.0](#from-02x-to-030). From 0.1.x, upgrade to 0.2.2 first, then to 0.3.0. The
full guide is
[`docs/upgrading.md`](https://github.com/inkwall-dev/inkwall/blob/v0.3.1/docs/upgrading.md).

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

Upgrade to 0.2.2 first. On the way, every `WAFPolicy` gets the finalizer `waf.inkwall.dev/unwire`
(from 0.1.0), which matters if Argo CD or Flux manages them ([GitOps](/docs/gitops/)), and bundles
past 900 KiB compressed are split into chunk Secrets, which 0.1.x can't read. The full guide's
[0.1.x section](https://github.com/inkwall-dev/inkwall/blob/v0.3.1/docs/upgrading.md#from-01x-to-022)
lists every change and how to roll back.
