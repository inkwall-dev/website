---
title: Inkwall v0.3.0
description: Gateway API HTTPRoute targets with Traefik and Envoy Gateway, migrating from ingress-nginx, per-integration permissions, request counts, an operator that holds up at scale, and every security fix since 0.2.0.
date: 2026-11-01
author: The Inkwall team
---

Inkwall v0.3.0 is out. It protects Gateway API `HTTPRoute` routes, served by Traefik or by Envoy
Gateway, and includes every security fix since 0.2.0. Upgrade from 0.2.x after reading
[what needs action](#what-needs-action-on-upgrade):

```sh
helm upgrade inkwall oci://ghcr.io/inkwall-dev/charts/inkwall --version 0.3.0 \
  --namespace inkwall-system --reset-then-reuse-values
kubectl -n inkwall-system rollout status deployment/inkwall-operator
kubectl -n <traefik namespace> rollout restart deployment/<traefik>
```

## Security fixes

v0.3.0 includes the fixes of the two security releases since 0.2.0:

- **[GHSA-r5cq-6vq5-q8qg](https://github.com/inkwall-dev/inkwall/security/advisories/GHSA-r5cq-6vq5-q8qg)
  (high, fixed in 0.2.2, 0.1.5 and 0.3.0).** The operator gave read access to the policy bundle to
  every pod with a proxy's labels (Traefik's `app.kubernetes.io/name=traefik`), in any namespace,
  and accepted those pods' engines. A user who could create a pod in their own namespace could read
  every namespace's policies and rules, write text into every policy's status, and hold up a
  signing key rotation. They could not change what other proxies enforce, nor get traffic past
  inspection. The operator now treats a pod as a proxy's only in the proxy namespaces, the new
  chart value `injection.proxyNamespaces`: `traefik`, `kube-system` and, from 0.3.0,
  `envoy-gateway-system` by default.
- **[GHSA-r78f-635q-r8w2](https://github.com/inkwall-dev/inkwall/security/advisories/GHSA-r78f-635q-r8w2)
  (medium, fixed in 0.2.1, 0.1.4 and 0.3.0).** A batch of large security events could exceed the
  operator's message limit and be lost. Blocking was not affected.

The operator also bounds every field it takes from an engine: IDs and versions, the events per
message (1,000; the rest count as dropped) and a rejection's error (1 KiB). If you stay on 0.2 or
0.1 for now, upgrade to **0.2.2** or **0.1.5**.

## What's new

- **Gateway API `HTTPRoute` targets.** A `WAFPolicy` can target an `HTTPRoute`, or one of its rules
  with `sectionName`. With Traefik's Gateway API provider, the operator adds an `ExtensionRef`
  filter to its ForwardAuth middleware to each protected rule. With Envoy Gateway (v1.9), the engine
  joins the Envoy pods through the Gateway's `EnvoyProxy`, and each protected route gets an
  `EnvoyExtensionPolicy` whose ext_proc filter calls the engine on a Unix socket; Envoy Gateway
  rolls its pods itself. On routes whose policies are all in detect mode, Envoy doesn't wait for
  the engine. See [Policies](/docs/policies/).
- **Migrating from ingress-nginx.** `inkwallctl migrate ingress-nginx` converts ingress-nginx's
  ModSecurity annotations and ConfigMap settings into `WAFPolicy` objects, from files or the
  cluster, and marks what needs a human. With `--target httproute` or `--target ingressroute`, the
  policies target the routes replacing the Ingresses. See
  [Migrating from ingress-nginx](/docs/migrating-from-ingress-nginx/).
- **`inkwallctl test`** routes requests to policies that target `Ingress`, `IngressRoute` and
  `HTTPRoute` objects, and reads them strictly: a misspelled field is an error. See
  [Testing rules](/docs/testing-rules/).
- **Proxy discovery and per-integration permissions.** `InkwallConfig.status.proxies` lists the
  proxy controllers of the cluster's IngressClasses and GatewayClasses, and whether Inkwall wires
  their routes. Each integration has a `ClusterRole` of its own, chosen by the chart values
  `rbac.integrations.traefik` and `envoyGateway`. An integration whose permissions are missing is
  disabled (`IntegrationDisabled`) instead of stalling the others.
- **Request counts.** Engines count, per policy, the requests they allow, deny and detect, with
  their latency; the operator sends the totals to a connected
  [control plane](/docs/control-plane/). `Standalone`, the default, sends nothing.
- **An operator that holds up at scale.** A policy's status is written only when what it enforces
  changes: at 5,000 policies and 500 engines, a bundle reconcile went from 12 s to 0.4 s. The
  operator sets `GOMEMLIMIT` from its memory limit, and its median peak in that test went from 472
  to 409 MiB. Proxy pods are cached per integration, so custom selectors no longer make it cache
  every pod in the cluster. See [How it works](/docs/how-it-works/).

## What needs action on upgrade

- **Policies that already target an `HTTPRoute` start being enforced.** 0.2.x accepted these
  targets but left the policies `Accepted=False`. From 0.3.0, the HTTPRoutes Traefik or Envoy
  Gateway serves are wired and inspected in the policy's mode: check those policies' `mode` first.
- **Proxy namespaces.** From 0.2.0 or 0.2.1, only proxy pods in `injection.proxyNamespaces` get the
  engine. If your proxy runs elsewhere, add it, e.g.
  `--set 'injection.proxyNamespaces={ingress,envoy-gateway-system}'`. Otherwise `helm upgrade` stops
  and names the namespaces, rather than leaving the proxy's routes uninspected.
- **Restart Traefik** after the upgrade, so its pods run the 0.3.0 engine.
- **The `Enforced` condition's messages no longer count engines**, and `status.bundleVersion` is now
  the first bundle that enforces the policy as it is. Update alerts or scripts that parse them.
- **Remove `spec.engine.socketDir`** from your `InkwallConfig`: it never had an effect, and is
  deprecated.
- **For HTTPRoutes**, with Traefik, install the Gateway API CRDs and turn on its Gateway API
  provider; with Envoy Gateway, turn on its Backend API
  (`config.envoyGateway.extensionApis.enableBackend=true`).
- **With Argo CD or Flux**, set `rbac.integrations.*` and `injection.proxyNamespaces` explicitly in
  Git. See [GitOps](/docs/gitops/).

[Upgrading](/docs/upgrading/) has the details and how to roll back. To verify the images, the chart
and the checksums, use cosign v3 or later; see [Getting started](/docs/getting-started/).

## What's next

v1.0.0: a stable API, out of `v1alpha1`, with an upgrade path. The [roadmap](/docs/roadmap/) has the
details.

Tell us what breaks: [issues](https://github.com/inkwall-dev/inkwall/issues) are welcome, and
security reports go through
[private reporting](https://github.com/inkwall-dev/inkwall/security/advisories/new).
