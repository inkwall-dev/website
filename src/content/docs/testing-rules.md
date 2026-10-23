---
title: Testing rules
description: Check verdicts and measure performance without sending real traffic.
order: 4
---

## inkwallctl test

`inkwallctl test` shows the verdict and the matching rules for a request, given like a curl
command, as raw HTTP in a file (`--request`), or as a browser HAR export (`--har`). It runs the
engine's checks in-process with the same flags as the engine (`--paranoia-level`, `--rules`, ...),
or against a running engine with `--engine`.

```console
$ ./bin/inkwallctl test 'http://shop.example.com/?id=1%27%20OR%20%271%27%3D%271'
deny  403  GET /?id=1%27%20OR%20%271%27%3D%271  reason=rule  rules=942100,949110  interrupting=949110  847µs
```

`--expect allow|deny` turns it into a CI check for rule changes: replay a HAR of your checkout
flow with your exclusions, and fail the build if a legitimate request would be blocked.

```sh
./bin/inkwallctl test --rules my-exclusions.conf --expect allow --har checkout-flow.har
```

## inkwallctl bench

`inkwallctl bench` replays a fixed mix of benign and attack requests and reports p50, p99 and
p99.9 latency per request class, and throughput per core.

- `--rate 2000` holds a fixed load, to measure latency below saturation. Latency is counted from
  when each request was due, so a slow engine can't hide its queueing delay.
- `--engine URL` measures a running engine instead of the in-process checks.

The repository also runs the OWASP CRS regression suite, about 4,500 tests, through the engine on
every pull request (`make crs-test`).
