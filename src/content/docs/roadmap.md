---
title: Roadmap
description: What is built, what is being built, and what comes before the first release.
order: 5
---

| Stage | What | Status |
|---|---|---|
| 1 | Engine: Coraza + Core Rule Set, tiered pipeline, reverse-proxy mode, benchmark harness | Done |
| 2 | Envoy integration (`ext_proc`, `ext_authz`, Envoy Gateway) | Planned |
| 3 | Traefik, ingress-nginx, HAProxy, Caddy | Traefik ForwardAuth works; the others are planned |
| 4 | Operator and Helm chart: discovery, injection, wiring, signed bundles, status | In progress |
| 5 | Optional control plane: multi-cluster policy and attack analytics | Later |

## Now: a full cycle on Traefik

The current work makes one path work end to end: apply a `WAFPolicy` to an Ingress served by
Traefik, and the operator injects the engine into Traefik's pods, wires the ForwardAuth
middleware, sends the policy to the engine as a signed bundle, and reports `Ready`.

1. CRDs and the validating webhook (done)
2. Bundle and agent API (done)
3. Resolver and bundle builder: policies and Ingresses into signed bundles (in review)
4. Bundle distribution to the engines, and the `Enforced` status
5. The engine's bundle client: per-route policies, applied without a restart
6. An end-to-end test on kind
7. Traefik discovery, sidecar injection and wiring

## Then: the first release

v0.1.0 adds what makes it installable: published engine and operator images, a Helm chart, and a
release workflow that builds images, chart and binaries from a tag. Then each further proxy
integration lands on the same operator.

Progress is tracked in the [operator proof-of-concept issue](https://github.com/inkwall-dev/inkwall/issues/28).
