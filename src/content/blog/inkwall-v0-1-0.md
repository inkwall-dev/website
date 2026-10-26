---
title: Inkwall v0.1.0
description: The first release. Install with Helm, attach a WAFPolicy to a Traefik Ingress, and attacks are blocked.
date: 2026-10-27
author: The Inkwall team
---

Inkwall v0.1.0 is out. It's the first release: one operator, installed with Helm, that puts the
OWASP Core Rule Set in front of your Traefik routes.

```sh
helm install inkwall oci://ghcr.io/inkwall-dev/charts/inkwall --version 0.1.0 \
  --namespace inkwall-system --create-namespace
```

Attach a `WAFPolicy` to an `Ingress` that Traefik serves, and the operator does the rest: it injects
the engine into Traefik's pods, wires the route through it, and reports when every engine enforces
the policy. [Getting started](/docs/getting-started/) takes a few minutes.

## What's in it

- **The engine**: OWASP Coraza with the Core Rule Set v4, as a sidecar next to Traefik, a reverse
  proxy in front of any service, or behind any proxy through its check API.
- **The operator**: policies and rule sets validated when you save them; every policy compiled into
  a signed, versioned bundle and streamed to the engines, which swap policies without a restart;
  status from `Accepted` to `Ready`.
- **Safe failure**: detect mode never blocks; block mode never forwards a request it couldn't
  inspect. Engines keep enforcing while the operator is down, and new engines read the policy from
  the cluster. While a policy blocks, a proxy pod can't start without its engine, and `helm
  uninstall` unwires the routes before it goes.
- **A signed supply chain**: images for amd64 and arm64, the chart and the binaries, signed with
  cosign from the release workflow, with SBOM and build provenance.

## What it doesn't do yet

v0.1.0 protects Traefik `Ingress` routes. Traefik `IngressRoute`, signing key rotation and memory at
large policy counts come in v0.2.0; Gateway API `HTTPRoute` with Envoy Gateway in v0.3.0; a stable
API, out of `v1alpha1`, in v1.0.0. The [roadmap](/docs/roadmap/) has the details.

Try it, and tell us what breaks: [issues](https://github.com/inkwall-dev/inkwall/issues) are
welcome, and security reports go through
[private reporting](https://github.com/inkwall-dev/inkwall/security/advisories/new).
