---
title: Operations
description: What happens when the operator is down, how to opt a proxy out, custom proxy labels, the emergency switch and uninstalling.
order: 5
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

## Emergency switch

`InkwallConfig.spec.suspend: true` makes every engine allow everything within seconds, without
removing anything. Set it back to `false` to enforce again.

## Uninstalling

```sh
helm uninstall inkwall --namespace inkwall-system
```

Before anything is deleted, the chart stops the operator and removes Inkwall's middleware from every
route it wired, keeping yours. The routes keep working, uninspected; Traefik pods drop the engine
when they restart. The CRDs and your `WAFPolicy` objects are kept.

More in the [chart README](https://github.com/inkwall-dev/inkwall/tree/main/deploy/helm/inkwall).
