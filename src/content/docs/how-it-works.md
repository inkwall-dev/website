---
title: How it works
description: The operator and the engine, what happens when inspection fails or the engine is unreachable, scale, and how Traefik, Envoy Gateway, Istio and HAProxy talk to the engine.
order: 3
---

Inkwall has two parts. The **engine** sits next to each proxy and decides, for every request,
whether it may pass. The **operator** turns the policies you write into configuration for the
engines and wires each proxy to its engine. The operator is never on the request path: if it is
down, engines keep enforcing the last policy they received.

## The operator

In v0.5.2, with Traefik, Envoy Gateway, Istio and the HAProxy Kubernetes Ingress Controller:

1. **Validates** policies and rule sets when you save them, compiling the rules with the engine's
   own Coraza version.
2. **Discovers** the proxies: the `InkwallConfig` named `default`, if you create one, lists in
   `status.proxies` the proxy controllers of the cluster's IngressClasses and GatewayClasses, and
   whether Inkwall wires their routes (`Full`, `Partial` or `Unsupported`).
3. **Injects** the engine as a sidecar: into Traefik's, Istio's ingress gateways' and the HAProxy
   controller's pods when they are created; into Envoy Gateway's Envoy pods through the Gateway's
   `EnvoyProxy`, and into Istio's Gateway pods through the ConfigMap the Gateway names, so Envoy
   Gateway and Istio roll them themselves. Only pods in the [proxy namespaces](/docs/operations/)
   get it. With `InkwallConfig.spec.engine.rollout: Automatic` (since 0.5.0), it also evicts the
   pods it injected that run an old engine, one at a time, so they get the new one.
4. **Wires** each route a policy targets. With Traefik, an `Ingress`, an `IngressRoute` or an
   `HTTPRoute` gets a ForwardAuth middleware that sends every request to the engine first, keeping
   your own middlewares (for an `HTTPRoute`, through an `ExtensionRef` filter). With Envoy Gateway,
   each `HTTPRoute` gets an `EnvoyExtensionPolicy` whose ext_proc filter calls the engine on a
   Unix socket. With Istio, an `EnvoyFilter` turns ext_proc on for the protected `HTTPRoute` and
   `VirtualService` routes. With the HAProxy controller, each `Ingress` gets a backend snippet that
   calls the engine's SPOE agent. Through HAProxy and Istio, the operator sends a signed probe
   through every pod to prove the filter is on the route before it says so. It unwires them when the policy is deleted, and when the engine can't be injected
   (injection off, or no proxy pod it would inject), so routes are never wired to an engine that
   isn't there.
5. **Builds a signed bundle** of every policy, and streams it to the engines, which verify the
   signature and swap policies without a restart. The signing key can be
   [rotated](/docs/key-rotation/) without dropping a request. The bundle is also kept in the
   Secret `inkwall-bundle`; past 900 KiB compressed, it is split into chunk Secrets, up to 7.2 MiB.
6. **Reports** each policy's status, up to `Enforced` by the engines that serve its routes. A
   policy's status is written only when it changes, so a proxy rollout doesn't rewrite every
   policy. The `InkwallConfig` reports the cluster's state: the bundle, the engines and the signing
   key; `inkwallctl status` reads it all ([Monitoring](/docs/monitoring/)).

Each proxy's wiring sits behind one integration interface, with a `ClusterRole` of its own. If the
operator lacks some of an integration's permissions, it disables that integration instead of
stalling the others; see [Operations](/docs/operations/).

An engine that starts while the operator is down reads the bundle from the cluster. An engine that
restarts inside a running pod enforces the bundle it cached from its first request. While a policy
is in block mode, a Traefik pod can't start without its engine; see [Operations](/docs/operations/).
Envoy Gateway's Envoy pods don't depend on the operator to start: their engine comes from the
`EnvoyProxy`. The operator can also connect the cluster to an optional
[control plane](/docs/control-plane/); by default it connects nowhere.

![Clients reach the proxy, which asks the inkwall-engine sidecar for a verdict before forwarding allowed requests. The operator watches policies and routes and pushes signed policy bundles to the engine.](/diagrams/system-overview.svg)

## At scale

The operator's scale test (`make scale-test`) runs it against fake engines on one machine, at up to
5,000 policies (50,000 routes) and 500 engines. The operator encodes each bundle once for every
engine, so its memory doesn't grow with them: before 0.2.0, 5,000 policies and 500 engines took
about 2 GiB.

In 0.3.0, a bundle writes the status of only the policies it changes, and `Enforced` is written
only when it changes, up to 8 at a time. At 5,000 policies and 500 engines, a bundle reconcile went
from 12 s to 0.4 s, and the slowest of 10 policy changes reached every engine in 3.9 to 4.6 s. The operator
also sets `GOMEMLIMIT` to 90% of its container's memory limit and no longer makes the allocations
that raised its peak: over 5 runs at that size, its median peak memory went from 472 to 409 MiB,
under the chart's default 512 MiB limit. In 0.4.0 it ran again with response inspection on, with
no difference.

