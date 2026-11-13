---
title: Monitoring
description: Check the whole cluster with inkwallctl status, find the rule behind a denial, move from Detect to Block, and scrape the metrics, alerts and dashboard the chart ships.
order: 6.5
---

From v0.5.0, Inkwall says what it is doing in one command, in each policy's status, in its security
events and in its metrics. This page is v0.5.1's. The full guides are
[`docs/troubleshooting.md`](https://github.com/inkwall-dev/inkwall/blob/v0.5.1/docs/troubleshooting.md),
with every condition reason and what to do about it, and
[`docs/monitoring.md`](https://github.com/inkwall-dev/inkwall/blob/v0.5.1/docs/monitoring.md), with
every metric and a runbook for each alert.

## Cluster status

`inkwallctl status` answers "is Inkwall working in this cluster?" from the current kubeconfig
context, and only reads:

```console
$ inkwallctl status
InkwallConfig: mode Standalone, suspended no
Operator: 2/2 replicas ready in inkwall-system, version 0.5.1
Bundle: version 7, 4096 bytes compressed

Proxies:
  CONTROLLER                     INTEGRATION  SUPPORT      REQUESTS  RESPONSES  WS MESSAGES  GRPC MESSAGES
  traefik.io/ingress-controller  traefik      Full         yes       no         no           yes
  k8s.io/ingress-nginx           -            Unsupported  no        no         no           no
  k8s.io/ingress-nginx: Inkwall has no integration for this controller

Policies: 2 of 2 Ready

Engines: 2 connected
  VERSION  CURRENT  BEHIND  REJECTED
  v0.5.1   2        0       0

OK: nothing needs attention.
```

It lists the proxies and what the engine inspects through each, the policies that aren't `Ready`
grouped by reason, and the engines by version, naming those that are behind, reject the bundle or
run another version than the operator, with what to do. It exits 0 when nothing needs attention,
1 when something does, and 2 on an error; `-o json` prints fields that are only ever added to.

Without `inkwallctl`, `kubectl get wafpolicies -A` has a `REASON` column, the reason a policy isn't
`Ready`, and the `InkwallConfig` reports the cluster's state: the bundle's version and size against
its limit, the engines (connected, current, behind, rejected, outdated), and the signing key and its
rotation:

```sh
kubectl get inkwallconfig default
kubectl get inkwallconfig default -o jsonpath='{.status.bundle}{"\n"}{.status.engines}{"\n"}{.status.signingKey}{"\n"}'
```

A change of a policy's `Ready`, `Programmed` or `Enforced` condition is also a Kubernetes Event on
the policy (`kubectl describe wafpolicy`). The conditions and their reasons are on
[Policies](/docs/policies/).

## Finding a denial

Every inspected request has a request ID, and every denial carries it back in `X-Request-Id` (a
gRPC call in its `grpc-message`), through every proxy. Find the request's security event in the
engine's log, in the proxy's pods:

```sh
kubectl -n <namespace> logs <pod> -c inkwall-engine | grep '"request_id":"<id>"'
```

The line has the `policy`, the `action` (`deny`, or `log` in `Detect` mode), the `reason`, the rule
IDs and the anomaly score, and, since 0.5.0, `matches`: each rule with the variable it matched
(`{"rule_id":942100,"variable":"ARGS:q"}`), never the value. A rule that matched a legitimate value
is a false positive: exclude it for that variable, as [Policies](/docs/policies/) shows. Each engine
logs at most 10 lines per second for each policy and rule (`--event-log-rate`); the events sent to
the operator are complete.

A denied client gets the status (403 for an attack, 413 for an oversized body, 503 when the request
couldn't be inspected in time and the policy fails closed), `X-Request-Id`, and a short text body.
With `InkwallConfig.spec.engine.jsonDenials: true`, a client that accepts JSON gets
`{"error":"forbidden","status":403,"request_id":"..."}` instead, except through HAProxy, which writes
its own denials.

## From Detect to Block

1. **Run in `Detect`** on real traffic long enough to see its variety: a week, or a release cycle.
2. **Review the events**: count them by rule and variable, and `inkwall_rule_matches_total` by
   `rule_id`. Separate attacks from false positives; `inkwallctl tune` groups them and suggests the
   narrowest exclusions ([Testing rules](/docs/testing-rules/)).
3. **Exclude narrowly**: a rule for one argument, cookie or header, or one path, never a whole rule
   set.
4. **Test offline**, with `inkwallctl test --policy` or a test suite, in CI too.
5. **Check the cluster**: `inkwallctl status` exits 0, and every policy is `Ready`.
6. **Switch** to `mode: Block`, one policy at a time, and watch
   `inkwall_requests_total{action="deny"}` and the events. Going back is `mode: Detect`, within
   seconds.

## The monitoring kit

The chart ships a Prometheus Operator ServiceMonitor for the operator, a PodMonitor for the engines,
alerts and a Grafana dashboard, all off by default. With the Prometheus Operator in the cluster:

```sh
helm upgrade inkwall oci://ghcr.io/inkwall-dev/charts/inkwall --version 0.5.1 \
  --namespace inkwall-system --reset-then-reuse-values \
  --set metrics.serviceMonitor.enabled=true \
  --set metrics.podMonitor.enabled=true \
  --set metrics.prometheusRule.enabled=true \
  --set metrics.dashboard.enabled=true
```

The operator serves `/metrics` on port 8080, and each engine on port 9480 (`inkwall-admin`), in the
proxy pod it runs in: Prometheus must be allowed to scrape the proxy namespaces. The dashboard is a
ConfigMap labelled for Grafana's dashboard sidecar. Without the Prometheus Operator, scrape those
ports yourself and load the chart's `monitoring/alerts.yaml` as a rule file.

The engines' metrics include requests by action and reason (`inkwall_requests_total`), which rules
matched (`inkwall_rule_matches_total`), requests an adapter couldn't read
(`inkwall_adapter_errors_total`), the bundle the engine enforces, its age and how long it took to
compile, evaluation slots in use, and WebSockets. `inkwall_policy_requests_total`, one series per
policy, is opt-in: `InkwallConfig.spec.engine.policyMetrics: true`. The operator's are on
[Operations](/docs/operations/).

The alerts, each with a runbook in the guide:

| Alert | When |
|---|---|
| `InkwallEngineDisconnected` | An engine has had no stream to the operator for 10 minutes; it keeps enforcing its bundle |
| `InkwallBundleRejected` | An engine rejected a bundle, and keeps the one it had |
| `InkwallRequestsUninspected` | An engine answers requests with its failure mode: timeouts, errors or overload |
| `InkwallEvaluationSlotsSaturated` | An engine has used 90% of its evaluation slots for 10 minutes |
| `InkwallAdapterErrors` | An engine has refused requests it can't read for 15 minutes |
| `InkwallEnginesBehind` | Engines haven't run the current bundle for 15 minutes |
| `InkwallWiringFailures` | Policy targets have failed to wire for 15 minutes: their routes aren't protected |
| `InkwallBundleNearSizeLimit` | The bundle is over 80% of its size limit |
