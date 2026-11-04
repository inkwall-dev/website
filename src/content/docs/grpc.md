---
title: gRPC
description: What the engine inspects in a gRPC call, reading the text in its messages, and how a denied call is answered.
order: 5.7
---

gRPC calls are inspected on their path, query and metadata, through every proxy. From v0.4.0, a
policy can have the text in their messages inspected too, a denied call is answered as gRPC
(status 7, `PERMISSION_DENIED`), and gRPC-Web text calls are inspected as gRPC calls. Before
v0.3.1, the Core Rule Set denied every gRPC call in `Block` mode and logged it in `Detect` mode. The
full guide is [`docs/grpc.md`](https://github.com/inkwall-dev/inkwall/blob/v0.4.0/docs/grpc.md).

## Which requests are gRPC calls

A request is a gRPC call when all of these hold:

- it is a `POST`;
- it has one `Content-Type`, and that is `application/grpc`, `application/grpc+proto`,
  `application/grpc-web`, `application/grpc-web+proto`, `application/grpc-web-text` or
  `application/grpc-web-text+proto` (in any case, with or without parameters);
- its body is a sequence of gRPC messages, each a 5-byte prefix (a compressed flag of 0 or 1 and a
  4-byte length) and that many bytes, checked as far as `body.maxBytes` goes. A gRPC-Web text body
  is those messages in base64, decoded first (from v0.4.0).

Any other request is inspected as before, whatever its `Content-Type` says: gRPC with another
codec (`application/grpc+json`), or a gRPC-Web text body that isn't base64 of gRPC messages. The
Core Rule Set denies those in `Block` mode, as any content type it doesn't know (rule 920420).

## What is inspected

- **Inspected**, as in any request, by the policy's rules and exclusions: the method, the path
  (`/package.Service/Method`), the query, and the headers, which carry the call's metadata. An
  attack there is denied as anywhere else. Metadata whose key ends in `-bin` is base64, which rules
  don't decode.
- **Not inspected by default**: the messages. They are binary protobuf, which text rules can't
  read, unless the policy sets `body.grpcMessages: Inspect` ([below](#inspecting-the-messages)).
- **Allowed**: the call's content type, which the Core Rule Set doesn't list (rule 920420).

## Inspecting the messages

From v0.4.0, a policy can have the text in the messages inspected:

```yaml
spec:
  body:
    grpcMessages: Inspect   # default: Skip
```

(The engine's flag, without the operator: `--grpc-messages inspect`.)

- **What is read:** the body, up to `body.maxBytes`, as gRPC messages, each read as protobuf
  without its schema. A field whose bytes are printable UTF-8 is text; a nested message is read as
  one, down to 16 levels. `grpc-encoding: gzip` is decompressed, up to 1 MiB per call.
- **What the rules see:** each text field as a form argument named by its field numbers (`2.1` is
  field 1 of the message in field 2). An attack in a field is denied as in a form, and an exclusion
  names one as any argument (`when: {argument: "2.1"}`).
- **What can't be read** (a message cut at `body.maxBytes`, another compression, not protobuf,
  more than 4,096 text fields) is handled as an oversized body, by `body.onOversize`.
- **False positives:** random binary bytes are sometimes printable, and a short run of them can
  match a rule: about 1 message in 10,000 with four short random `bytes` fields, at paranoia level
  1, and none in the real protobuf messages measured. That is why it is off by default: turn it on
  in `Detect` mode first, and add exclusions for binary fields that match before `Block`.

An engine before 0.4.0 ignores the field: the policy is `Enforced=False` (`EnginesOutdated`) while
one runs it.

## Denied calls

A denied call is answered as gRPC: status 7 (`PERMISSION_DENIED`) and a message with the request
ID, which finds the call's security event in the engine's log. A call the engine can't inspect in
time and denies gets 14 (`UNAVAILABLE`), and an oversized body gets 8 (`RESOURCE_EXHAUSTED`).

| Proxy | HTTP status of a denied call |
|---|---|
| Envoy Gateway, Istio, raw Envoy, the engine's reverse proxy | 200, with the gRPC status in the headers |
| HAProxy, with `haproxy.cfg`'s gRPC rules | 200, with the gRPC status in the headers |
| Traefik | 403, with the gRPC status in the headers |

Traefik's ForwardAuth denies only on an answer other than 2xx, so the HTTP status stays 403 there.
Envoy counts a denied gRPC call as HTTP 200 in its access log and metrics, as any gRPC error; the
engine's security events count it as a denial. Through Istio, this isn't covered by an end-to-end
test yet.

## Streaming calls

Unary, server-streaming and client-streaming calls work. A call is held until the client has sent
its whole request, or as much as the proxy buffers:

- **Envoy Gateway and Istio**, in `Block` mode, hold the call until the client ends its side or the
  body fills Envoy's buffer. A bidirectional call whose client waits for the server before ending
  its side stalls. Set `body.inspect: false` on the policy for such routes: Envoy then doesn't hold
  the body, and the headers are still inspected.
- **HAProxy** sends a body only with `option http-buffer-request`, up to its buffer (about 15 KiB by
  default): a call is held the same way, and a message past the buffer is an oversized body.
- **Traefik**'s ForwardAuth reads the whole body before asking the engine, whatever the policy
  says, and refuses bodies over 10 MiB (401). Bidirectional calls stall there too.

## If you serve no gRPC

A request that only claims to be gRPC, to get a JSON or form body past the rules, is inspected in
full: such a body doesn't start with a message prefix. An application that isn't gRPC but reads any
body however it is labelled could still get a body made to look like gRPC messages. If your routes
serve no gRPC, deny gRPC content types with a SecLang rule in a `WAFRuleSet`:

```
SecRule REQUEST_HEADERS:Content-Type "@rx (?i)^application/grpc" \
    "id:1000100,phase:1,deny,status:403,log,msg:'gRPC is not served here'"
```
