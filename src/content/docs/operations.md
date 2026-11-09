---
title: Operations
description: What happens when the operator or the engine is down, bundle size, metrics, rolling out a new engine, proxy namespaces, integration permissions, redacting security events, network policies, chart values, opting a proxy out, turning injection off, deleting policies, the emergency switch and uninstalling.
order: 6
---

## When the operator is down

Traffic is unaffected. Every engine keeps enforcing its last policy bundle, and an engine that
starts with no bundle reads it from the cluster (the `inkwall-bundle` Secret).

What depends on the operator is **creating Traefik pods**. Envoy Gateway's Envoy pods don't depend
on it: their engine comes from the `EnvoyProxy`, not from the Pod webhook.

- **No policy in block mode:** new Traefik pods start without the engine; their traffic isn't
  inspected, and the policies report `Programmed=False` (`SidecarMissing`) with the pods to restart.
- **A policy in block mode:** a Traefik pod can't be created without its engine, so Traefik can't
  scale up or replace pods until the operator is back. Running pods keep serving.

If Traefik must start pods before the operator is back, label its pods to opt out, which starts
them **uninspected**:

```sh
kubectl -n <traefik namespace> patch deployment <traefik> --type merge \
  -p '{"spec":{"template":{"metadata":{"labels":{"waf.inkwall.dev/inject":"false"}}}}}'
```

Remove the label once the operator is back.

## When the engine is down

The policy's mode and failure mode are applied by the engine, so they hold only while it answers.
When Traefik can't reach the engine in its pod, Traefik answers **500** and doesn't forward the
request, **in detect mode as in block mode**: at once when the engine has crashed or is restarting
(connection refused), after Traefik's fixed 30 s timeout when it hangs. Traefik's ForwardAuth has no
setting to let requests through instead.

What keeps an outage short:

- Traefik starts only once its engine is ready: the engine is a native sidecar with a startup
  probe.
- The kubelet restarts a crashed engine at once, then with a back-off, and a hung one once its
  liveness probe fails (about 30 s). A restarted engine enforces its cached bundle from its first
  request.
- While the engine isn't ready, neither is Traefik's pod, so its Service sends it no new
  connections. Run several Traefik replicas: an engine down in one pod then costs only the
  connections that pod already has.

To find an outage, `kubectl -n <traefik namespace> get pods` shows the restarts, and Traefik logs
`Error calling http://127.0.0.1:9001/v1/forward-auth` for each request it answered 500.

**Through Envoy Gateway**, Envoy answers 500 when it can't reach the engine, unless every policy on
the route fails open (`failureMode: Open`, or detect mode without one): then it lets the request
through uninspected. When those policies are all in detect mode, Envoy doesn't wait for the engine
at all, so a slow or hung engine delays nothing. Otherwise Envoy waits 500 ms longer than the
policy's `timeout`. Large bodies take longer to inspect (the CRS takes about 200 ms on a 48 KB form
field on a fast machine), so raise `timeout`, up to 1s, for routes that take large bodies.

## Bundle size

All of a cluster's policies go into one bundle, of at most 7,200 KiB compressed (and 64 MiB
decompressed). Up to 900 KiB, it is kept in the Secret `inkwall-bundle`; past that, in chunk
Secrets of 900 KiB, labelled `waf.inkwall.dev/bundle-chunk`. Bundles name the Core Rule Set rather
than embed it: the operator's scale test put 5,000 policies in 134 KiB.

Past 75% of the limit, the operator logs `bundle nears its size limit` when it publishes. Past the
limit, a change isn't published and every engine keeps the current bundle; the operator logs
`bundle not published`. The policies the change would add or change are `Accepted=False` and
`Ready=False`, reason `BundleTooLarge`, with the sizes, until it fits; the others keep their status,
since engines run them as they are. The metric `inkwall_operator_bundle_compressed_bytes` shows the size.

## Metrics

The operator serves its metrics on port 8080, and each engine on port 9480 (`inkwall-admin`) in
the proxy pod it runs in. Among the operator's:

