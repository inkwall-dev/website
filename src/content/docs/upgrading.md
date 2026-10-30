---
title: Upgrading
description: Upgrade from 0.1.x to 0.2.0, what changes by itself, and how to roll back.
order: 2
---

Upgrade to **0.2.0** from any 0.1 release. 0.2.0 and 0.1.3 fix a security issue in 0.1.0 to 0.1.2,
[GHSA-9x6c-5v2m-835r](https://github.com/inkwall-dev/inkwall/security/advisories/GHSA-9x6c-5v2m-835r).
You need the values you installed the chart with, and Helm 3.14 or later for
`--reset-then-reuse-values`. The full guide is
[`docs/upgrading.md`](https://github.com/inkwall-dev/inkwall/blob/v0.2.0/docs/upgrading.md).

## Upgrade

1. Upgrade the chart, with the values you installed it with:

   ```sh
   helm upgrade inkwall oci://ghcr.io/inkwall-dev/charts/inkwall --version 0.2.0 \
     --namespace inkwall-system --reset-then-reuse-values
   ```

   `--reset-then-reuse-values` takes the new chart's defaults, then your values. Passing your values
   file again (`-f values.yaml`) works too. Prefer either to `--reuse-values`, which keeps the old
   values without the new defaults. 0.2.0 adds no chart values, and since 0.1.2 the chart defaults
   the `controlPlane` values that made `--reuse-values` fail from 0.1.0
   (`nil pointer evaluating interface {}.caBundle`), so it renders too.

   The chart upgrades the CRDs with it (`crds.install`, on by default). If you install the CRDs
   yourself, apply the new ones first:

   ```sh
   helm template inkwall oci://ghcr.io/inkwall-dev/charts/inkwall --version 0.2.0 \
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

   The security fix is in the engine: it applies once Traefik's pods have restarted.

If Argo CD or Flux installs the chart, change the chart version in Git instead; see
[GitOps](/docs/gitops/).

## What changes by itself, from 0.1.1, 0.1.2 or 0.1.3

The CRDs and the chart's values don't change. Without any configuration, the upgrade:

- **Splits large bundles into chunk Secrets.** A bundle of up to 900 KiB compressed stays in the
  Secret `inkwall-bundle`, as before. A larger one is split into Secrets of 900 KiB
  (`inkwall-bundle-a-0`, ... or `inkwall-bundle-b-0`, ..., labelled `waf.inkwall.dev/bundle-chunk`),
  at most 8 of them: 7.2 MiB compressed. The operator lets the engines read the chunks (the Role
  `inkwall-bundle-reader`). Policies past that limit aren't published, and the current bundle
  stays.
- **Holds less memory with many engines.** The operator encodes each bundle once for every engine,
  and keeps reading an engine's heartbeats while a send to it waits, so engines aren't disconnected
  when many get a bundle at once.
- **Starts engines with their cached bundle.** A restarted engine applies the bundle it already has
  before it answers Traefik. While it loads, Traefik answers 500; before, the engine allowed
  requests uninspected for about 0.1 s
  ([GHSA-9x6c-5v2m-835r](https://github.com/inkwall-dev/inkwall/security/advisories/GHSA-9x6c-5v2m-835r)).

Traefik pods keep their old engine until they restart. It keeps working with the new operator,
except that an engine from 0.1.x can't read a bundle split into chunks, and refuses a bundle over
4 MiB decompressed: it keeps the bundle it has. Restart Traefik after the upgrade.

## From 0.1.0

The upgrade from 0.1.0 also brings what 0.1.1 changed. The CRDs get new fields, and no new kinds,
and the upgrade:

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
the ForwardAuth middleware also gets `maxResponseBodySize`. Until its pod restarts, a 0.1.0 engine
also holds up any [signing key rotation](/docs/key-rotation/).

## Check it worked

```sh
helm -n inkwall-system list
kubectl get wafpolicy -A
kubectl -n <traefik namespace> get pods -l app.kubernetes.io/name=traefik \
  -o jsonpath='{range .items[*]}{.metadata.name} {.spec.initContainers[?(@.name=="inkwall-engine")].image}{"\n"}{end}'
```

The chart shows 0.2.0, the policies are `Ready`, and Traefik's pods run
`ghcr.io/inkwall-dev/inkwall-engine:0.2.0`.

## Roll back

Before `helm rollback` to 0.1.x, check that the bundle isn't split into chunks:

```sh
kubectl -n inkwall-system get secret -l waf.inkwall.dev/bundle-chunk
```

0.1.x reads and writes only a bundle in one Secret, of at most 900 KiB compressed. With chunks, its
operator can't read the bundle and builds none: shrink the policies until the chunks are gone (the
operator deletes them), or stay on 0.2.0.

Rolling back to 0.1.0 also needs:

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

Rolling back to 0.1.2 or earlier reopens GHSA-9x6c-5v2m-835r; see the
[release post](/blog/inkwall-v0-2-0/).
