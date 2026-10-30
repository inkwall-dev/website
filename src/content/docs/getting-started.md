---
title: Getting started
description: Install Inkwall with Helm, protect a Traefik route, and check that attacks are blocked.
order: 1
---

> Inkwall v0.1.2 works with **Traefik**, and **`Ingress`** or **`IngressRoute`** routes. You need
> Kubernetes 1.29 or later, Helm 3, and Traefik in the cluster. The API is `v1alpha1` and will
> change. Upgrading from 0.1.0 or 0.1.1? See [Upgrading](/docs/upgrading/).

## Install

```sh
helm install inkwall oci://ghcr.io/inkwall-dev/charts/inkwall --version 0.1.2 \
  --namespace inkwall-system --create-namespace
```

Then install Traefik, or restart it if it already runs: Traefik pods started after the operator get
the engine as a sidecar.

```sh
kubectl -n <traefik namespace> rollout restart deployment/<traefik>
```

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

The operator adds its ForwardAuth middleware to the route and sends the policy to every engine.
The policy is `Ready` once it is wired and every engine runs it:

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
engine sees the [client's IP](/docs/client-ip/).

## Verify the release

Images, the chart and the binaries' checksums are signed keyless with cosign, from the release
workflow:

```sh
cosign verify ghcr.io/inkwall-dev/inkwall-engine:0.1.2 \
  --certificate-identity-regexp '^https://github.com/inkwall-dev/inkwall/\.github/workflows/release\.yaml@refs/tags/v' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

The images (`linux/amd64`, `linux/arm64`) also carry an SBOM and build provenance.

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
| `--rules` | | Your SecLang rules and exclusions, loaded after CRS |
| `--skip-paths` | | Paths never inspected, e.g. `/healthz,/static/*` |
| `--max-body-bytes` | `65536` | Body bytes inspected |
| `--failure-mode` | `auto` | Uninspectable requests: closed in block mode, open in detect mode |
| `--trusted-proxies` | | CIDRs whose `X-Forwarded-For` is trusted |

Each blocked or detected request logs one JSON line with the rule IDs; metrics are on
`:9480/metrics`. The proxy accepts only origin-form request targets (`GET /path`): an absolute-form
target (`GET http://host/path`) or an invalid `Host` gets a 400.

## Try it locally

From a clone of the [repository](https://github.com/inkwall-dev/inkwall), on a
[kind](https://kind.sigs.k8s.io/) cluster:

```sh
make kind-up     # a cluster with a demo app behind the engine and behind Traefik
make kind-e2e    # installs the operator and runs the end-to-end test
make kind-down
```
