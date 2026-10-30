---
title: Testing rules
description: Check verdicts and measure performance without sending real traffic.
order: 5
---

`inkwallctl` is on the [releases page](https://github.com/inkwall-dev/inkwall/releases), next to the
engine.

## inkwallctl test

`inkwallctl test` shows the verdict and the matching rules for a request, given like a curl
command, as raw HTTP in a file (`--request`), or as a browser HAR export (`--har`). It runs the
engine's checks in-process with the same flags as the engine (`--paranoia-level`, `--rules`, ...),
or against a running engine with `--engine`.

```console
$ inkwallctl test 'http://shop.example.com/?id=1%27%20OR%20%271%27%3D%271'
deny  403  GET /?id=1%27%20OR%20%271%27%3D%271  reason=rule  rules=942100,949110  interrupting=949110  847µs
```

`--expect allow|deny` turns it into a CI check for rule changes: replay a HAR of your checkout
flow with your exclusions, and fail the build if a legitimate request would be blocked.

```sh
inkwallctl test --rules my-exclusions.conf --expect allow --har checkout-flow.har
```

### Test WAFPolicy objects

`--policy` tests the `WAFPolicy` objects you keep in Git before they reach the cluster. With the
rule sets, ConfigMaps and Ingresses they use, it resolves them as the operator does (each request
goes to the policy of its host and path, and `policy=` names it) and compiles them as the engine
does. Files or directories may hold several YAML documents, or `kubectl get -o yaml` output. Without
`--ingress`, a single policy applies to every request. Objects the operator would reject, such as a
missing rule set or rules that don't compile, are errors.

```console
$ inkwallctl test --policy wafpolicy.yaml --rule-set wafruleset.yaml --configmap configmap.yaml \
    --ingress ingress.yaml --request requests.http
allow      GET /products/42  policy=shop/storefront  580µs
deny  403  GET /?id=1%27%20OR%20%271%27%3D%271  policy=shop/storefront  reason=rule  rules=942100,949110  interrupting=949110  623µs
log        GET /api/orders?debug=true  policy=shop/api  reason=rule  rules=100100  interrupting=100100  20µs
allow      GET /?id=1%27%20OR%20%271%27%3D%271  reason=no_policy  0s
```

In CI, keep attacks and legitimate traffic next to the policies. A wrong verdict exits 1, an error 2:

```sh
inkwallctl test --policy k8s/waf/ --expect deny --request test/waf/attacks.http
inkwallctl test --policy k8s/waf/ --expect allow --har test/waf/legitimate.har
```

### Test the bundle a cluster enforces

`--bundle` tests the policies the cluster runs, from its `inkwall-bundle` Secret, and `--bundle-key`
checks the bundle's signature with the cluster's key:

```sh
kubectl -n inkwall-system get secret inkwall-bundle -o yaml > bundle.yaml
kubectl -n inkwall-system get secret inkwall-bundle -o jsonpath='{.data.ed25519\.pub}' > bundle.pub
inkwallctl test --bundle bundle.yaml --bundle-key bundle.pub --har traffic.har
```

## inkwallctl bench

`inkwallctl bench` replays a fixed mix of benign and attack requests and reports p50, p99 and
p99.9 latency per request class, and throughput per core.

- `--rate 2000` holds a fixed load, to measure latency below saturation. Latency is counted from
  when each request was due, so a slow engine can't hide its queueing delay.
- `--engine URL` measures a running engine instead of the in-process checks.

The repository also runs the OWASP CRS regression suite, about 4,500 tests, through the engine on
every pull request (`make crs-test`).