| Metric | |
|---|---|
| `inkwall_operator_bundle_version`, `inkwall_operator_bundle_compressed_bytes` | The current bundle, and its size |
| `inkwall_operator_engines{state}` | Engines by state; the `Enforced` messages don't count them |
| `inkwall_operator_engines_left_out` | Engines left out of a replica's engine report; while any are, `Enforced` is `False` (`EnginesUnreported`) |
| `inkwall_operator_policies{condition,status,reason}` | Policies by each condition and its reason (since 0.5.0) |
| `inkwall_operator_signing_key_age_seconds`, `inkwall_operator_signing_key_rotation_phase` | The signing key's age, and the [rotation](/docs/key-rotation/)'s phase (since 0.5.0) |
| `inkwall_operator_wired_targets{integration}` | Policy targets wired, by integration |
| `inkwall_operator_wiring_failures{integration}` | Targets that couldn't be wired (`WiringFailed`) |
| `inkwall_operator_request_stats_dropped_total{reason}` | Policies' request counts dropped on their way to a [control plane](/docs/control-plane/) |

The engines' metrics, the alerts and the Grafana dashboard the chart ships, and what to do when an
alert fires are on [Monitoring](/docs/monitoring/).

## Rolling out a new engine

Proxy pods started before Inkwall, or running another engine image than the one configured (after
a chart upgrade, say), are `PendingRestart` until restarted; Envoy Gateway and Istio's Gateways roll
their own pods. That is the default (`Manual`). Since 0.5.0, the operator can restart the others
itself:

```sh
kubectl patch inkwallconfig default --type=merge -p '{"spec":{"engine":{"rollout":"Automatic"}}}'
```

It then evicts the Traefik, HAProxy and Istio ingress gateway pods it injected that run an old
engine, one at a time, through the Eviction API, so PodDisruptionBudgets are respected, and waits
for each replacement to be ready with the new engine before the next. A pod with the engine in its
own spec is left alone. A refused eviction, or a replacement not ready within 5 minutes, pauses the
rollout, and the `InkwallConfig`'s `EngineRollout` condition says why:

```sh
kubectl get inkwallconfig default -o jsonpath='{.status.conditions[?(@.type=="EngineRollout")].message}'
```

## Proxy namespaces

The operator recognises a proxy's pods by their labels: Traefik's `app.kubernetes.io/name=traefik`,
Envoy Gateway's `app.kubernetes.io/name=envoy` and `app.kubernetes.io/managed-by=envoy-gateway`,
Istio's `gateway.istio.io/managed=istio.io-gateway-controller` (Gateway API) and
`istio=ingressgateway` (its ingress gateways), and the HAProxy Kubernetes Ingress Controller's
`app.kubernetes.io/name=kubernetes-ingress`.
A proxy pod gets the engine, and read access to the policy bundle, which holds every namespace's
policies and rules. Anyone who may create a pod may give it those labels, so the operator only looks
for proxy pods in the namespaces of `injection.proxyNamespaces`: `traefik`, `kube-system` (where k3s
and RKE2 run Traefik), `envoy-gateway-system`, `istio-ingress` and `istio-system` (where Istio's docs
put Gateways) and `haproxy-controller` by default. A pod with a proxy's labels anywhere
else is an ordinary pod. List only namespaces where only the people who run the proxy create pods.

If your proxy runs in another namespace, list it, with the defaults you still need:

```sh
helm upgrade inkwall oci://ghcr.io/inkwall-dev/charts/inkwall --version 0.5.0 \
  --namespace inkwall-system --reset-then-reuse-values \
  --set 'injection.proxyNamespaces={ingress,envoy-gateway-system}'
```

Until it is listed, its pods get no engine and its routes are served uninspected
(`Programmed=False`, `SidecarMissing`). So when pods that already run the engine are in a namespace
the value doesn't list, `helm upgrade` stops with an error naming them, and changes nothing. Helm
checks this only when it can reach the cluster: not with `helm template`, nor in Argo CD. `{*}`
makes every namespace a proxy namespace, as before 0.3.0, 0.2.2 and 0.1.5: only for clusters where
everyone who may create a pod may read every policy. Changing the value restarts the operator.

## Integration permissions

