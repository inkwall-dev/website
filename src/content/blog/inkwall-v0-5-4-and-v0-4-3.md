---
title: "Inkwall 0.5.4 and 0.4.3: security fixes"
description: Six security fixes for the 0.5 and 0.4 lines, three of them high severity, also in 0.6.0. Upgrade the chart, restart the proxies that run the engine, and check your policies' status. 0.3 is out of support.
date: 2026-11-17
author: The Inkwall team
---

Inkwall 0.5.4 and 0.4.3 are out, patch releases for the 0.5 and 0.4 lines with six security
fixes, three of them high severity. [0.6.0](/blog/inkwall-v0-6-0/), released the same day, has the
same fixes. Everyone on 0.5.x should upgrade to 0.6.0, or to 0.5.4 to stay on 0.5. On 0.4.x,
upgrade to 0.5.4 or later, or to 0.4.3 to stay on 0.4. Neither has an API change.

0.3 left support with 0.6.0, and 0.3.x is not patched for these advisories: on 0.3, upgrade to
0.4.3 first, then onward.

## The advisories

| Advisory | Severity | What | Affected | Fixed in |
|---|---|---|---|---|
| [GHSA-c52q-5h8m-279w](https://github.com/inkwall-dev/inkwall/security/advisories/GHSA-c52q-5h8m-279w) | High | A request can be inspected by a weaker policy than the route it reaches | 0.3.0 to 0.5.3, in bundle mode | 0.6.0, 0.5.4, 0.4.3 |
| [GHSA-r2m3-77h9-hq8v](https://github.com/inkwall-dev/inkwall/security/advisories/GHSA-r2m3-77h9-hq8v) | High | A namespace's WAFPolicy can weaken or freeze another namespace's protection on a shared proxy fleet | 0.3.0 to 0.5.3 | 0.6.0, 0.5.4, 0.4.3 |
| [GHSA-9rmr-w4mp-34f3](https://github.com/inkwall-dev/inkwall/security/advisories/GHSA-9rmr-w4mp-34f3) | High | The standalone proxy forwards non-WebSocket upgrades such as `h2c` | Every release up to 0.5.3, the standalone proxy only | 0.6.0, 0.5.4, 0.4.3 |
| [GHSA-6vg9-25gh-3327](https://github.com/inkwall-dev/inkwall/security/advisories/GHSA-6vg9-25gh-3327) | Medium | Response inspection skips bodies by media type, `Range` and `Content-Encoding` list | 0.4.0 to 0.5.3, with response inspection on | 0.6.0, 0.5.4, 0.4.3 |
| [GHSA-m6qq-cj2f-9h75](https://github.com/inkwall-dev/inkwall/security/advisories/GHSA-m6qq-cj2f-9h75) | Medium | gRPC message fields with control characters are not inspected, and some event snippets are not redacted | 0.4.0 to 0.5.3, with `body.grpcMessages: Inspect` (the snippets: 0.5 only) | 0.6.0, 0.5.4, 0.4.3 |
| [GHSA-pjxq-6323-wcr3](https://github.com/inkwall-dev/inkwall/security/advisories/GHSA-pjxq-6323-wcr3) | Medium | `inkwallctl migrate ingress-nginx` can produce a broader exclusion than the source rules | `inkwallctl` 0.3.0 to 0.5.3; no running component | 0.6.0, 0.5.4, 0.4.3 |

## What changes

- **Every path form a proxy may route on is inspected with its policy.** A path with dot segments,
  encoded characters (`%2F`, `%2e`) or repeated slashes can match one route as received and another
  once decoded; when those forms select different policies, each inspects the request and the
  strictest verdict wins. Plain paths don't change.
- **A policy applies to an HTTPRoute only once a Gateway accepts it**, and overlapping routes of
  different namespaces no longer take each other's host or path in the engine: such a policy is
  `Accepted=False` with `TargetNotAttached` or `RouteOverlap`. A policy whose rule sets don't
  compile together is left out (`RuleSetsIncompatible`) instead of breaking the bundle for every
  engine. Envoy Gateway and Istio Gateways are wired only for routes they accept, and each engine
  is recorded under the pod its token is bound to.
- **The standalone proxy and HAProxy forward only WebSocket upgrades.** Any other `Upgrade`
  (`h2c`, `TLS/1.2`, ...) is removed with `HTTP2-Settings`, and the request goes upstream as plain
  HTTP/1.1. The operator's HAProxy snippets carry the new rules; a hand-written HAProxy
  configuration needs them too.
- **Response inspection reads more bodies, and only whole ones.** `+json`, `+xml`, JavaScript, CSV
  and XHTML bodies, malformed media types and bodies without a type are inspected. On routes whose
  responses are inspected, `Range` and `If-Range` are removed (clients get a 200 with the whole
  body), and a 206 or a body with more than one gzip or deflate coding counts as uninspected, so
  `responses.onOversize` applies.
- **gRPC messages: every text field is read** (`body.grpcMessages: Inspect`), a control character
  read as a space; binary fields give their runs of readable characters. In 0.5.4, a match on XML
  text, a gRPC field or a WebSocket message leaves no snippet in security events.
- **`inkwallctl migrate ingress-nginx` leaves chained `ctl` rules out** as `TODO` instead of
  turning them into exclusions for every request, refuses objects from `-f` whose names aren't
  valid Kubernetes names, and writes `--output` files only inside its directory.

## What to do

1. Upgrade the chart, to 0.5.4 (or 0.4.3), or to [0.6.0](/blog/inkwall-v0-6-0/):

   ```sh
   helm upgrade inkwall oci://ghcr.io/inkwall-dev/charts/inkwall --version 0.5.4 \
     --namespace inkwall-system --reset-then-reuse-values
   ```

2. Restart the proxies whose pods run the engine so they get the new engine: Traefik, Istio's
   Gateways, HAProxy and the Envoy Gateway proxies. On 0.5, `spec.engine.rollout: Automatic` does
   it for you. Run the new image or binary of the standalone proxy and `inkwallctl`.

3. If you configure HAProxy by hand, add the two upgrade rules after the engine's verdict
   ([protecting HAProxy](https://github.com/inkwall-dev/inkwall/blob/v0.6.0/docs/haproxy.md#websocket)):

   ```haproxy
   http-request del-header upgrade unless { req.fhdr_cnt(upgrade) eq 1 } { req.fhdr(upgrade) -m str -i websocket }
   http-request del-header http2-settings
   ```

4. Check your policies: `kubectl get wafpolicy -A`. A policy on an HTTPRoute no Gateway accepts,
   or overlapping another namespace's route, is now `Accepted=False`.

5. If you migrated from ingress-nginx with `inkwallctl migrate ingress-nginx`, run it again and
   convert the chained `ctl` rules it marks `TODO` by hand.

The [upgrade guide](/docs/upgrading/#from-053-to-054) has the notes, and the release notes of
[0.5.4](https://github.com/inkwall-dev/inkwall/releases/tag/v0.5.4) and
[0.4.3](https://github.com/inkwall-dev/inkwall/releases/tag/v0.4.3) have the rest.
