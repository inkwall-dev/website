---
title: Upgrading
description: Upgrade from 0.1.0 or 0.1.1 to 0.1.2, what changes by itself, and how to roll back.
order: 2
---

Upgrade to **0.1.2**: it fixes two security issues, one in 0.1.0 and one in 0.1.1. You need the
values you installed the chart with, and Helm 3.14 or later for `--reset-then-reuse-values`. The
full guide is [`docs/upgrading.md`](https://github.com/inkwall-dev/inkwall/blob/v0.1.2/docs/upgrading.md).

## Upgrade

1. Upgrade the chart, with the values you installed it with:

   ```sh
   helm upgrade inkwall oci://ghcr.io/inkwall-dev/charts/inkwall --version 0.1.2 \
     --namespace inkwall-system --reset-then-reuse-values
   ```

   `--reset-then-reuse-values` takes the new chart's defaults, then your values. Passing your values
   file again (`-f values.yaml`) works too. Prefer either to `--reuse-values`, which keeps the old
   values without the new defaults: from 0.1.0 it fails on 0.1.1 (`nil pointer evaluating interface
   {}.caBundle`); 0.1.2 defaults those values, so it renders.

   The chart upgrades the CRDs with it (`crds.install`, on by default). If you install the CRDs
   yourself, apply the new ones first:

   ```sh
   helm template inkwall oci://ghcr.io/inkwall-dev/charts/inkwall --version 0.1.2 \
     --show-only templates/crds.yaml | kubectl apply --server-side -f -
   ```

2. Wait for the operator:

   ```sh
   kubectl -n inkwall-system rollout status deployment/inkwall-operator
   ```

3. Restart Traefik, so its pods get the new engine:

   ```sh
   kubectl -n <traefik namespace> rollout restart deployment/<traefik>
   ```

If Argo CD or Flux installs the chart, change the chart version in Git instead; see
[GitOps](/docs/gitops/).

## What changes by itself, from 0.1.0

The CRDs get new fields, and no new kinds. Without any configuration, the upgrade:

- **Adds a finalizer to every `WAFPolicy`**, `waf.inkwall.dev/unwire`: a deleted policy waits until
  the operator has unwired its routes. With Argo CD or Flux, read [GitOps](/docs/gitops/).
- **Unwires routes when the engine can't be injected**: with `injection.enabled=false`, or when no
  running pod matches Traefik's selector, the operator removes its middleware from every route it
  wired and reports `Programmed=False` (`InjectionDisabled` or `SidecarMissing`). The routes keep
  working, uninspected. 0.1.0 left them wired.
- **Publishes the signing key in a new format**: `trusted-keys.pub`, the list of keys engines accept,
  next to `ed25519.pub`. The key doesn't change.
- **Adds an events buffer** to each operator pod, an `emptyDir` of `controlPlane.eventsBufferMiB`
  (64 MiB by default) + 16 MiB. It stays empty unless you connect a
  [control plane](/docs/control-plane/).

Nothing connects anywhere: the default mode, `Standalone`, never does. On Traefik v3.7 or later,
the ForwardAuth middleware also gets `maxResponseBodySize` (0.1.2).

Traefik pods keep their old engine until they restart. It keeps working, but it blocks a
[signing key rotation](/docs/key-rotation/): restart Traefik after the upgrade.

## Check it worked

```sh
helm -n inkwall-system list
kubectl get wafpolicy -A
kubectl -n <traefik namespace> get pods -l app.kubernetes.io/name=traefik \
  -o jsonpath='{range .items[*]}{.metadata.name} {.spec.initContainers[?(@.name=="inkwall-engine")].image}{"\n"}{end}'
```

The chart shows 0.1.2, the policies are `Ready`, and Traefik's pods run
`ghcr.io/inkwall-dev/inkwall-engine:0.1.2`.

## Roll back to 0.1.0

0.1.0 doesn't know the finalizer, `IngressRoute` targets, the control plane modes or key rotation.
Before `helm rollback`:

1. Switch back to `Standalone` if you changed the mode, and wait for any signing key rotation to
   finish (the `waf.inkwall.dev/rotation-phase` annotation on the Secret
   `inkwall-bundle-signing-key` is empty).
2. Delete the policies that target an `IngressRoute`.
3. Remove the finalizer from every policy, or none of them can be deleted under 0.1.0:

   ```sh
   kubectl get wafpolicy -A -o jsonpath='{range .items[*]}{.metadata.namespace} {.metadata.name}{"\n"}{end}' |
     while read -r ns name; do
       kubectl -n "$ns" patch wafpolicy "$name" --type merge -p '{"metadata":{"finalizers":null}}'
     done
   ```

Then roll back, and restart Traefik so its pods run the old engine again:

```sh
helm -n inkwall-system rollback inkwall
kubectl -n <traefik namespace> rollout restart deployment/<traefik>
```

Rolling back reopens the issues 0.1.1 and 0.1.2 fix; see the
[release post](/blog/inkwall-v0-1-2/).