Each integration's permissions are in a `ClusterRole` of its own: `inkwall-operator-traefik`,
`inkwall-operator-envoy-gateway`, `inkwall-operator-istio`, `inkwall-operator-istio-ingress` and
`inkwall-operator-haproxy`. The chart values `rbac.integrations.traefik`, `envoyGateway`, `istio`,
`istioIngress` and `haproxy` choose which are granted:

- `true`, the default (also when the value is missing, as with `--reuse-values` from 0.2): always
  granted, so a proxy installed after Inkwall is protected;
- `auto`: granted when the cluster serves the proxy's API group at install or upgrade time. Install
  the proxy first, or run `helm upgrade` once it is. `helm template` and Argo CD can't ask the
  cluster, so they render every role;
- `false`: never granted.

The operator checks its permissions when it starts, and every minute. An integration it lacks some
of is disabled instead of stalling the others: policies on its proxy's routes report
`Programmed=False` with reason `IntegrationDisabled`, naming the permissions missing, and
`InkwallConfig.status.proxies` lists the proxy as `Unsupported`. Without Traefik's role, the Pod
webhook selects no Traefik pod; the same goes for Istio's ingress gateway pods without
`istioIngress`. When a role is granted or revoked, each replica restarts after a random
delay. Routes wired before an integration was disabled stay wired: unprotect them first.

## Redacting security events

Each security event an engine sends to the operator (and on to a connected
[control plane](/docs/control-plane/)) names the rules that matched, where, and a snippet of at most
64 bytes of what matched. Since 0.5.0, an engine never sends a snippet of an argument or header
whose name looks like a credential (`password`, `token`, `api_key`, `session`, `card`...), nor of a
query string or body that names one. `InkwallConfig.spec.events.redact` redacts more:

```yaml
spec:
  events:
    redact:
      headers: [X-Tenant-Secret]   # header names, any case
      arguments: [email, phone]    # parts of argument names, any case: user_email too
      snippets: false              # or send no snippets at all
```

The engines get it with the next bundle. Engine logs never carry snippets.

## Network policies