In 0.5.0, the scale test also measures the wiring controller, with Istio VirtualServices on one
Gateway of three pods. Each reconcile now lists the Gateway's pods once instead of once per policy,
and a rollout of 5 pods writes each policy's status 4 times instead of 20. At 5,000 policies, which
didn't fit before (the ingress gateways' one `EnvoyFilter` passed etcd's size limit at about 1,200
VirtualServices; it is sharded now), every policy was wired in 22 s, a reconcile took 0.5 s, and the
operator peaked at 449 MiB. The measurements are in the
[operator design](https://github.com/inkwall-dev/inkwall/blob/v0.5.2/docs/design/0004-operator.md#8-scale-targets-v1).

## The engine

Every proxy integration (forward-auth for Traefik, ext_proc for Envoy Gateway, Istio and raw Envoy,
SPOE for HAProxy, the check API, the reverse proxy) feeds the same pipeline. Cheap checks run first, so most requests never
reach a regular expression: paths you skip are not inspected, a client on a policy's
[IP lists](/docs/policies/) is denied or let through before any rule, oversized bodies are handled
by policy, and a bounded number of requests are inspected at once, so overload is answered at once
instead of queueing. The rules are the OWASP Core Rule Set, run by OWASP Coraza. Since 0.5.0,
policies that differ only in their paranoia level, anomaly threshold or body limits share one
compiled Core Rule Set, about 2.1 MiB of memory less for each.

![The engine's adapters (reverse proxy, forward-auth, check API) share one pipeline: route table, body limits, admission, then Coraza with the Core Rule Set, with metrics and logs.](/diagrams/engine-internals.svg)

Inspection currently costs about 0.5 ms per request plus roughly 0.15 ms per request argument.
Benchmarks run against the base branch on every pull request, and a significant regression fails
the build. Engines also count, per policy, the requests they allow, deny and detect, with a latency
histogram; the operator sends the totals to a connected [control plane](/docs/control-plane/), and
nowhere in `Standalone` mode.

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

Through Istio, Envoy answers 503 when it can't reach the engine, or 504 for a hung one, in block
mode. Through the HAProxy controller, HAProxy answers 503 while the engine is down when every policy
on the Ingress fails closed (`Block` mode by default), and lets requests through uninspected
otherwise.

Through Envoy Gateway, Envoy answers 500 too when it can't reach the engine, unless every policy on
the route fails open (`failureMode: Open`, or detect mode without one): then it lets the request
through uninspected. When those policies are all in detect mode, Envoy doesn't wait for the engine
at all: it sends it a copy of the request (ext_proc's observability mode) and forwards it, so a slow
or hung engine delays nothing.

## How proxies talk to the engine

Each proxy uses its own native hook, so there is no extra proxy in the path.

**Traefik ForwardAuth.** Traefik sends a subrequest describing the client request; the engine
answers allow or deny before Traefik forwards anything. The middleware never trusts forwarded
headers from the client (`trustForwardHeader: false`), forwards the body for inspection, and, on
Traefik v3.7 or later, caps the size of the engine's answer (`maxResponseBodySize`, 64 KiB).
Behind a load balancer, see [Client IP](/docs/client-ip/).

![Traefik sends a forward-auth subrequest to the engine for each client request, and forwards the request to the app only when the engine allows it.](/diagrams/forward-auth.svg)

**Envoy Gateway ext_proc.** Envoy calls the engine (`inkwall-engine ext-proc`) over gRPC on a
Unix socket the two containers share, with Envoy's
[external processing](https://www.envoyproxy.io/docs/envoy/latest/configuration/http/http_filters/ext_proc_filter)
protocol. Envoy holds the request until the engine answers, with its body on routes whose policy
inspects bodies; an allowed request continues, a denied one gets the engine's answer (403, 413,
503...). Envoy waits 500 ms longer than the policy's `timeout`, for a hung engine. The engine
sees the request's real protocol (HTTP/1.1, HTTP/2, HTTP/3). For a policy with `responses.inspect`,
Envoy also sends the app's responses, and holds each until the engine answers: one that leaks is
replaced with 403 in block mode. That costs about 0.85 ms of engine CPU per KiB of response
inspected. Istio's Gateways and ingress gateways, and a raw Envoy you configure yourself, call the
engine the same way; since 0.5.0, Istio's filter sends responses too.

**HAProxy SPOE.** HAProxy's Stream Processing Offload Engine sends each request, with as much of
its body as HAProxy buffers (about 15 KiB by default), to `inkwall-engine spoe`, which answers with
a verdict that HAProxy's rules act on: 403, 413, 503, or a gRPC status for a gRPC call. The
operator writes those rules for the HAProxy Kubernetes Ingress Controller; for any other HAProxy,
you add them to `haproxy.cfg`.

**The check API.** For proxies without a native protocol, `POST /v1/check` takes a description of
the request, in protobuf or JSON, and returns the verdict.

![The caller posts a CheckRequest to /v1/check and enforces the verdict in the CheckResponse.](/diagrams/check-api.svg)

**Reverse proxy.** Outside Kubernetes, or in front of a single service, the engine is the proxy:
it inspects the request, then forwards it or answers itself. It forwards only what it inspected: a
request with an absolute-form target (`GET http://host/path`) or an invalid `Host` gets a 400.

![The engine inspects the request, forwards allowed requests to the app, and answers denied or failed ones itself.](/diagrams/reverse-proxy.svg)

What each proxy inspects (bodies, responses, gRPC messages, WebSocket handshakes and messages) is
on [Proxies](/docs/proxies/). Caddy (a module) and protecting LLM APIs come later; see the
[roadmap](/docs/roadmap/). ingress-nginx is retired upstream and not planned: see
[Migrating from ingress-nginx](/docs/migrating-from-ingress-nginx/).
