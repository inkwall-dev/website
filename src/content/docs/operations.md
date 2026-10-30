---
title: Operations
description: What happens when the operator is down, opting a proxy out, turning injection off, deleting policies, the emergency switch and uninstalling.
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
helm upgrade inkwall oci://ghcr.io/inkwall-dev/charts/inkwall --version 0.1.2 \
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
The CRDs, your `WAFPolicy` objects and the signing key Secrets are kept, so a reinstall continues
with the same keys.

More in the [chart README](https://github.com/inkwall-dev/inkwall/tree/v0.1.2/deploy/helm/inkwall).
