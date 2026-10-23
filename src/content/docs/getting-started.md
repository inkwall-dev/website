---
title: Getting started
description: Run the engine in front of a service, then try it behind Traefik on a local kind cluster.
order: 1
---

> Inkwall has no release yet, so you build it from source. You need Go 1.26 and, for the Kubernetes
> part, Docker, [kind](https://kind.sigs.k8s.io/), kubectl and Helm.

```sh
git clone https://github.com/inkwall-dev/inkwall.git
cd inkwall
make build   # bin/inkwall-engine, bin/inkwallctl, bin/inkwall-operator
```

## The engine as a reverse proxy

The engine runs in front of any HTTP service and inspects every request with the OWASP Core Rule
Set, which is built into the binary:

```console
$ ./bin/inkwall-engine proxy --upstream http://localhost:3000 --mode block
$ curl -s -o /dev/null -w '%{http_code}\n' 'localhost:8480/?id=1%27%20OR%20%271%27%3D%271'
403
```

Each blocked or detected request produces one JSON log line with the matching rule IDs. Metrics are
on `:9480/metrics`, health on `:9480/healthz` and `:9480/readyz`.

The defaults are deliberately safe:

- **Detect mode** is the default: the engine logs what it would block and never blocks.
- In **block mode**, a request that can't be fully inspected (inspection timed out, failed, or the
  engine is overloaded) is rejected with 503, so padding a request until inspection times out
  can't get an attack through. `--failure-mode open` prefers availability instead.

Useful flags:

| Flag | Default | Purpose |
|---|---|---|
| `--mode` | `detect` | `block` to enforce |
| `--paranoia-level` | `1` | CRS paranoia level, 1–4 |
| `--max-body-bytes` | `65536` | Body bytes to inspect |
| `--rules` | | Your SecLang rules and exclusions, loaded after CRS |
| `--skip-paths` | | Paths never inspected, e.g. `/healthz,/static/*` |
| `--trusted-proxies` | | CIDRs whose `X-Forwarded-For` is trusted |
| `--timeout` | `250ms` | Inspection deadline per request |

`./bin/inkwall-engine proxy -h` lists them all.

## Behind Traefik, on kind

`make kind-up` creates a kind cluster with a demo app published twice: behind the engine's reverse
proxy on `127.0.0.1:30480`, and through Traefik with the engine as a ForwardAuth sidecar on
`127.0.0.1:30080`, both in block mode.

```sh
make kind-up     # create the cluster and deploy both paths
make kind-test   # send benign and attack requests through both, check every verdict
make kind-down   # delete the cluster
```

`make kind-test` checks, for both paths, that benign GET, query, JSON and form requests get 200,
and that SQL injection, XSS, path traversal, command injection and XSS in a JSON body get 403.

In the Traefik setup, `inkwall-engine forward-auth` runs in Traefik's pod and answers the
ForwardAuth middleware on `127.0.0.1:9001/v1/forward-auth`. Two middleware settings matter:

- `trustForwardHeader: false`, otherwise clients could make the engine inspect a URI of their
  choice;
- `forwardBody: true`, otherwise request bodies are not inspected.

Today the sidecar and middleware are written by hand
([`hack/kind`](https://github.com/inkwall-dev/inkwall/tree/main/hack/kind)). Wiring them from a
`WAFPolicy` is the operator's job, and is being built now.

## The policy API

The CRDs validate objects on their own, so you can try the API before the operator enforces
anything:

```sh
kubectl apply --server-side -f operator/config/crd/bases
kubectl apply --server-side -f operator/config/samples
kubectl get inkwall -A
```

See [Policies](/docs/policies/) for what a `WAFPolicy` can express.
