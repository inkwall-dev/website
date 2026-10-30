---
title: Key rotation
description: Replace the key policy bundles are signed with, now or on a schedule, without dropping a request.
order: 8
---

The operator signs every policy bundle with an Ed25519 key, generated on first use and kept in the
Secret `inkwall-bundle-signing-key` in its namespace. Engines accept a bundle only if it's signed by
a key in the `inkwall-trust` ConfigMap of their pod's namespace (`trusted-keys.pub`). The full guide
is [`docs/key-rotation.md`](https://github.com/inkwall-dev/inkwall/blob/v0.2.0/docs/key-rotation.md).

## How a rotation works

A rotation never signs with a key an engine doesn't trust yet:

1. **Publishing.** The operator adds the next key to every `inkwall-trust` ConfigMap; the old key
   still signs. Engines reread their keys without restarting. The operator waits until every
   connected engine reports the new key.
2. **Retiring.** The new key signs. The operator signs the current policies again as a new bundle
   version, and keeps the old key trusted until every connected engine runs a bundle the new key
   signed.
3. **Done.** The old key is removed. Only the new key is trusted.

Each phase lasts at least a minute, the time the kubelet takes to update a mounted ConfigMap.
Traffic is unaffected throughout, and your policies stay `Ready`.

## Before you start

- Every engine from 0.1.1 or later. An older engine never reports the new key, so the rotation waits
  for it: restart Traefik after upgrading the chart.
- An `InkwallConfig` named `default`. Without one, create it; an empty spec keeps every default:

  ```sh
  kubectl apply -f - <<'YAML'
  apiVersion: waf.inkwall.dev/v1alpha1
  kind: InkwallConfig
  metadata:
    name: default
  YAML
  ```

## Rotate now

Give the `InkwallConfig` a new value of the `waf.inkwall.dev/rotate-signing-key` annotation. Any
value works; each new value starts one rotation:

```sh
kubectl annotate inkwallconfig default --overwrite waf.inkwall.dev/rotate-signing-key="$(date +%s)"
```

If the `InkwallConfig` lives in Git, change the annotation there. The operator only reads it, so
your GitOps tool shows no drift.

## Rotate on a schedule

A key rotates once it has signed for `rotationInterval`, at least `1h`:

```yaml
apiVersion: waf.inkwall.dev/v1alpha1
kind: InkwallConfig
metadata:
  name: default
spec:
  signingKey:
    rotationInterval: 2160h # 90 days
```

Without it, the key rotates only when you ask.

## Check it worked

The phase on the Secret reads `Publishing`, then `Retiring`, then nothing:

```sh
kubectl -n inkwall-system get secret inkwall-bundle-signing-key \
  -o jsonpath='{.metadata.annotations.waf\.inkwall\.dev/rotation-phase}{"\n"}'
kubectl -n inkwall-system logs deploy/inkwall-operator | grep 'signing key rotation'
```

The leader logs each step, and while it waits, which engines it waits for (up to three).

## When a rotation waits

- **An engine older than 0.1.1** reports no keys. Restart its pod so it gets the current engine.
- **An engine you configured yourself**, outside a pod the operator injected, reads its keys from
  `--bundle-key`. During a rotation, copy the Secret's `trusted-keys.pub` into that file; the engine
  rereads it when it changes:

  ```sh
  kubectl -n inkwall-system get secret inkwall-bundle-signing-key \
    -o jsonpath='{.data.trusted-keys\.pub}' | base64 -d > trusted-keys.pub
  ```

- **An engine that rejects the new bundles**, for example one that was disconnected during the
  switch, logs `bundle rejected` and keeps enforcing the bundle it has. Restart its pod.

A rotation can't be stopped or reversed once it starts. To stop scheduled rotations, remove
`rotationInterval`. Don't edit or delete `inkwall-bundle-signing-key` by hand: the operator manages
it. A compromised key stays trusted until its rotation retires it, so restart engines that hold one
up.
