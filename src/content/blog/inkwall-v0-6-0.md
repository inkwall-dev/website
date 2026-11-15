---
title: Inkwall v0.6.0, one WAF for six proxies, measured
description: Inkwall is a Kubernetes-native web application firewall, OWASP Coraza and the Core Rule Set behind Traefik, Envoy Gateway, Istio, HAProxy, raw Envoy or its own reverse proxy. v0.6.0 inspects responses through HAProxy and the reverse proxy, streams event by event, explains its denials, and comes with the latency, false positives and soak results we measured.
date: 2026-11-15 # set to the tag's date when v0.6.0 is released
author: The Inkwall team
---

Inkwall is a web application firewall for Kubernetes. You install one operator; it puts an
inspection engine next to the proxy that serves your routes, wires it in through that proxy's own
hook, and enforces the `WAFPolicy` objects you attach to the routes. The engine runs
[OWASP Coraza](https://coraza.io/) with the [OWASP Core Rule Set](https://coreruleset.org/) (CRS)
v4. It is open source, under the Apache License 2.0.

v0.6.0 is the release we are announcing it with. This post is for anyone meeting Inkwall for the
first time: what it does, which proxies it works with, how we tested it and what we measured, and
how to try it in five minutes. If you run 0.5 already, [what's new](#whats-new-in-060) and
[upgrading](#upgrading-from-05) are below.

## Why

Running a WAF in Kubernetes usually means running one per proxy: ModSecurity for ingress-nginx, a
plugin for Traefik, a WASM filter for Envoy, an agent for HAProxy, each with its own configuration,
its own copy of the rules and its own failure modes. Change your ingress, and you rebuild your WAF.

Inkwall makes the WAF one Kubernetes API. The same policy protects a route whichever proxy serves
it:

```yaml
apiVersion: waf.inkwall.dev/v1alpha1
kind: WAFPolicy
metadata: {name: web, namespace: shop}
spec:
  targetRefs: [{kind: Ingress, name: web}]
  mode: Detect            # log first; Block enforces
  ruleSets:
  - ref: {kind: ClusterWAFRuleSet, name: owasp-crs-v4}
    paranoiaLevel: 1
```

```console
$ kubectl get wafpolicy -n shop
NAME   MODE    READY   REASON   BUNDLE   AGE
web    Block   True    Ready    2        3s
```

## Which proxies

| Proxy | Routes | Hook |
|---|---|---|
| Traefik | `Ingress`, `IngressRoute`, Gateway API `HTTPRoute` | ForwardAuth |
| Envoy Gateway | `HTTPRoute` | ext_proc |
| Istio | `HTTPRoute` of its Gateways, `VirtualService` of its ingress gateways | ext_proc |
| HAProxy Kubernetes Ingress Controller | `Ingress` | SPOE |
| Envoy or HAProxy you configure yourself | your configuration | ext_proc, SPOE |
| `inkwall-engine proxy` | anything HTTP, in or out of Kubernetes | reverse proxy |

What each one can inspect differs, because each hook sees a different part of the traffic: Traefik's
ForwardAuth never sees a response, for example. [Proxies](/docs/proxies/) has the full table, and
Inkwall never claims more than its proxy shows it.

## What it's built on

- **Status that doesn't lie.** A policy is `Ready` only when it is valid, every proxy pod sends its
  routes to the engine, and every engine that serves them runs it. Through Istio and HAProxy, the
  operator sends a signed probe through every pod to prove it, responses included. A policy whose
  proxy can't do what it asks says so (`ResponsesNotInspected`, `EnginesOutdated`), instead of
  looking protected.
- **Fail safe by default.** New policies start in `Detect` mode, which never blocks. In `Block`
  mode nothing is forwarded uninspected: a request that can't be inspected in time is refused.
- **Mistakes caught when you save.** Rule sets are compiled by the operator's webhook with the
  engine's own Coraza version, so a typo is a `kubectl` error with a line number, not an outage.
  `inkwallctl test` replays a request, a raw HTTP file or a browser HAR against your policy, in CI.
- **The operator is never on the request path.** It builds a signed bundle of every policy and
  streams it to the engines; if it is down, they keep enforcing the last one, and a restarted
  engine enforces its cached bundle from its first request.
- **Everything works offline.** The objects in Git are the source of truth, with health checks for
  Argo CD and Flux.

## How we tested it, and what we measured

Before this release we ran a battle test on purpose small enough to repeat on a laptop. The tools
are in the repository ([battle test](https://github.com/inkwall-dev/inkwall/blob/v0.6.0/CONTRIBUTING.md#battle-test)),
so you can run them on your own machine and against your own traffic.

### Latency added per proxy

`make kind-response-load`: 8 concurrent clients for 20 s per run, after a 3 s warm-up, fetch an
nginx HTML page of about 1 KB or 15 KB through each proxy with a `Block`-mode policy, and the same
proxy without a policy is the baseline (for the standalone proxy, the app directly). One kind node
(Kubernetes v1.34.11), one replica of each proxy, the client on the host: a 12th Gen Intel Core
i7-1255U laptop, 12 CPUs, 15 GiB. Added p50 / p99:

| Proxy | Requests inspected, 1 KB | 15 KB | Responses inspected too, 1 KB | 15 KB |
|---|---|---|---|---|
| Traefik | +1.36 / +3.86 ms | +1.27 / +2.91 ms | n/a (no responses) | n/a |
| Envoy Gateway | +1.22 / +2.77 ms | +1.38 / +3.00 ms | +2.47 / +4.82 ms | +15.57 / +20.28 ms |
| Istio | +1.82 / +3.60 ms | +2.09 / +3.69 ms | +2.95 / +6.40 ms | +16.47 / +24.77 ms |
| HAProxy | +1.00 / +3.23 ms | +0.95 / +2.80 ms | +1.73 / +3.86 ms | +15.57 / +23.11 ms |
| Raw Envoy | +1.28 / +3.24 ms | +1.37 / +2.92 ms | +2.50 / +5.24 ms | +16.14 / +21.90 ms |
| `inkwall-engine proxy` | +0.96 / +2.91 ms | +1.15 / +4.32 ms | +1.79 / +3.98 ms | +15.39 / +20.76 ms |

Inspecting requests adds about 1 to 2 ms at p50 and 3 to 4 ms at p99, whatever the proxy, and each
engine peaked at 102 to 107 MiB of memory. The first run of this test found Traefik at +8.4 ms: its
ForwardAuth allocated its 10 MiB body limit for every request. That is fixed in this release (on
Traefik v3.7 or later), and the table is the run after the fix.

Inspecting a response is the expensive part, and we'd rather say so: the engine reads the body
before the client gets any of it, about 1 ms per KiB of HTML at this load, so a 15 KB page takes
about 15 ms more. Turn it on for the routes that can leak (APIs, error pages), not for every
static page.

### False positives

A WAF that blocks your users is worse than none, so we measured how often the CRS, untuned,
blocks a real application's benign traffic. `make fp-run` replays 560 requests recorded from
[OWASP Juice Shop](https://github.com/juice-shop/juice-shop), an online shop with an Angular front
end and a REST API, played by six scripted shoppers with six browsers' headers: they register, log
in, search, write reviews with apostrophes and accents, fill a basket, check out, upload a
complaint and a photo, and change their passwords. Every request is benign, so every denial is a
false positive. The policy is the built-in CRS in `Block` mode with nothing excluded:

| Paranoia level | Denied | Rate | With `crs.allowedMethods` set |
|---|---|---|---|
| 1 (the default) | 23 of 560 | 4.11% | 1 (0.18%) |
| 2 | 46 | 8.21% | 28 (5.00%) |
| 3 | 65 | 11.61% | 49 (8.75%) |
| 4 | 108 | 19.29% | 96 (17.14%) |

At level 1, 22 of the 23 denials are one rule, 911100, method enforcement: the shop's REST API
uses `PUT` and `DELETE`, which the CRS refuses unless you allow them. One line on the policy,
`crs: {allowedMethods: [GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS]}`, which any REST API needs,
leaves 1 in 560. Higher paranoia levels flag more benign text (SQL-like phrases in checkout and
feedback bodies, accented characters), which is why level 1 is the default, and why every policy
should start in `Detect` mode: `inkwallctl tune` reads its events and suggests the narrowest
exclusions, and `inkwallctl explain` says why any one request was denied.

### Soak with chaos

`make kind-soak`: the six proxies on one kind cluster, each with steady clean and attack traffic,
for 5 hours, while every 15 minutes one thing breaks in turn: the operator's leader is killed, an
engine is killed, a proxy's pod is deleted, the API server is stopped, the bundle distribution is
cut. Each must recover within 5 minutes, and throughout, no attack may reach the app and no policy
may claim protection a canary request shows isn't there.

<!-- SOAK: fill after the 5 h soak ends -->

### And on every change

The OWASP CRS regression suite runs through every adapter; each proxy has an end-to-end test on
kind; upgrades are tested from each supported release; the parsers are fuzzed nightly; scale tests
run the operator with 5,000 policies and 500 engines; and a release tag without green CI is
refused. Images, the chart and the binaries are signed, with SBOMs and build provenance.

## Try it

The [quickstart](https://github.com/inkwall-dev/inkwall/blob/v0.6.0/docs/quickstart.md) goes from
nothing to a blocked attack in about five minutes, with Docker, kind, kubectl and Helm:

```sh
kind create cluster --name inkwall-quickstart
helm install inkwall oci://ghcr.io/inkwall-dev/charts/inkwall --version 0.6.0 \
  --namespace inkwall-system --create-namespace
kubectl -n inkwall-system rollout status deployment/inkwall-operator --timeout=3m
helm repo add traefik https://traefik.github.io/charts
helm install traefik traefik/traefik --version 42.3.2 --namespace traefik --create-namespace
kubectl -n traefik rollout status deployment/traefik --timeout=3m
kubectl apply -k 'https://github.com/inkwall-dev/inkwall//examples/traefik?ref=v0.6.0'
kubectl -n shop wait wafpolicy/web --for=condition=Ready --timeout=3m
```

Send it a SQL injection, see it logged in `Detect` mode, switch the policy to `Block` and see it
denied; the quickstart has each step. [`examples/`](https://github.com/inkwall-dev/inkwall/tree/v0.6.0/examples)
has the same app behind Envoy Gateway, Istio and HAProxy, and [Getting started](/docs/getting-started/)
covers a real cluster and the engine on its own, without Kubernetes:

```sh
inkwall-engine proxy --upstream http://localhost:3000 --mode block
```

## What's new in 0.6.0

- **Responses through HAProxy and the standalone proxy.** A policy with `responses.inspect` now has
  its HAProxy Ingresses' responses inspected for data leaks (SQL errors, stack traces, directory
  listings), as through Envoy Gateway and Istio, and so does `inkwall-engine proxy
  --inspect-responses`. Only Traefik can't: its ForwardAuth never sees a response.
- **Streamed responses, event by event.** With `responses.streams: Inspect`, each Server-Sent Event
  and each message of a gRPC response is inspected on its own, through Envoy Gateway, Istio, raw
  Envoy and the standalone proxy; in `Block` mode a leaking event ends the stream.
- **gRPC streams, one message at a time.** `body.grpcStreams: PerMessage` inspects each message of a
  call as it arrives, through Envoy, so long client streams and bidirectional calls work in `Block`
  mode; a gRPC server's messages and its status message can be inspected too ([gRPC](/docs/grpc/)).
- **The probe proves responses**, and `Detect`-mode Istio routes are proven by the engine's
  receipts of the probe, so they are `Programmed` instead of `Unverified`.
- **`inkwallctl explain`** says why a policy isn't `Ready` and why a request was denied, with the
  narrowest exclusion, checked; **`inkwallctl mcp`** serves the same answers to an AI assistant,
  read-only, from your machine ([Monitoring](/docs/monitoring/)).
- **Traefik adds about 1.3 ms instead of 8 ms**, on Traefik v3.7 or later.
- **Rule sets before the CRS** (`placement: BeforeCRS`), the **operator's metrics over HTTPS**,
  HAProxy requests and responses past one SPOE frame handled as oversized, `WAFIPList` in Managed
  mode, and the Go memory limit from the container's cgroup.

## Upgrading from 0.5

Upgrade the chart (try it with `--dry-run` first), upgrade Traefik and its CRDs together to v3.7
or later if you run Traefik, then restart the proxies whose pods run the engine, or let
`spec.engine.rollout: Automatic` do it:

```sh
helm upgrade inkwall oci://ghcr.io/inkwall-dev/charts/inkwall --version 0.6.0 \
  --namespace inkwall-system --reset-then-reuse-values --dry-run
helm upgrade inkwall oci://ghcr.io/inkwall-dev/charts/inkwall --version 0.6.0 \
  --namespace inkwall-system --reset-then-reuse-values
kubectl -n inkwall-system rollout status deployment/inkwall-operator
kubectl -n <traefik namespace> rollout restart deployment/<traefik>
```

What needs a look:

- **Traefik v3.7+**: the operator's `inkwall-waf` Middleware becomes a chain of two new ones,
  `inkwall-waf-body` and `inkwall-waf-auth`; a request body over 10 MiB + 1 now gets 413 instead
  of 401. After a rollback to 0.5.x the two stay behind, unused: the
  [upgrade guide](/docs/upgrading/#rolling-back-to-05x) has the command that removes them.
- **The probe reaches your app** for policies with `responses.inspect` on Istio and HAProxy, in
  `Block` mode too: a `GET` with `User-Agent: inkwall-operator-probe` on a reserved
  `.well-known/inkwall-probe/` path, every 5 minutes per pod. Your app can answer 404.
- **The HAProxy controller's pods** need a restart before its responses are inspected.
- **Metrics over HTTPS** is off by default; bind the `inkwall-operator-metrics-reader` ClusterRole
  to Prometheus first if you turn it on.

The [upgrade guide](/docs/upgrading/) has the rest. 0.6, 0.5 and 0.4 get fixes; 0.3 is out of
support.

## What's next

v1.0.0 takes the API out of `v1alpha1`, with an upgrade path and a compatibility promise. After it:
WebSocket messages through Envoy, gRPC messages read with their schema, Caddy, and protecting LLM
APIs. See the [roadmap](/docs/roadmap/).

Inkwall is on [GitHub](https://github.com/inkwall-dev/inkwall). Try it on your own traffic, run
`make fp-run` with your own HAR, and tell us what it got wrong.
