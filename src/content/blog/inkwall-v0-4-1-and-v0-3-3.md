---
title: "Inkwall 0.4.1 and 0.3.3: security fixes"
description: Four vulnerabilities fixed in 0.4.1, three of them in 0.3.3 and two in 0.2.3. Upgrade the chart, restart the proxies that run the engine, and remove rules that run programs or DNS queries from your rule sets.
date: 2026-11-06
author: The Inkwall team
---

Inkwall 0.4.1 and 0.3.3 are out, with security fixes for the 0.4 and 0.3 lines. Everyone on 0.4.0
should upgrade to 0.4.1. Everyone on 0.3.x should upgrade to 0.3.3, or to 0.4.1. On 0.2.x, upgrade
to 0.2.3 or later: [0.2.3](https://github.com/inkwall-dev/inkwall/releases/tag/v0.2.3), released the
same day, fixes the two advisories that affect 0.2 (GHSA-xw38 and GHSA-3rgj). On 0.1.x, upgrade to
0.2.3 or later: the high-severity issue below affects every release before them.

## The advisories

| Advisory | Severity | What | Affected | Fixed in |
|---|---|---|---|---|
| [GHSA-xw38-cv4f-qp3p](https://github.com/inkwall-dev/inkwall/security/advisories/GHSA-xw38-cv4f-qp3p) | High | Rule sets could use SecLang operators that run a program (`@inspectFile`) or make a DNS query (`@rbl`) in the shared engine | Up to 0.4.0 | 0.2.3, 0.3.3, 0.4.1 |
| [GHSA-5hq9-fpvm-jrpq](https://github.com/inkwall-dev/inkwall/security/advisories/GHSA-5hq9-fpvm-jrpq) | Medium | ext_proc: the response to a request asking for a WebSocket upgrade bypassed response inspection | 0.4.0 (Envoy Gateway and raw Envoy, with response inspection) | 0.4.1 |
| [GHSA-3rgj-wvpm-3rrp](https://github.com/inkwall-dev/inkwall/security/advisories/GHSA-3rgj-wvpm-3rrp) | Low | Path exclusions applied to request paths that a backend may route outside the excluded prefix | Up to 0.4.0 | 0.2.3, 0.3.3, 0.4.1 |
| [GHSA-rjqr-wjvm-f27f](https://github.com/inkwall-dev/inkwall/security/advisories/GHSA-rjqr-wjvm-f27f) | Low | Standalone proxy: a header named in `Connection` was inspected but not forwarded | 0.3.1 to 0.4.0 (`inkwall-engine proxy` only) | 0.3.3, 0.4.1 |

The advisories have the details, and the workarounds for those who can't upgrade at once: restrict
who may create `WAFRuleSet` objects and review them for `@inspectFile` and `@rbl`; prefer exact-path,
rule- or argument-scoped exclusions.

## What to do

1. Upgrade the chart:

   ```sh
   helm upgrade inkwall oci://ghcr.io/inkwall-dev/charts/inkwall --version 0.4.1 \
     --namespace inkwall-system --reset-then-reuse-values
   ```

   (`--version 0.3.3` to stay on 0.3, `--version 0.2.3` to stay on 0.2.)
2. Restart the proxies whose pods run the engine, so they get the new engine: Traefik, Istio's
   Gateways, the HAProxy Kubernetes Ingress Controller and Envoy Gateway's Envoy pods. A standalone
   `inkwall-engine proxy`, raw Envoy or HAProxy setup: run the new engine image.
3. Look for rules that use `@inspectFile` or `@rbl` in your `WAFRuleSet` and `ClusterWAFRuleSet`
   objects, and remove them. A rule set that already uses them keeps loading, but those rules never
   match, and editing it is rejected until they are removed.

## What else changes

- Path exclusions apply only to plain paths (ASCII, without `%`, `;`, `\`, `//` or dot segments),
  as skip paths already did. Another path gets the policy's rules without the exclusion.
- Through Envoy, the response to an upgrade request is inspected unless it's a `101`. WebSockets
  work as before.
- The engine sets `GOMEMLIMIT` from its container's memory limit, as the operator does, and keeps
  only the inspected part of a large request body through ext_proc.

The [upgrade guide](/docs/upgrading/) has both versions' notes.
