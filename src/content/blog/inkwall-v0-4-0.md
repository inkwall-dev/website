---
title: Inkwall v0.4.0
description: Istio, HAProxy and raw Envoy; response inspection through Envoy Gateway; the text in gRPC messages; WebSocket handshake rules; and an honest status when an engine is too old.
date: 2026-11-04
author: The Inkwall team
---

Inkwall v0.4.0 is out. One `WAFPolicy` now protects routes served by Traefik, Envoy Gateway, Istio
and the HAProxy Kubernetes Ingress Controller, and an Envoy or HAProxy you configure yourself can
call the engine too. Upgrade from 0.3.x after reading [what needs action](#what-needs-action-on-upgrade):

```sh
helm upgrade inkwall oci://ghcr.io/inkwall-dev/charts/inkwall --version 0.4.0 \
  --namespace inkwall-system --reset-then-reuse-values
kubectl -n inkwall-system rollout status deployment/inkwall-operator
kubectl -n <traefik namespace> rollout restart deployment/<traefik>
```

## More proxies

- **Istio** (1.28 or later): the `HTTPRoute` routes of its Gateways, and `VirtualService` targets
  (`group: networking.istio.io`) served by its ingress gateways. For a Gateway, the operator adds
  the engine through the ConfigMap the Gateway names, and an `EnvoyFilter` sends the protected
  routes to it; an ingress gateway's pods get the engine from the Pod webhook.
- **HAProxy** (3.1 or later): `inkwall-engine spoe` is an agent of HAProxy's Stream Processing
  Offload Engine. The operator wires the HAProxy Kubernetes Ingress Controller's Ingresses: their
  pods get the engine, each Ingress a backend snippet of its own, and the policy is `Programmed`
  only once the operator's probe has proven the filter on every pod. When a policy's
  `body.maxBytes` is more than HAProxy's buffer lets the engine see (about 15 KiB by default), the
  status says so and names the limit.
- **Raw Envoy**: an Envoy you configure yourself calls `inkwall-engine ext-proc`, with the policy
  from the engine's flags or from the operator.

[Proxies](/docs/proxies/) has what each of them inspects, side by side.

## Response inspection

`responses: {inspect: true}` on a policy inspects what the app answers, for data leaks: the Core
Rule Set's `RESPONSE-95x` rules find SQL errors, stack traces and directory listings. In `Block`
mode a response that leaks is replaced with 403. It works through Envoy Gateway, and through raw
Envoy with `--inspect-responses`. Traefik's ForwardAuth never sees responses, and Istio's filter
doesn't send them yet: on those routes such a policy is `Programmed=False`
(`ResponsesNotInspected`), while their requests are still inspected.

It isn't free: about 0.85 ms of engine CPU per KiB of response, so about 55 ms for a 64 KiB page,
within the default 250 ms deadline. In our load test through Envoy Gateway, a route of 15 KB HTML
pages went from 4,218 to 527 requests per second with 8 clients once its responses were inspected.
Turn it on where leaks matter, and measure.

## gRPC

- A denied call is answered as gRPC: `grpc-status` 7 (`PERMISSION_DENIED`) and a message naming
  the request ID.
- `body.grpcMessages: Inspect` has the rules read the text in a call's messages, read as protobuf
  without their schema, each text field a form argument named by its field numbers. It's off by
  default: random binary fields sometimes look like an attack (about 1 message in 10,000 with four
  short random fields, at paranoia level 1). Try it in `Detect` mode first.
- gRPC-Web text calls are inspected as gRPC calls, instead of being denied.

See [gRPC](/docs/grpc/).

## WebSocket

A policy's `webSocket` allows handshakes only from your own origins, against cross-site WebSocket
hijacking, and can require headers. Through every proxy, the handshake's URL and headers are
inspected, and a denied one gets 403 before the upgrade. The messages after it are inspected only
when the engine is the proxy itself (`inkwall-engine proxy --websocket-messages inspect`): through
Envoy, that needs a change in Envoy's `ext_proc`
([#313](https://github.com/inkwall-dev/inkwall/issues/313)), and Traefik and HAProxy ask the engine
once per request. See [Proxies](/docs/proxies/).

## Status that doesn't overclaim

An engine before 0.4.0 ignores the new fields. While one runs a policy that sets `webSocket`,
`body.grpcMessages: Inspect` or `responses`, the policy is `Enforced=False`, reason
`EnginesOutdated`, naming the engine. Restart the proxy's pods, and it's `Enforced` again.

## What needs action on upgrade

- **New `ClusterRole`s**, granted by default: `inkwall-operator-istio`,
  `inkwall-operator-istio-ingress` and `inkwall-operator-haproxy`, with the chart values
  `rbac.integrations.istio`, `istioIngress` and `haproxy`.
- **New default proxy namespaces:** `istio-ingress`, `istio-system` and `haproxy-controller`. If you
  set `injection.proxyNamespaces` yourself, add the ones you need.
- **New Pod webhooks** for Istio's ingress gateways (`istio: ingressgateway`) and the HAProxy
  controller's pods. While a policy is in `Block` mode, those pods can't start while the operator is
  down, as Traefik's.
- **gRPC denials are HTTP 200** through Envoy Gateway, raw Envoy and the engine's reverse proxy, as
  any gRPC error; through Traefik they stay 403. Update dashboards that count denials by 403.
- **Restart Traefik** (and the HAProxy controller and Istio's ingress gateways, if they ran before)
  so their engines are 0.4.0.

The [upgrade guide](/docs/upgrading/) has the details.

## What's next

v1.0.0 takes the CRDs out of `v1alpha1`. After that: WebSocket messages through Envoy, responses
through Traefik and Istio, and protecting LLM APIs. See the [roadmap](/docs/roadmap/).
