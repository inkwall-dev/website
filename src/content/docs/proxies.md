---
title: Proxies
description: What Inkwall inspects through Traefik, Envoy Gateway, Istio, HAProxy, raw Envoy and the engine's own reverse proxy, and what each needs.
order: 2.5
---

One `WAFPolicy` works through every proxy, but each proxy's hook sees a different part of the
traffic. This page is v0.6.0's.

## What each proxy inspects

| | Requests | Bodies | Responses | Streamed responses (SSE, gRPC) | gRPC message text | gRPC streams per message | WebSocket handshake | WebSocket messages |
|---|---|---|---|---|---|---|---|---|
| Traefik (ForwardAuth) | Yes | Yes | No (`ResponsesNotInspected`) | No | Yes | No (buffered) | Yes | No |
| Envoy Gateway (ext_proc) | Yes | Yes | Yes (`responses`) | Yes (`streams: Inspect`), new in 0.6.0 | Yes | Yes (`grpcStreams: PerMessage`), new in 0.6.0 | Yes | No |
| Raw Envoy (ext_proc) | Yes | Yes | Yes, when `envoy.yaml` sends them | Yes (`--response-streams inspect`), new in 0.6.0 | Yes | Yes (`--grpc-streams per-message`), new in 0.6.0 | Yes | No |
| Istio (ext_proc) | Yes | Yes | Yes (`responses`) | Yes (`streams: Inspect`), new in 0.6.0 | Yes | Yes (`grpcStreams: PerMessage`), new in 0.6.0 | Yes | No |
| HAProxy (SPOE) | Yes | Up to HAProxy's buffer (about 15 KiB unless you raise `tune.bufsize`); larger is oversized | Yes, up to HAProxy's buffer, new in 0.6.0 | No (`ResponsesNotInspected`) | Yes, within the body sent | No (buffered) | Yes | No |
| `inkwall-engine proxy` | Yes | Yes | Yes (`--inspect-responses`), new in 0.6.0 | Yes (`--response-streams inspect`), new in 0.6.0 | Yes, with `--h2c` or TLS for gRPC | No (buffered) | Yes | Yes (`--websocket-messages`) |

