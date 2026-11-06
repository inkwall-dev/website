---
title: Roadmap
description: What each release ships, from v0.1.0 to v0.4.1, and what the next milestones bring.
order: 11
---

Each release is a [milestone on GitHub](https://github.com/inkwall-dev/inkwall/milestones), with
its issues.

## v0.1.0: the first release

- **Engine**: OWASP Coraza with the Core Rule Set v4; reverse proxy, Traefik ForwardAuth and the
  `/v1/check` API; detect and block modes, explicit failure behaviour; `inkwallctl test` and
  `bench`.
- **Operator**: `WAFPolicy` and rule set CRDs validated when saved; signed, versioned policy bundles
  pushed to every engine; the engine injected into Traefik's pods; `Ingress` routes wired;
  `Accepted` → `Programmed` → `Enforced` → `Ready` status.
- **Resilience**: engines keep enforcing without the operator, and start from the cluster's bundle;
  proxy pods can't start without the engine while a policy blocks; uninstall unwires the routes
  first.
- **Release**: images for amd64 and arm64, a Helm chart on GHCR and binaries, all signed, with SBOM
  and provenance.

## v0.1.1 to v0.1.3

Three security releases. 0.1.1 also brought most of the v0.2.0 work forward
([release post](/blog/inkwall-v0-1-2/)):

- Traefik `IngressRoute` targets, not only `Ingress`.
- [Rotating the bundle signing key](/docs/key-rotation/) without dropping a request.
- [`inkwallctl test`](/docs/testing-rules/) against `WAFPolicy` objects or a
  cluster's bundle, for CI.
- Unwiring with a finalizer: when a policy is deleted, when injection is turned off, or when no
  Traefik pod would get the engine.
- The operator side of an optional [control plane](/docs/control-plane/): enrollment, a read-only
  GitOps mirror, Managed mode, and security events forwarded with a disk buffer.
- The ForwardAuth middleware caps the engine's answer (`maxResponseBodySize`); guides for
  [GitOps](/docs/gitops/) and the [client IP](/docs/client-ip/) behind a load balancer.
- Fixes for [GHSA-p4pw-j2x6-qhvj](https://github.com/inkwall-dev/inkwall/security/advisories/GHSA-p4pw-j2x6-qhvj)
  and [GHSA-jq3g-jfmx-62m4](https://github.com/inkwall-dev/inkwall/security/advisories/GHSA-jq3g-jfmx-62m4)
  (0.1.1, 0.1.2), and
  [GHSA-9x6c-5v2m-835r](https://github.com/inkwall-dev/inkwall/security/advisories/GHSA-9x6c-5v2m-835r)
  (0.1.3).

## v0.2.0: hardening

The rest of the milestone ([release post](/blog/inkwall-v0-2-0/)):

- Bundles past 900 KiB compressed split into chunk Secrets, up to 7.2 MiB.
- An operator that holds up with many policies and engines: each bundle encoded once for every
  engine, and engine streams kept alive while a send waits. A scale test with fake engines measures
  it, up to 5,000 policies and 500 engines ([How it works](/docs/how-it-works/)).
- [What Traefik does when the engine is unreachable](/docs/operations/), measured, tested and
  documented: a 500, in every mode.
- A restarted engine enforces its cached bundle from its first request (the fix for
  GHSA-9x6c-5v2m-835r, also in 0.1.3).
- Nightly fuzzing of the request, bundle and event parsers; an upgrade test from the last release;
  a faster end-to-end CI.
- Docs: an index, a glossary, guides for [testing policies](/docs/testing-rules/) and the
  standalone proxy, and a writing pass over the guides and design documents.

## v0.2.1, v0.2.2 and v0.1.4, v0.1.5

Security releases:
[GHSA-r78f-635q-r8w2](https://github.com/inkwall-dev/inkwall/security/advisories/GHSA-r78f-635q-r8w2)
(0.2.1, 0.1.4), security events lost when a batch of large events exceeded a message limit; and
[GHSA-r5cq-6vq5-q8qg](https://github.com/inkwall-dev/inkwall/security/advisories/GHSA-r5cq-6vq5-q8qg)
(0.2.2, 0.1.5), a pod with a proxy's labels in any namespace could read the policy bundle and
connect as an engine. Proxy pods are now recognised only in the proxy namespaces,
`injection.proxyNamespaces`.

## v0.3.0: Gateway API

The milestone ([release post](/blog/inkwall-v0-3-0/)):

- Gateway API `HTTPRoute` targets, with Traefik's Gateway API provider (an `ExtensionRef` filter to
  the ForwardAuth middleware) and with Envoy Gateway (the engine called over `ext_proc`), down to
  one rule with `sectionName`.
- Proxy discovery behind one integration interface: `InkwallConfig.status.proxies`, and a
  `ClusterRole` per integration, disabled on its own when its permissions are missing.
- Engine request counts and latency per policy, sent to the optional control plane.
- An operator that holds up with thousands of policies: statuses written only when they change
  (a bundle reconcile at 5,000 policies and 500 engines went from 12 s to 0.4 s), proxy pods cached
  per integration, and `GOMEMLIMIT` set from its memory limit.
- `inkwallctl`: [migrating from ingress-nginx](/docs/migrating-from-ingress-nginx/) ModSecurity
  annotations to `WAFPolicy`, also onto the `HTTPRoute` or `IngressRoute` objects replacing the
  Ingresses, and testing policies that target `IngressRoute` and `HTTPRoute` objects.

## v0.3.2: WebSockets through Envoy

A fix-only patch release ([release post](/blog/inkwall-v0-3-2/)): WebSocket handshakes through
Envoy Gateway are decided on their headers and upgrade, instead of being held until a timeout
(`Block`) or logged as oversized (`Detect`). The messages after the upgrade aren't inspected.

## v0.3.1: gRPC calls and honest status

A patch release ([release post](/blog/inkwall-v0-3-1/)):

- [gRPC](/docs/grpc/) calls are no longer denied: their path, query and metadata are inspected,
  their messages not yet.
- Status never claims protection that isn't there: policies report a suspended cluster
  (`Suspended`) and a bundle too large to publish (`BundleTooLarge`), and Envoy Gateway routes
  aren't `Programmed` while the operator can't raise Envoy's buffer limit for them.
- Suspending works when the bundle is too large; `helm uninstall` leaves nothing behind; a
  `version` command in `inkwallctl`, `inkwall-engine` and `inkwall-operator`.

## v0.4.0: more proxies, responses, gRPC and WebSockets

The milestone ([release post](/blog/inkwall-v0-4-0/)):

- [Istio](/docs/proxies/): the `HTTPRoute` routes of its Gateways, and its
  `VirtualService` routes through its ingress gateways, over the same `ext_proc` adapter as Envoy
  Gateway.
- HAProxy, through an SPOE agent (`inkwall-engine spoe`), and the HAProxy Kubernetes Ingress
  Controller wired by the operator, `Programmed` only once a probe has proven the filter on every
  pod.
- Raw Envoy: an Envoy you configure yourself calls the engine's `ext_proc` adapter.
- Response inspection through Envoy Gateway, for data leaks ([Policies](/docs/policies/)).
- [gRPC](/docs/grpc/): the text in the messages, opt-in; a gRPC status on a denial; gRPC-Web text.
- WebSocket: handshake rules (allowed origins, required headers) through every proxy, and the
  messages inspected by the engine's own reverse proxy ([Proxies](/docs/proxies/)).
- Status says when an engine is too old for a policy's fields (`EnginesOutdated`).

## v0.4.1 and v0.3.3: security fixes

Security releases for the 0.4 and 0.3 lines ([release post](/blog/inkwall-v0-4-1-and-v0-3-3/)):

- [GHSA-xw38-cv4f-qp3p](https://github.com/inkwall-dev/inkwall/security/advisories/GHSA-xw38-cv4f-qp3p)
  (high, both): a rule set could use SecLang operators that run a program (`@inspectFile`) or make
  a DNS query (`@rbl`) in the shared engine. Both are now rejected, and never run.
- [GHSA-5hq9-fpvm-jrpq](https://github.com/inkwall-dev/inkwall/security/advisories/GHSA-5hq9-fpvm-jrpq)
  (medium, 0.4.1): through ext_proc, the response to a request asking for a WebSocket upgrade
  skipped response inspection when the upstream answered with an ordinary response.
- [GHSA-3rgj-wvpm-3rrp](https://github.com/inkwall-dev/inkwall/security/advisories/GHSA-3rgj-wvpm-3rrp)
  (low, both): path exclusions applied to ambiguous request paths that a backend may route outside
  the excluded prefix.
- [GHSA-rjqr-wjvm-f27f](https://github.com/inkwall-dev/inkwall/security/advisories/GHSA-rjqr-wjvm-f27f)
  (low, both): the standalone proxy inspected headers that it then didn't forward.

Both also set the engine's Go memory limit from its container's, and keep only the inspected part of
a large body through ext_proc.

## v1.0.0: a stable API

The CRDs out of `v1alpha1`, with an upgrade path and a compatibility promise.

## Later

- WebSocket messages through Envoy (Envoy Gateway, Istio, raw Envoy), which needs a change in
  Envoy's `ext_proc` ([#313](https://github.com/inkwall-dev/inkwall/issues/313)).
- Responses through Traefik and Istio, and streamed responses
  ([#323](https://github.com/inkwall-dev/inkwall/issues/323)).
- Protecting LLM APIs against the OWASP Top 10 for LLM applications
  ([#277](https://github.com/inkwall-dev/inkwall/issues/277)).
- Caddy (a module).

ingress-nginx is not planned: it is retired upstream. For its users, Inkwall's answer is
migration: `inkwallctl migrate ingress-nginx` turns its ModSecurity annotations into policies, see
[Migrating from ingress-nginx](/docs/migrating-from-ingress-nginx/).
