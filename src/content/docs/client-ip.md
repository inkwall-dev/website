---
title: Client IP
description: Get the client's real address to the engine behind a load balancer, with the PROXY protocol or externalTrafficPolicy Local.
order: 9
---

Behind a load balancer, Traefik sees the load balancer, or a node, as its peer, and so does the
engine, unless the client's address reaches Traefik. A wrong client IP is worse than none: rules
that match on the address would see the load balancer, and every security event would carry its
address. The full guide, with more load balancers, is
[`docs/client-ip.md`](https://github.com/inkwall-dev/inkwall/blob/v0.1.2/docs/client-ip.md).

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

## Check it

Send a blocked request through the load balancer and look at the engine's log in a Traefik pod:

```sh
kubectl -n traefik logs deploy/traefik -c inkwall-engine | grep '"security event"' | tail -1
```

`client_ip` should be your address, not the load balancer's, a node's or a pod's.
