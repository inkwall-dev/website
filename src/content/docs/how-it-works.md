---
title: How it works
description: The engine, its pipeline, what happens when inspection fails, and how proxies talk to it.
order: 2
---

Inkwall has two parts. The **engine** sits next to each proxy and decides, for every request,
whether it may pass. The **operator** turns the policies you write into configuration for the
engines and wires each proxy to its engine. The operator is never on the request path: if it is
down, engines keep enforcing the last policy they received.

![Clients reach the proxy, which asks the inkwall-engine sidecar for a verdict before forwarding allowed requests. The operator watches policies and routes and pushes signed policy bundles to the engine.](/diagrams/system-overview.svg)

## The engine

Every proxy integration feeds the same pipeline. Cheap checks run first, so most requests never
reach a regular expression: paths you skip are not inspected, oversized bodies are handled by
policy, and a bounded number of requests are inspected at once, so overload is answered at once
instead of queueing. The rules are the OWASP Core Rule Set, run by OWASP Coraza.

![The engine's adapters (reverse proxy, forward-auth, check API) share one pipeline: route table, body limits, admission, then Coraza with the Core Rule Set, with metrics and logs.](/diagrams/engine-internals.svg)

Inspection currently costs about 0.5 ms per request plus roughly 0.15 ms per request argument.
Benchmarks run against the base branch on every pull request, and a significant regression fails
the build.

## When inspection fails

A WAF has to decide what happens when it can't decide. Inkwall's answer depends on the mode:

![A request is routed, its size checked, and it waits for an inspection slot; rules then allow, deny or only log it. Timeouts, errors and overload end in inspect_failed: closed in block mode, open in detect mode.](/diagrams/verdict-lifecycle.svg)

- **Detect mode** never blocks. Requests that can't be inspected are allowed and logged.
- **Block mode** never forwards a request uninspected. A timeout, an error or overload gets a 503,
  unless you choose `failureMode: Open` for availability.

## How proxies talk to the engine

Each proxy uses its own native hook, so there is no extra proxy in the path.

**Traefik ForwardAuth.** Traefik sends a subrequest describing the client request; the engine
answers allow or deny before Traefik forwards anything.

![Traefik sends a forward-auth subrequest to the engine for each client request, and forwards the request to the app only when the engine allows it.](/diagrams/forward-auth.svg)

**The check API.** For proxies without a native protocol, `POST /v1/check` takes a description of
the request, in protobuf or JSON, and returns the verdict.

![The caller posts a CheckRequest to /v1/check and enforces the verdict in the CheckResponse.](/diagrams/check-api.svg)

**Reverse proxy.** Outside Kubernetes, or in front of a single service, the engine is the proxy:
it inspects the request, then forwards it or answers itself.

![The engine inspects the request, forwards allowed requests to the app, and answers denied or failed ones itself.](/diagrams/reverse-proxy.svg)

Envoy (`ext_proc`, `ext_authz`), ingress-nginx (a Lua plugin), HAProxy (SPOE) and Caddy (a module)
are planned; see the [roadmap](/docs/roadmap/).
