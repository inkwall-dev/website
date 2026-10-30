---
title: Operations
description: What happens when the operator or the engine is down, bundle size, opting a proxy out, turning injection off, deleting policies, the emergency switch and uninstalling.
order: 6
---

## When the operator is down

Traffic is unaffected. Every engine keeps enforcing its last policy bundle, and an engine that
starts with no bundle reads it from the cluster (the `inkwall-bundle` Secret).

What depends on the operator is **creating proxy pods**:

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

## Bundle size

All of a cluster's policies go into one bundle, of at most 7.2 MiB compressed (and 64 MiB
decompressed). Up to 900 KiB, it is kept in the Secret `inkwall-bundle`; past that, in chunk
Secrets of 900 KiB, labelled `waf.inkwall.dev/bundle-chunk`. Bundles name the Core Rule Set rather
than embed it: the operator's scale test put 5,000 policies in 134 KiB.

Past 75% of the limit, the operator logs `bundle nears its size limit` when it publishes. Past the
limit, a change isn't published and every engine keeps the current bundle; the operator logs
`bundle not published`. The metric `inkwall_operator_bundle_compressed_bytes` shows the size.

## Traefik with other labels

The operator finds Traefik's pods by `app.kubernetes.io/name=traefik`. If yours carry other labels:

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
get the engine when they restart.

If the selector matches no running Traefik pod any more, new pods wouldn't get the engine, so the
operator unwires the routes (`SidecarMissing`) until one matches again.

## Turning injection off

```sh
helm upgrade inkwall oci://ghcr.io/inkwall-dev/charts/inkwall --version 0.2.0 \
  --namespace inkwall-system --reset-then-reuse-values --set injection.enabled=false
```

Traefik pods started from then on have no engine. The operator keeps running, unwires every route
it wired, deletes its middlewares and reports `Programmed=False` (`InjectionDisabled`): the routes
are served, uninspected. Turn it on again and the routes are wired again at once; restart Traefik
to inject the engine (`PendingRestart`).

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

## Uninstalling

```sh
helm uninstall inkwall --namespace inkwall-system
```

Before anything is deleted, the chart stops the operator, removes Inkwall's middleware from every
`Ingress` and `IngressRoute` it wired, keeping yours, and removes the finalizer from every
`WAFPolicy`. The routes keep working, uninspected; Traefik pods drop the engine when they restart.
The CRDs, your `WAFPolicy` objects and the operator's Secrets (the bundle, its chunks and the signing
key) are kept, so a reinstall continues with the same keys. To remove the Secrets, delete the
namespace.

More in the [chart README](https://github.com/inkwall-dev/inkwall/tree/v0.2.0/deploy/helm/inkwall).
