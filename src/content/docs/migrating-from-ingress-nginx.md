---
title: Migrating from ingress-nginx
description: Convert ingress-nginx's ModSecurity annotations and ConfigMap settings into WAFPolicy objects with inkwallctl migrate, for the Ingresses or the routes replacing them.
order: 5.5
---

ingress-nginx is retired upstream. `inkwallctl migrate ingress-nginx` converts its ModSecurity
settings into `WAFPolicy` objects, so the routes keep their WAF when they move to Traefik, or to
`HTTPRoute`s served by Traefik or Envoy Gateway. `inkwallctl` is on the
[releases page](https://github.com/inkwall-dev/inkwall/releases); it only reads, and never changes
the cluster. The full guide, with every setting and how it maps, is
[`docs/migrating-from-ingress-nginx.md`](https://github.com/inkwall-dev/inkwall/blob/v0.5.1/docs/migrating-from-ingress-nginx.md).

## Convert the settings

From the cluster of the current kubeconfig context (it needs `get` on the controller's ConfigMap and
`list` on Ingresses), or from files such as `kubectl get -o yaml` output or the manifests in Git:

```sh
inkwallctl migrate ingress-nginx --cluster --output waf/

kubectl get ingress -A -o yaml > ingresses.yaml
kubectl -n ingress-nginx get configmap ingress-nginx-controller -o yaml > nginx-config.yaml
inkwallctl migrate ingress-nginx -f ingresses.yaml -f nginx-config.yaml --output waf/
```

Without `--output`, the objects are printed to stdout. `--controller-configmap`, `--ingress-class`
and `--annotation-prefix` match a controller installed with other names.

Each Ingress on which ModSecurity runs gets a `WAFPolicy` of the same name. The settings are
combined as ingress-nginx combines them: the ConfigMap's `enable-modsecurity`,
`enable-owasp-modsecurity-crs` and `modsecurity-snippet` first, then the Ingress's annotations.
`SecRuleEngine` becomes the policy's `mode`, the CRS's paranoia level and anomaly threshold become
`ruleSets[]` settings, `SecRuleRemoveById` and path-scoped `ctl:` rules become `exclusions` and
`skip` paths, and the body directives become `body` settings. Since 0.5.0, the CRS's
`tx.allowed_methods`, `tx.allowed_request_content_type`, `tx.detection_paranoia_level` and
`tx.outbound_anomaly_score_threshold` become the binding's
[`crs` settings](/docs/policies/), and targets removed by name from a rule (`!ARGS_NAMES:name`,
`!REQUEST_COOKIES:name`, `!REQUEST_HEADERS:name`) become exclusions for an argument name, a cookie
or a header, instead of being marked `TODO` or kept as SecLang. Other `SecRule` and `SecAction`
rules are kept as they are, in a `WAFRuleSet` loaded after the CRS.

## Target HTTPRoutes or IngressRoutes

If the Ingresses move to Gateway API `HTTPRoute`s or Traefik `IngressRoute`s (for example with
`ingress2gateway`), point the policies at those routes:

```sh
inkwallctl migrate ingress-nginx -f ingresses.yaml -f nginx-config.yaml -f httproutes.yaml \
  --target httproute --output waf/
inkwallctl migrate ingress-nginx --cluster --target ingressroute --output waf/
```

Each Ingress is matched to its routes by what they match, not by name: a route replaces it when it
matches only hosts and paths of the Ingress, in the same namespace. When an `HTTPRoute` also
carries other hosts or paths, a named rule of it that matches only the Ingress's paths becomes the
target, with `sectionName`. Anything else is never guessed: it is marked `TODO`.

## Read the summary

The summary on stderr lists every setting of each Ingress and what became of it: `mapped`
(converted to an equivalent), `check` (converted or left out with a difference worth knowing) or
`TODO` (not migrated, it needs a human). Nothing is dropped or weakened silently: a rule that can't
be converted faithfully is listed and left out of the objects. `inkwallctl migrate` exits 0 when
everything was converted, 1 when something is `TODO`, and 2 on an error.

## Check, then apply

Replay attacks and legitimate traffic against the objects with
[`inkwallctl test`](/docs/testing-rules/), which routes requests through Ingresses, IngressRoutes
and HTTPRoutes:

```sh
inkwallctl test --policy waf/ --ingress ingresses.yaml --expect deny --request attacks.http
inkwallctl test --policy waf/ --ingress ingresses.yaml --expect allow --har legitimate.har
kubectl apply -f waf/
```

The policies follow their Ingresses to the new controller: once Traefik serves an Ingress, the
operator wires it. A policy whose Ingress is still served by ingress-nginx is accepted but not
programmed. Policies converted with `--target` apply once their routes serve the traffic. To undo
the migration, `kubectl delete -f waf/`.

## Differences to know

- **CRS version.** Inkwall runs CRS v4; older ingress-nginx releases shipped CRS v3. Check
  exclusions of v3 rules.
- **Responses.** `SecResponseBodyAccess` isn't converted: set `responses: {inspect: true}` on a
  policy to run the CRS's response rules, on routes Envoy Gateway or Istio serves.
- **Body limits.** Inkwall inspects up to `body.maxBytes` (64 KiB by default, 10 MiB at most) and, in
  block mode, rejects larger bodies with 413. Set `body.maxBytes` or `body.onOversize: Allow` on
  routes that take large uploads.
- **Rule ranges.** A `ctl:ruleRemoveById` range becomes the IDs of the CRS rules in it today.
- **Order.** Kept rules load after the CRS; snippet rules in ingress-nginx could load before it.

Start the converted policies in `Detect` mode if ingress-nginx ran in `DetectionOnly`, and switch to
`Block` once the verdicts look right.
