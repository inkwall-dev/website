---
title: Client IP
description: Get the client's real address to the engine behind a load balancer, with the PROXY protocol, externalTrafficPolicy Local, or trusted proxies behind an HTTP load balancer.
order: 9
---

Behind a load balancer, Traefik sees the load balancer, or a node, as its peer, and so does the
engine, unless the client's address reaches Traefik. A wrong client IP is worse than none: rules
that match on the address would see the load balancer, [IP lists](/docs/policies/) would match it,
and every security event would carry its address. With Envoy Gateway, see
[Envoy Gateway](#envoy-gateway); behind an HTTP load balancer that adds `X-Forwarded-For`, such as
an AWS ALB, see [Behind an HTTP load balancer](#behind-an-http-load-balancer). The full guide, with
more load balancers, is
[`docs/client-ip.md`](https://github.com/inkwall-dev/inkwall/blob/v0.5.0/docs/client-ip.md).

## How the address reaches the engine

1. Traefik learns the client's address: from the PROXY protocol, or as the TCP peer when nothing
   rewrites it (`externalTrafficPolicy: Local`).
2. The ForwardAuth middleware the operator creates (`trustForwardHeader: false`) sends Traefik's view
   of the client to the engine as `X-Forwarded-For`, replacing any the client sent.
3. The injected engine trusts `X-Forwarded-For` only from Traefik, its loopback peer.

No Inkwall setting is needed: configure Traefik and the load balancer.

An `X-Forwarded-For` added by an HTTP load balancer doesn't help: the engine would see it only with
`trustForwardHeader: true`, and then Traefik also keeps a client-sent `X-Forwarded-Uri`, so the
engine would inspect a URI the attacker chose. The operator always sets `false`.

## The PROXY protocol (recommended)

The load balancer opens each connection to Traefik with a PROXY header carrying the client's
address. It works for HTTP and TLS alike. With Traefik's Helm chart:

```yaml
ports:
  web:
    proxyProtocol:
      trustedIPs: ["10.0.0.0/16"]   # the load balancer's addresses only
  websecure:
    proxyProtocol:
      trustedIPs: ["10.0.0.0/16"]
```

- Trust only the load balancer's CIDRs, or the nodes' when kube-proxy forwards from them
  (`externalTrafficPolicy: Cluster`, the default). Never `0.0.0.0/0` and never `insecure: true`:
  anyone who reaches Traefik could then claim any address.
- Enable it on Traefik first, then on the load balancer: Traefik still accepts connections without
  the header.

Then turn it on at the load balancer, on Traefik's Service (`service.annotations` in its chart):

| Load balancer | PROXY header |
|---|---|
| AWS NLB (AWS Load Balancer Controller) | `service.beta.kubernetes.io/aws-load-balancer-proxy-protocol: "*"` |
| DigitalOcean | `service.beta.kubernetes.io/do-loadbalancer-enable-proxy-protocol: "true"` |
| Hetzner Cloud | `load-balancer.hetzner.cloud/uses-proxyprotocol: "true"` |
| HAProxy in front of the cluster | `send-proxy-v2` on the `server` line of a `mode tcp` backend |

Check them against your provider's current docs.

## `externalTrafficPolicy: Local`

Passthrough load balancers (GKE's `LoadBalancer` Services, Azure Load Balancer) and MetalLB or
kube-vip send no PROXY header but keep the client's address. Set, on Traefik's Service:

```yaml
service:
  spec:
    externalTrafficPolicy: Local
```

kube-proxy then delivers only to Traefik pods on the node that received the packet, without
rewriting the source. Nodes without a ready Traefik pod drop the traffic, so run Traefik on every
node that takes traffic, or spread it.

## Envoy Gateway

Through Envoy Gateway, the engine runs in each Envoy pod and gets the request from Envoy's ext_proc
filter on a Unix socket, which it trusts as a loopback peer. Envoy sets `X-Forwarded-For` before
the filter runs, ending with the address of its own TCP peer. So, as with Traefik, Envoy must see
the client as its peer: turn the PROXY protocol on in a `ClientTrafficPolicy` for the Gateway, or
set `externalTrafficPolicy: Local` on the Envoy Service through your `EnvoyProxy`, as Envoy
Gateway's [client traffic policy](https://gateway.envoyproxy.io/docs/tasks/traffic/client-traffic-policy/)
docs show.

Envoy Gateway applies one `ClientTrafficPolicy` per Gateway. For a Gateway that has none of yours,
the operator creates its own, `inkwall-waf-<gateway>`, which raises Envoy's buffer limit so the
engine gets whole bodies; it deletes it once you add yours. Your `connection.bufferLimit` then caps
the bodies inspected: set it to at least the largest `body.maxBytes` of your policies (Envoy's
default buffer is 32 KiB). Below that, larger bodies are handled as oversized (`body.onOversize`),
and the policy's `Programmed` condition is `WiringFailed`, naming your `ClientTrafficPolicy`. While
the operator can't create or update its own (an admission policy refuses it, say), the routes whose
body Envoy holds are `WiringFailed` too, with the error, until it's there and accepted.

Check it as below, with the engine's log in an Envoy pod (`-c inkwall-engine`). Since 0.5.0, the
end-to-end tests check the client IP through Envoy Gateway, with and without a trusted proxy.

## Behind an HTTP load balancer

An HTTP (layer 7) load balancer, such as an AWS Application Load Balancer, a GCP external
Application Load Balancer or Azure Application Gateway, ends the client's connection and opens its
own to the proxy, adding the client's address to `X-Forwarded-For`. The proxy's peer is then the
load balancer, and so is every event's `client_ip`, until the engines trust its entry. Since 0.5.0,
the `InkwallConfig` says which:

```yaml
apiVersion: waf.inkwall.dev/v1alpha1
kind: InkwallConfig
metadata:
  name: default
spec:
  engine:
    clientIP:
      trustedProxies: [10.0.0.0/16]   # the load balancer's addresses: here, the VPC's subnets
      # trustedHops: 1                # or: one load balancer, whatever its address
```

The engine walks `X-Forwarded-For` from the right: it skips the entry of the proxy beside it, then
`trustedHops` entries, then entries from `trustedProxies`, and the first other entry is the client.
Entries may carry a port (`198.51.100.7:4711`). The settings apply to pods injected after the
change: Envoy Gateway rolls its Envoy pods itself, and other proxies' pods need a restart.

| Proxy | Trusting the load balancer |
|---|---|
| Envoy Gateway, Istio | Works: Envoy keeps the load balancer's `X-Forwarded-For` and appends its address |
| HAProxy | Works with `trustedProxies`: list the load balancer |
| Traefik | Doesn't: its ForwardAuth sends only Traefik's own view of the client. Use the [PROXY protocol](#the-proxy-protocol-recommended) |

**A wrong setting lets clients choose their address.** Any client can send `X-Forwarded-For`, and
the load balancer keeps it, adding the address it saw. Trust only what is in front of the proxy,
and only if every request goes through it: if the proxy can also be reached directly (a public
`LoadBalancer` Service next to the ALB, a NodePort), prefer `trustedProxies` with the load
balancer's own addresses to `trustedHops`, and close the other paths. `trustedProxies:
[0.0.0.0/0]` trusts everyone: the webhook warns. Count the hops: an ALB behind a CDN that appends
too is two.

## Check it

Send a blocked request through the load balancer and look at the engine's log in a Traefik pod:

```sh
kubectl -n traefik logs deploy/traefik -c inkwall-engine | grep '"security event"' | tail -1
```

`client_ip` should be your address, not the load balancer's, a node's or a pod's.