gRPC message text is read only where the body reaches the engine, up to `body.maxBytes`, and only
when the policy asks for it ([gRPC](/docs/grpc/)). A WebSocket handshake that the rules or the
policy's `webSocket` deny gets 403 and no upgrade through every proxy; since 0.5.0, the end-to-end
tests cover WebSocket and gRPC through Istio too. A gRPC response's status message (`grpc-message`)
is read through Envoy only. A proxy that can't do what a policy asks never pretends to: the policy's
status says so. What each proxy adds to a request's latency, measured, is on
[How it works](/docs/how-it-works/#measured).

## With the operator

- **Traefik** (since v0.1.0): `Ingress`, `IngressRoute` and, with its Gateway API provider,
  `HTTPRoute` routes. Traefik's pods get the engine when they start: restart Traefik after
  installing or upgrading Inkwall. Since 0.6.0, on Traefik v3.7 or later, the operator's
  `inkwall-waf` middleware is a chain of a Buffering middleware (`inkwall-waf-body`, which bounds
  request bodies at 10 MiB + 1) and the ForwardAuth (`inkwall-waf-auth`), which takes Traefik's
  added latency from about 8 ms to 1.3 ms; upgrade Traefik and its CRDs together. Traefik never
  sends the engine a response, so policies with `responses.inspect` are `ResponsesNotInspected` on
  its routes: to inspect responses behind Traefik, put the standalone engine in front of the app.
- **Envoy Gateway** (since v0.3.0, v1.9): `HTTPRoute` routes. The engine joins the Envoy pods through
  the Gateway's `EnvoyProxy`, and Envoy Gateway rolls them itself. It sends responses to the
  engine, for policies with `responses.inspect`.
- **Istio** (since v0.4.0, Istio 1.28 or later): the `HTTPRoute` routes of its Gateways, and its
  `VirtualService` routes through its ingress gateways. For a Gateway, the operator adds the engine
  through the ConfigMap the Gateway names, and Istio rolls its pods; an ingress gateway's pods
  (labelled `istio: ingressgateway`) get the engine from the Pod webhook when they are created.
  Since 0.5.0, it sends responses to the engine as Envoy Gateway does, and a route is `Programmed`
  only once the operator's signed probe has passed through every gateway pod, on every listener
  the route is served on (`Unverified` until then; `NotProbeable` for a route the probe can't
  reach). Since 0.6.0, routes in `Detect` mode are proven too, by the receipts the engine keeps of
  the probes it verified, and for a policy with `responses.inspect` the probe also proves that
  responses reach the engine. See [Istio](https://github.com/inkwall-dev/inkwall/blob/v0.6.1/docs/istio.md).
- **The HAProxy Kubernetes Ingress Controller** (since v0.4.0, 3.1 or later): its `Ingress` routes.
  Its pods get the engine from the Pod webhook (restart them once Inkwall is installed), and each
  protected Ingress a backend snippet of its own. The policy is `Programmed` only once the
  operator's probe has proven the filter on every pod (`Unverified` until then). HAProxy sends the
  engine at most its buffer of a body (about 15 KiB by default): when a policy's `body.maxBytes` is
  larger, `Programmed`'s message names the limit, and a larger body is handled as oversized. Raise
  `tune.bufsize` in the controller ConfigMap's `global-config-snippet` to inspect more. Since
  0.6.0, it sends responses to the engine for policies with `responses.inspect`, proven by the
  operator's probe on every pod (restart the controller's pods after upgrading, so their engine
  is injected with `--response-messages`), and a request or response too large for one SPOE
  frame gets 413 or 502 in `Block` mode, as `onOversize` says. See
  [HAProxy](https://github.com/inkwall-dev/inkwall/blob/v0.6.1/docs/haproxy.md#with-the-operator-haproxy-kubernetes-ingress-controller).

Each integration has a `ClusterRole` of its own, granted by a chart value
(`rbac.integrations.traefik`, `envoyGateway`, `istio`, `istioIngress`, `haproxy`, all `true` by
default), and only pods in the proxy namespaces get the engine; see [Operations](/docs/operations/).
Pods that started before Inkwall, or run an older engine, are `PendingRestart` until restarted:
with `InkwallConfig.spec.engine.rollout: Automatic` (since 0.5.0), the operator restarts the
Traefik, HAProxy and Istio ingress gateway pods it injects itself, one at a time.

## Without the operator

- **Raw Envoy** (since v0.4.0): an Envoy you configure yourself adds the ext_proc filter to its
  `envoy.yaml` and calls `inkwall-engine ext-proc` next to it. The policy comes from the engine's
  flags, or from the operator's bundles in a cluster with the operator. With
  `--inspect-responses`, it inspects responses too; since 0.6.0, `--response-streams inspect`
  inspects streamed ones event by event and `--grpc-streams per-message` each message of a gRPC
  call. See
  [protecting raw Envoy](https://github.com/inkwall-dev/inkwall/blob/v0.6.1/docs/raw-envoy.md).
- **HAProxy** (since v0.4.0, 3.1 or later): an HAProxy you configure yourself sends each request to
  `inkwall-engine spoe`, an agent of its Stream Processing Offload Engine, on `127.0.0.1:9004` or a
  Unix socket, and its rules act on the verdict. Since 0.6.0, `--inspect-responses` and the
  example configuration's `inkwall-response` group inspect responses too. See
  [protecting HAProxy](https://github.com/inkwall-dev/inkwall/blob/v0.6.1/docs/haproxy.md).
- **The engine as a reverse proxy**: `inkwall-engine proxy` in front of any HTTP service, in or out
  of Kubernetes ([Getting started](/docs/getting-started/)). Since 0.5.0 it speaks HTTP/2 and gRPC
  on both sides, reloads its rules without a restart, and limits long-lived connections. Since
  0.6.0, `--inspect-responses` inspects the upstream's responses, and `--response-streams inspect`
  streamed ones event by event.
- **Any proxy with a hook**: `POST /v1/check` takes a description of the request and returns the
  verdict ([How it works](/docs/how-it-works/)).

## WebSocket

A WebSocket starts with an HTTP request, the handshake, which every proxy above sends to the engine
before it upgrades the connection: its URL and headers are inspected by the rules, and the policy's
`webSocket` field can allow only your own origins and require headers
([Policies](/docs/policies/)). The Core Rule Set raises nothing on a browser's
handshake.

The messages after the upgrade are inspected only by the engine's own reverse proxy, with
`inkwall-engine proxy --websocket-messages inspect` (or `text-only`): each text message a client
sends, up to `--max-body-bytes`, and in `block` mode a denied one closes the WebSocket with 1008
before the app gets it. Envoy's ext_proc could see the messages only in a streamed mode, where
Envoy holds the handshake until the client's first frame, which a client sends only after the
upgrade; inspecting them through Envoy needs a change in Envoy
([#313](https://github.com/inkwall-dev/inkwall/issues/313)). Traefik's ForwardAuth and HAProxy's
SPOE are asked once per request, so they never see the messages. Since 0.5.0, each message is
scored on its own, not on top of the handshake's score: fewer false positives, and about a third
less work per message. `--websocket-idle-timeout` closes idle WebSockets, and on shutdown the
proxy closes them with `1001`. See
[WebSocket](https://github.com/inkwall-dev/inkwall/blob/v0.6.1/docs/websocket.md).