For clusters that deny traffic by default, `networkPolicy.enabled: true` (off by default, since
0.5.0) creates a NetworkPolicy for the operator's pods: the webhooks and probes from anywhere
(`networkPolicy.webhookFrom` narrows it), the engines' bundle stream from the proxy namespaces, and
the metrics (`networkPolicy.metricsFrom`). `networkPolicy.egress.enabled: true` also limits what
the chart's pods connect to. Engines run in the proxies' namespaces, which the chart doesn't own: if
those deny by default, let the engines reach the operator's port 9445 and the API server. The chart
README has the
[network flows](https://github.com/inkwall-dev/inkwall/blob/v0.5.0/deploy/helm/inkwall/README.md#network-flows).

## Chart values

Since 0.5.0, the chart checks its values against a schema: `helm install`, `upgrade` and
`template` fail on a key it doesn't have, a wrong type or a value outside its set, naming it, where
0.4.x ignored it. Run `helm upgrade ... --dry-run` first. It also takes private registries
(`global.imageRegistry`, `global.imagePullSecrets`), image digests, extra env and volumes, and
topology spread
([private registries](https://github.com/inkwall-dev/inkwall/blob/v0.5.0/deploy/helm/inkwall/README.md#private-registries)).
The chart works with Helm 3 and Helm 4.

## Proxies with other labels

If your Traefik pods carry other labels than `app.kubernetes.io/name=traefik`:

```yaml
apiVersion: waf.inkwall.dev/v1alpha1
kind: InkwallConfig
metadata:
  name: default
spec:
  integrations:
  - controller: traefik
    selector: {matchLabels: {app.kubernetes.io/component: edge-proxy}}
```

The operator restarts to apply it (each replica after a short random delay). Running Traefik pods
get the engine when they restart. The operator caches pods with one informer per selector, so a
custom selector doesn't make it watch every pod in the cluster. The pods must still run in the
[proxy namespaces](#proxy-namespaces).

If the selector matches no running Traefik pod any more, new pods wouldn't get the engine, so the
operator unwires the routes (`SidecarMissing`) until one matches again.

## Turning injection off

```sh
helm upgrade inkwall oci://ghcr.io/inkwall-dev/charts/inkwall --version 0.5.0 \
  --namespace inkwall-system --reset-then-reuse-values --set injection.enabled=false
```

Traefik pods started from then on have no engine. The operator keeps running, unwires every route
it wired, deletes its middlewares and reports `Programmed=False` (`InjectionDisabled`): the routes
are served, uninspected. It also undoes its Envoy Gateway wiring, as on uninstall. Turn it on again
and the routes are wired again at once; restart Traefik to inject the engine (`PendingRestart`).

## Deleting a policy

The operator holds each `WAFPolicy` with the finalizer `waf.inkwall.dev/unwire` until it has
unwired its routes. A policy, or its namespace, deleted while the operator is down waits for it; the
routes stay wired and enforced meanwhile. If the operator is gone for good, remove the finalizer
yourself:

```sh
kubectl get wafpolicy -A -o jsonpath='{range .items[*]}{.metadata.namespace} {.metadata.name}{"\n"}{end}' |
  while read -r ns name; do
    kubectl -n "$ns" patch wafpolicy "$name" --type merge -p '{"metadata":{"finalizers":null}}'
  done
```

## Emergency switch

`InkwallConfig.spec.suspend: true` makes every engine allow everything within seconds, without
removing anything. Set it back to `false` to enforce again.

The `InkwallConfig` named `default` is optional, and a fresh install has none. If
`kubectl get inkwallconfig default` finds it, set the field on it; if not, create it:

```sh
# The cluster has an InkwallConfig named default:
kubectl patch inkwallconfig default --type merge -p '{"spec":{"suspend":true}}'

# It has none:
kubectl create -f - <<'EOF'
apiVersion: waf.inkwall.dev/v1alpha1
kind: InkwallConfig
metadata:
  name: default
spec:
  suspend: true
EOF
```

While inspection is suspended, every `WAFPolicy` reports it: `Enforced=False` and `Ready=False`,
reason `Suspended`. The `InkwallConfig` has a `Suspended` condition, `True` while the bundle the
engines get suspends inspection:

```sh
kubectl get inkwallconfig default -o jsonpath='{.status.conditions[?(@.type=="Suspended")]}'
```

Once resumed, each policy is `Enforced` again when every engine runs the bundle that resumes
inspection. The switch works even when policy changes don't fit the bundle (policies
`Accepted=False`, reason `BundleTooLarge`): the bundle the engines run is published again,
suspended, and once resumed, they run it as before.

## Uninstalling

```sh
helm uninstall inkwall --namespace inkwall-system
```

Before anything is deleted, the chart stops the operator and removes Inkwall's middleware from every
`Ingress`, `IngressRoute` and `HTTPRoute` it wired, keeping yours. For Envoy Gateway, it deletes its
`EnvoyExtensionPolicy`, `Backend` and `ClientTrafficPolicy` objects, takes the engine out of your
`EnvoyProxy` objects, and points the Gateways it pointed at its own `EnvoyProxy` back at none. Every
`WAFPolicy` then reports `Programmed=False` and `Ready=False` (reason `Unwired`) and loses its
finalizer. The routes keep working, uninspected; Traefik pods drop the engine when they restart, and
Envoy Gateway rolls its Envoy pods without it. Last, it deletes what the operator created for itself
and the engines: the `inkwall-trust` ConfigMaps in the proxy namespaces (labelled
`app.kubernetes.io/managed-by: inkwall-operator`; an unlabelled one of your own is kept), the engine reports (`inkwall-engines-*` ConfigMaps), the `inkwall-bundle-reader` Role
and RoleBinding, and the operator's leader Lease. Engines still running keep their last bundle until
their pod restarts.
The CRDs, your `WAFPolicy` objects and the operator's Secrets (the bundle, its chunks and the signing
key) are kept, so a reinstall continues with the same keys. To remove the Secrets, delete the
namespace.

More in the [chart README](https://github.com/inkwall-dev/inkwall/tree/v0.5.0/deploy/helm/inkwall).
