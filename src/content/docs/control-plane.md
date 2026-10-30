---
title: Control plane
description: Connect a cluster to an optional control plane, what the operator sends it, Managed mode, and disconnecting.
order: 10
---

A cluster can connect to an optional control plane, a separate service that sees many clusters in
one place. This repository holds only the cluster side: the operator's client and the protocol,
[`api/controlplane/v1`](https://github.com/inkwall-dev/inkwall/blob/v0.2.0/api/controlplane/v1/controlplane.proto).
The full guide is
[`docs/control-plane.md`](https://github.com/inkwall-dev/inkwall/blob/v0.2.0/docs/control-plane.md).

- **Enforcement never depends on it.** Engines enforce the bundle the operator signs with the
  cluster's own key. If the connection drops, traffic is unaffected.
- **Only the operator connects**, and only its leader enrolls. Engines need no egress.
- **It never sends signed bundles.** In Managed mode it sends policy objects, which go through the
  same validation and signing as your own.
- **Standalone, the default, never connects.** Installing or upgrading the chart connects nothing.

## Modes

`InkwallConfig.spec.mode` sets the mode:

| Mode | Policy comes from | Connects | Writes `WAF*` objects |
|---|---|---|---|
| `Standalone` (default) | Your objects | No | No |
| `GitOps` | Your objects; the control plane gets a read-only copy | Yes | No |
| `Managed` | The control plane, written as objects labelled `inkwall.dev/source: saas` | Yes | Only its own labelled objects |

## Enrolling a cluster

You need the control plane's address, a one-time enrollment token (valid for an hour), its CA
certificate if it isn't from a public CA, and egress from `inkwall-system` to that address.

1. Give the operator the CA and the token:

   ```sh
   helm upgrade --install inkwall oci://ghcr.io/inkwall-dev/charts/inkwall --version 0.2.0 \
     --namespace inkwall-system --create-namespace --reset-then-reuse-values \
     --set-file controlPlane.caBundle=ca.crt \
     --set controlPlane.enrollmentToken=<token>
   ```

   The chart keeps the token in the Secret `inkwall-enrollment`. To keep it out of the Helm release
   history, or out of Git, leave the value empty and create the Secret yourself:

   ```sh
   kubectl -n inkwall-system create secret generic inkwall-enrollment --from-literal=token=<token>
   ```

2. Point the cluster at the control plane:

   ```sh
   kubectl apply -f - <<'YAML'
   apiVersion: waf.inkwall.dev/v1alpha1
   kind: InkwallConfig
   metadata:
     name: default
   spec:
     mode: GitOps
     controlPlane:
       endpoint: grpcs://<control-plane-address>:<port>
       enrollmentSecretRef:
         name: inkwall-enrollment
         namespace: inkwall-system
   YAML
   ```

The leader generates a key, sends a certificate signing request with the token, and keeps the
certificate it gets back in the Secret `inkwall-control-plane-identity`. From then on the cluster
authenticates with mutual TLS; the token isn't used again. The leader renews the certificate two
thirds of the way through its lifetime. A cluster that stays offline past the expiry must enroll
again with a new token.

## Checking the connection

```sh
kubectl get inkwallconfig default \
  -o jsonpath='{.status.conditions[?(@.type=="ControlPlaneConnected")]}{"\n"}'
```

`status: "True"` with reason `Connected` means connected. Otherwise the reason says why:
`EnrollmentTokenMissing`, `EnrollmentTokenRejected`, `Unreachable`, `InvalidEndpoint`,
`CertificateExpired`, ... The operator rereads the token Secret every few seconds, so a new token is
used without a restart.

## What the operator sends

- **Cluster state:** every `WAFPolicy`, rule set and `InkwallConfig` (name, namespace, labels, spec,
  status conditions), the number of Traefik pods and how many have the engine, each connected
  engine and the bundle version it runs. Rules written inline in a rule set's spec are part of the
  spec, so they're sent.
- **Security events**, only if the control plane accepts them; otherwise they stay in the engines'
  logs. The engine redacts each event before it leaves the pod: method, host, path without the query
  string, client IP, user agent, status, matched rule IDs with at most 64 bytes of each matched
  value, the policy and the action.

It never sends Secrets, ConfigMap contents, request bodies, query strings, `Authorization` headers
or cookies.

While the control plane is unreachable, each operator replica buffers events on disk, in an
`emptyDir` of `controlPlane.eventsBufferMiB` (64 MiB by default), drops the oldest when it's full,
and resends what wasn't acknowledged once it reconnects. The metric
`inkwall_operator_events_buffered` shows the buffer.

## Managed mode

```sh
kubectl patch inkwallconfig default --type merge -p '{"spec":{"mode":"Managed"}}'
```

The leader applies each policy snapshot all or nothing, after a server-side dry run of every object
through the CRD schema and the validating webhook. It writes `WAFPolicy`, `WAFRuleSet` and
`ClusterWAFRuleSet` objects labelled `inkwall.dev/source: saas`, and deletes the labelled objects a
snapshot no longer has. While in Managed mode, only the operator may change labelled objects. Your
own unlabelled objects stay yours: a snapshot with an object of the same name is refused.

## Disconnecting

```sh
kubectl patch inkwallconfig default --type merge -p '{"spec":{"mode":"Standalone"}}'
```

Within a few seconds every replica closes its connections and empties its events buffer. Objects
written in Managed mode stay, as ordinary objects you can edit or delete. To make the cluster forget
its identity, also remove the CA and token from the chart values and delete the Secret
`inkwall-control-plane-identity`.
