---
title: Introducing Inkwall
description: Why we are building one web application firewall for every ingress, and where the project stands.
date: 2026-10-23
author: The Inkwall team
---

Running a web application firewall in Kubernetes usually means running one per proxy. ModSecurity
for ingress-nginx, a plugin for Traefik, a WASM filter for Envoy, an agent for HAProxy: each with
its own configuration language, its own copy of the rules and its own failure modes. When a team
moves from one ingress controller to another, the WAF is rebuilt from scratch.

Inkwall takes the opposite approach. There is one engine, built on
[OWASP Coraza](https://coraza.io/) and the [OWASP Core Rule Set](https://coreruleset.org/), and one
policy API. You write a `WAFPolicy` against an `Ingress` (Gateway API `HTTPRoute`s come later);
the operator finds the proxy that serves it and wires the engine in through that proxy's own hook.

## Principles

**Performance is part of the design.** The engine runs next to the proxy, inside its pod, and
skips what doesn't need inspection before any rule runs. Every pull request is benchmarked against
the branch it targets, and a significant regression fails the build.

**Failure behaviour is explicit.** In detect mode, nothing is ever blocked. In block mode, nothing is
forwarded uninspected: a request the engine can't inspect in time is rejected, so an attacker can't
pad a request until inspection gives up.

**Mistakes are caught early.** Rules are compiled when you save them, with the engine's own Coraza
version, and errors name the line. `inkwallctl test` replays a request or a whole browser session
against your rules before they reach production.

## Where we are

Inkwall is in early development and has no release yet. Today:

- the engine runs as a standalone reverse proxy, behind Traefik's ForwardAuth, and behind any proxy
  through its check API;
- the CRDs and the operator's validating webhook are in place;
- the OWASP CRS regression suite, about 4,500 tests, runs through the engine on every change.

Next is a full cycle on Traefik: apply a policy to an Ingress, and the operator injects the engine,
wires the middleware, ships the policy as a signed bundle and reports `Ready`. The first release
follows, with images and a Helm chart, and then the other proxies.

The code is on [GitHub](https://github.com/inkwall-dev/inkwall) under the Apache License 2.0. Design
feedback is very welcome.
