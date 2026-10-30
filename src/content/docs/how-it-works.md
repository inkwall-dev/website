---
title: How it works
description: The operator and the engine, what happens when inspection fails or the engine is unreachable, scale, and how proxies talk to the engine.
order: 3
---

Inkwall has two parts. The **engine** sits next to each proxy and decides, for every request,
whether it may pass. The **operator** turns the policies you write into configuration for the
engines and wires each proxy to its engine. The operator is never on the request path: if it is
down, engines keep enforcing the last policy they received.

## The operator

In v0.2.0, with Traefik:

1. **Validates** policies and rule sets when you save them, compiling the rules with the engine's
   own Coraza version.
2. **Injects** the engine into Traefik's pods as a sidecar when they are created.
3. **Wires** each `Ingress` or `IngressRoute` a policy targets: it adds a ForwardAuth middleware
   that sends every request to the engine first, keeping your own middlewares. It unwires them when
   the policy is deleted, and when the engine can't be injected (injection off, or no Traefik pod
   it would inject), so routes are never wired to an engine that isn't there.
4. **Builds a signed bundle** of every policy, and streams it to the engines, which verify the
   signature and swap policies without a restart. The signing key can be
   [rotated](/docs/key-rotation/) without dropping a request. The bundle is also kept in the
   Secret `inkwall-bundle`; past 900 KiB compressed, it is split into chunk Secrets, up to 7.2 MiB.
5. **Reports** each policy's status, up to `Enforced` by every engine.

An engine that starts while the operator is down reads the bundle from the cluster. An engine that
restarts inside a running pod enforces the bundle it cached from its first request. While a policy
is in block mode, a Traefik pod can't start without its engine; see [Operations](/docs/operations/).
The operator can also connect the cluster to an optional [control plane](/docs/control-plane/);
by default it connects nowhere.

![Clients reach the proxy, which asks the inkwall-engine sidecar for a verdict before forwarding allowed requests. The operator watches policies and routes and pushes signed policy bundles to the engine.](/diagrams/system-overview.svg)

## At scale

The operator's scale test (`make scale-test`) runs it against fake engines on one machine. At
5,000 policies (50,000 routes) and 500 engines, its peak memory was 518 MiB, just over the 512 MiB
target and the chart's default limit, and a policy change reached every engine in 3.5 s (median of
10 edits, 6.2 s at most). With 50 engines, the same policies peaked at 507 MiB. The operator
encodes each bundle once for every engine, so its memory no longer grows with them: before 0.2.0,
5,000 policies and 500 engines took about 2 GiB. In other runs at that size, one change in ten took
24 to 28 s, for a reason not found yet. The measurements are in the
[operator design](https://github.com/inkwall-dev/inkwall/blob/v0.2.0/docs/design/0004-operator.md#8-scale-targets-v1).

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

The engine applies both, so they hold only while it answers. When Traefik can't reach the engine at
all, Traefik answers itself, in every mode, and nothing reaches the app:

| The engine | What Traefik's clients get |
|---|---|
| Crashed or restarting (connection refused) | 500 at once |
| Hung (no answer) | 500 after 30 s, Traefik's fixed timeout |
| Slower than the policy's `timeout` | The policy's failure mode: 503 in block mode, allowed in detect mode |

Traefik's ForwardAuth has no setting to let requests through when the engine is unreachable, or to
change that timeout ([traefik/traefik#9857](https://github.com/traefik/traefik/issues/9857)).
[Operations](/docs/operations/) covers what keeps such an outage short.

## How proxies talk to the engine

Each proxy uses its own native hook, so there is no extra proxy in the path.

**Traefik ForwardAuth.** Traefik sends a subrequest describing the client request; the engine
answers allow or deny before Traefik forwards anything. The middleware never trusts forwarded
headers from the client (`trustForwardHeader: false`), forwards the body for inspection, and, on
Traefik v3.7 or later, caps the size of the engine's answer (`maxResponseBodySize`, 64 KiB).
Behind a load balancer, see [Client IP](/docs/client-ip/).

![Traefik sends a forward-auth subrequest to the engine for each client request, and forwards the request to the app only when the engine allows it.](/diagrams/forward-auth.svg)

**The check API.** For proxies without a native protocol, `POST /v1/check` takes a description of
the request, in protobuf or JSON, and returns the verdict.

![The caller posts a CheckRequest to /v1/check and enforces the verdict in the CheckResponse.](/diagrams/check-api.svg)

**Reverse proxy.** Outside Kubernetes, or in front of a single service, the engine is the proxy:
it inspects the request, then forwards it or answers itself. It forwards only what it inspected: a
request with an absolute-form target (`GET http://host/path`) or an invalid `Host` gets a 400.

![The engine inspects the request, forwards allowed requests to the app, and answers denied or failed ones itself.](/diagrams/reverse-proxy.svg)

Gateway API `HTTPRoute` targets come next, with Traefik and with Envoy Gateway (`ext_proc`,
`ext_authz`), then ingress-nginx (a Lua plugin), HAProxy (SPOE) and Caddy (a module); see the
[roadmap](/docs/roadmap/).
