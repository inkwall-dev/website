---
title: Proxies
description: What Inkwall inspects through Traefik, Envoy Gateway, Istio, HAProxy, raw Envoy and the engine's own reverse proxy, and what each needs.
order: 2.5
---

One `WAFPolicy` works through every proxy, but each proxy's hook sees a different part of the
traffic. This page is v0.4.1's.

## What each proxy inspects

| | Requests | Bodies | Responses | gRPC message text | WebSocket handshake | WebSocket messages |
|---|---|---|---|---|---|---|
| Traefik (ForwardAuth) | Yes | Yes | No (`ResponsesNotInspected`) | Yes | Yes | No |
| Envoy Gateway (ext_proc) | Yes | Yes | Yes (`responses`) | Yes | Yes | No |
| Istio (ext_proc) | Yes | Yes | Not yet (`ResponsesNotInspected`) | Yes | Yes, as through Envoy Gateway | No |
| HAProxy (SPOE) | Yes | Up to HAProxy's buffer (about 15 KiB unless you raise `tune.bufsize`) | No | Yes, within the body sent | Yes | No |
| Raw Envoy (ext_proc) | Yes | Yes | Yes, when `envoy.yaml` sends them | Yes | Yes | No |
| `inkwall-engine proxy` | Yes | Yes | Not yet | Yes | Yes | Yes (`--websocket-messages`) |

gRPC message text is read only where the body reaches the engine, up to `body.maxBytes`, and only
when the policy asks for it ([gRPC](/docs/grpc/)). A WebSocket handshake that the rules or the
policy's `webSocket` deny gets 403 and no upgrade through every proxy; through Istio, no end-to-end
test covers WebSocket yet. A proxy that can't do what a policy asks never pretends to: the policy's
status says so.

## With the operator

- **Traefik** (since v0.1.0): `Ingress`, `IngressRoute` and, with its Gateway API provider,
  `HTTPRoute` routes. Traefik's pods get the engine when they start: restart Traefik after
  installing or upgrading Inkwall.
- **Envoy Gateway** (since v0.3.0, v1.9): `HTTPRoute` routes. The engine joins the Envoy pods through
  the Gateway's `EnvoyProxy`, and Envoy Gateway rolls them itself. Only Envoy Gateway sends
  responses to the engine, for policies with `responses.inspect`.
- **Istio** (since v0.4.0, Istio 1.28 or later): the `HTTPRoute` routes of its Gateways, and its
  `VirtualService` routes through its ingress gateways. For a Gateway, the operator adds the engine
  through the ConfigMap the Gateway names, and Istio rolls its pods; an ingress gateway's pods
  (labelled `istio: ingressgateway`) get the engine from the Pod webhook when they are created.
  See [Istio](https://github.com/inkwall-dev/inkwall/blob/v0.4.1/docs/istio.md).
- **The HAProxy Kubernetes Ingress Controller** (since v0.4.0, 3.1 or later): its `Ingress` routes.
  Its pods get the engine from the Pod webhook (restart them once Inkwall is installed), and each
  protected Ingress a backend snippet of its own. The policy is `Programmed` only once the
  operator's probe has proven the filter on every pod (`Unverified` until then). HAProxy sends the
  engine at most its buffer of a body (about 15 KiB by default): when a policy's `body.maxBytes` is
  larger, `Programmed`'s message names the limit, and a larger body is handled as oversized. Raise
  `tune.bufsize` in the controller ConfigMap's `global-config-snippet` to inspect more. See
  [HAProxy](https://github.com/inkwall-dev/inkwall/blob/v0.4.1/docs/haproxy.md#with-the-operator-haproxy-kubernetes-ingress-controller).

Each integration has a `ClusterRole` of its own, granted by a chart value
(`rbac.integrations.traefik`, `envoyGateway`, `istio`, `istioIngress`, `haproxy`, all `true` by
default), and only pods in the proxy namespaces get the engine; see [Operations](/docs/operations/).

## Without the operator

- **Raw Envoy** (since v0.4.0): an Envoy you configure yourself adds the ext_proc filter to its
  `envoy.yaml` and calls `inkwall-engine ext-proc` next to it. The policy comes from the engine's
  flags, or from the operator's bundles in a cluster with the operator. With
  `--inspect-responses`, it inspects responses too. See
  [protecting raw Envoy](https://github.com/inkwall-dev/inkwall/blob/v0.4.1/docs/raw-envoy.md).
- **HAProxy** (since v0.4.0, 3.1 or later): an HAProxy you configure yourself sends each request to
  `inkwall-engine spoe`, an agent of its Stream Processing Offload Engine, on `127.0.0.1:9004` or a
  Unix socket, and its rules act on the verdict. See
  [protecting HAProxy](https://github.com/inkwall-dev/inkwall/blob/v0.4.1/docs/haproxy.md).
- **The engine as a reverse proxy**: `inkwall-engine proxy` in front of any HTTP service, in or out
  of Kubernetes ([Getting started](/docs/getting-started/)).
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
SPOE are asked once per request, so they never see the messages. See
[WebSocket](https://github.com/inkwall-dev/inkwall/blob/v0.4.1/docs/websocket.md).
