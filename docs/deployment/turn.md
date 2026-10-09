# TURN relay for calls

River calls connect people directly (WebRTC, encrypted with DTLS-SRTP). When
both people are behind strict firewalls or carrier-grade NAT, a direct path
is impossible and the call needs a **TURN relay**. The relay forwards
encrypted packets; it cannot listen in.

Without TURN, River uses public STUN servers only, and some calls between
some networks will fail to connect.

## Run coturn next to your River server

```bash
docker run -d --name coturn --network host coturn/coturn \
  -n --log-file=stdout \
  --use-auth-secret --static-auth-secret=CHANGE-ME-TO-A-LONG-RANDOM-STRING \
  --realm=river --listening-port=3478 --tls-listening-port=5349 \
  --no-cli --no-multicast-peers --denied-peer-ip=10.0.0.0-10.255.255.255 \
  --denied-peer-ip=172.16.0.0-172.31.255.255 --denied-peer-ip=192.168.0.0-192.168.255.255
```

Open UDP/TCP 3478 (and 5349 for TLS, plus coturn's relay port range,
49152–65535 by default) on your firewall.

## Tell the River server about it

```bash
RIVER_TURN_URLS=turn:turn.example.org:3478,turns:turn.example.org:5349
RIVER_TURN_SECRET=CHANGE-ME-TO-A-LONG-RANDOM-STRING
```

The River server then hands signed-in users short-lived credentials
(`GET /v1/turn`, coturn's "TURN REST API" format: the username is
`<expiry>:<riverId>`, the password is base64 HMAC-SHA1 of it with the shared
secret, valid for 6 hours). Clients use them automatically for community voice
channels and 1:1 calls.

## Privacy

A TURN relay sees the IP addresses of both ends of a relayed call and how much
data flows, never the content. Run it yourself, or only use a provider you
trust with that metadata.
