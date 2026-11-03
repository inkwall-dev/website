---
title: Getting started
description: Install Inkwall with Helm, protect a Traefik or Envoy Gateway route, and check that attacks are blocked.
order: 1
---

> Inkwall v0.3.1 works with **Traefik**, and its **`Ingress`**, **`IngressRoute`** and Gateway API
> **`HTTPRoute`** routes, and with **Envoy Gateway** and its `HTTPRoute` routes. You need
> Kubernetes 1.29 or later, Helm 3, and Traefik or Envoy Gateway in the cluster. The API is
> `v1alpha1` and will change. Upgrading from 0.2.x? See [Upgrading](/docs/upgrading/).

## Install

```sh
helm install inkwall oci://ghcr.io/inkwall-dev/charts/inkwall --version 0.3.1 \
  --namespace inkwall-system --create-namespace
kubectl -n inkwall-system rollout status deployment/inkwall-operator
```

Then install Traefik, or restart it if it already runs: Traefik pods started after the operator get
the engine as a sidecar.

```sh
kubectl -n <traefik namespace> rollout restart deployment/<traefik>
```

For `HTTPRoute` targets served by Traefik, install the
[Gateway API CRDs](https://gateway-api.sigs.k8s.io/guides/getting-started/#installing-gateway-api)
and turn on Traefik's Gateway API provider (`providers.kubernetesGateway.enabled=true` in its
chart).

Envoy Gateway (v1.9) needs no restart: it rolls the Envoy pods of a Gateway when the Gateway gets
its first protected route. Turn on its Backend API, which the engine's socket needs:

```sh
helm upgrade --install eg oci://docker.io/envoyproxy/gateway-helm --version v1.9.3 \
  --namespace envoy-gateway-system --create-namespace \
  --set config.envoyGateway.extensionApis.enableBackend=true
```

Only proxy pods in the chart's proxy namespaces get the engine: `traefik`, `kube-system` and
`envoy-gateway-system` by default. If your proxy runs elsewhere, list its namespace in
`injection.proxyNamespaces`, e.g. `--set 'injection.proxyNamespaces={ingress,envoy-gateway-system}'`;
see [Operations](/docs/operations/).

## Protect a route

Attach a `WAFPolicy` to an `Ingress` that Traefik serves, or to a Traefik `IngressRoute`
(`{group: traefik.io, kind: IngressRoute, name: web}`):

```yaml
apiVersion: waf.inkwall.dev/v1alpha1
kind: WAFPolicy
metadata:
  name: web
  namespace: shop
spec:
  targetRefs: [{kind: Ingress, name: web}]
  mode: Block   # the default, Detect, logs and never blocks
```

For an `HTTPRoute`, served by Traefik or Envoy Gateway, target it with its group, and optionally
one of its rules: `{group: gateway.networking.k8s.io, kind: HTTPRoute, name: web, sectionName: api}`.
One policy can target routes of both proxies. Traefik wires an HTTPRoute only when every Gateway
it is attached to is Traefik's, so give each proxy its own HTTPRoute.

With Traefik, the operator adds its ForwardAuth middleware to the route; with Envoy Gateway, it
gives the route an `EnvoyExtensionPolicy` whose ext_proc filter calls the engine. It sends the
policy to every engine. The policy is `Ready` once it is wired and every engine runs it:

```console
$ kubectl get wafpolicy -n shop
NAME   MODE    READY   BUNDLE   AGE
web    Block   True    2        3s
$ curl -s -o /dev/null -w '%{http_code}\n' -H 'Host: shop.example.com' \
    "http://$TRAEFIK/?id=1%27%20OR%20%271%27%3D%271"
403
```

Start in `Detect` mode, check the logs for false positives, tune them with
[exclusions](/docs/policies/), then switch to `Block`. Behind a cloud load balancer, make sure the
engine sees the [client's IP](/docs/client-ip/). Coming from ingress-nginx with ModSecurity?
`inkwallctl migrate ingress-nginx` converts its annotations into policies: see
[Migrating from ingress-nginx](/docs/migrating-from-ingress-nginx/).

## Verify the release

Images, the chart and the binaries' checksums are signed keyless with cosign, from the release
workflow. Verify them with cosign v3 or later: cosign v2 reports `no signatures found`.

```sh
cosign verify ghcr.io/inkwall-dev/inkwall-engine:0.3.1 \
  --certificate-identity-regexp '^https://github.com/inkwall-dev/inkwall/\.github/workflows/release\.yaml@refs/tags/v' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

The images (`linux/amd64`, `linux/arm64`) also carry an SBOM and build provenance. `inkwallctl
version`, `inkwall-engine version` and `inkwall-operator version` (or `--version`) print the
release, the commit and the Go version each was built with.

## Without Kubernetes

The engine is also a reverse proxy in front of any HTTP service. Get `inkwall-engine` from the
[releases page](https://github.com/inkwall-dev/inkwall/releases):

```console
$ inkwall-engine proxy --upstream http://localhost:3000 --mode block
$ curl -s -o /dev/null -w '%{http_code}\n' 'localhost:8480/?id=1%27%20OR%20%271%27%3D%271'
403
```

Main flags (`inkwall-engine proxy -h` for all):

| Flag | Default | Purpose |
|---|---|---|
| `--mode` | `detect` | `block` to enforce |
| `--paranoia-level` | `1` | CRS paranoia level, 1–4 |
| `--rules`, `--rules-before-crs` | | Your SecLang rules and exclusions, loaded after or before CRS |
| `--skip-paths`, `--skip-body-paths` | | Paths not inspected at all, or without their body, e.g. `/healthz,/static/*` |
| `--disable-rule-groups` | | CRS attack families the app can't be vulnerable to, e.g. `php,java` |
| `--max-body-bytes` | `65536` | Body bytes inspected |
| `--failure-mode` | `auto` | Uninspectable requests: closed in block mode, open in detect mode |
| `--trusted-proxies` | | CIDRs whose `X-Forwarded-For` is trusted |
| `--listen`, `--admin-listen` | `:8480`, `:9480` | Proxy address; address of `/metrics`, `/healthz` and `/readyz` |

Each blocked or detected request logs one JSON line with the rule IDs; metrics are on
`:9480/metrics`. The proxy accepts only origin-form request targets (`GET /path`): an absolute-form
target (`GET http://host/path`) or an invalid `Host` gets a 400. The guide,
[running the engine without Kubernetes](https://github.com/inkwall-dev/inkwall/blob/v0.3.1/docs/standalone-proxy.md),
also covers the engine's `forward-auth`, `check` and `ext-proc` modes (Envoy's external
processing API over gRPC).

## Try it locally

From a clone of the [repository](https://github.com/inkwall-dev/inkwall), on a
[kind](https://kind.sigs.k8s.io/) cluster:

```sh
make kind-up     # a cluster with a demo app behind the engine and behind Traefik
make kind-e2e    # installs the operator and runs the end-to-end test
make kind-down
```
