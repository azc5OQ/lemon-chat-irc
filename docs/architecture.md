# How it works

## The pieces

```
browser or desktop window              your computer                      the internet
┌──────────────────────┐   WebSocket   ┌─────────────────┐   TCP or TLS   ┌──────────────┐
│ client.html          │ ────────────▶ │ bridge          │ ─────────────▶ │ IRC network  │
│ Lemon Chat interface │ ◀──────────── │ 127.0.0.1:19167 │ ◀───────────── │              │
│ + IRC protocol code  │               └─────────────────┘                └──────────────┘
└──────────────────────┘
```

A web page can't open a raw TCP connection, so the bridge does it. The page sends IRC lines over a WebSocket to the bridge, and the bridge forwards them to the IRC server over TCP or TLS. The IRC protocol itself runs in the page.

## The bridge

`bridge/server.cjs` is a small Node.js server:

- It listens only on `127.0.0.1`.
- It serves `client.html` and puts its access key into the page. Other programs and websites can't use the bridge without that key.
- It opens IRC connections only to networks from the server list.
- `/networks` returns the server list, and `/resolve` picks a working server for a network from the public directories (see `bridge/sources.cjs`).
- `/preview` reads the title, summary and picture of a linked page, when website previews are turned on.

`bridge.config.json` sets the port and the default network. `tools/stop-bridge.cjs` stops an earlier bridge on the same port before a new one starts. `tools/node.bat` and `tools/node.sh` find Node.js for the start and build scripts, or download it into `.tools`.

## The client

`build.cjs` builds `client.html` from the Lemon Chat source in `client-source-code/`. It takes the original page template, the eight theme stylesheets, the layout code, the member list code and the sound clips. Then it adds the IRC code and inlines everything into one file.

| Path | Contents |
| --- | --- |
| `client-source-code/.../main/scripts/irc/protocol.js` | IRC message parsing and connection state |
| `client-source-code/.../main/scripts/irc/page.js` | Connects the IRC state to the Lemon Chat interface |
| `client-source-code/.../main/scripts/irc/conversations.js` | The conversation selector |
| `client-source-code/.../main/scripts/irc/media.js` | Links and media previews |
| `client-source-code/.../main/scripts/irc/management.js` | Channel and operator tools |
| `client-source-code/.../main/styles/irc.style` | Style changes for IRC |
| `electron/main.cjs` | The desktop app |
| `networks.json` | Built-in networks |
| `tests/` | Unit, browser and live tests |


## Network features

The client turns on IRCv3 features only when the server offers them: SASL account login, message tags, typing notifications, away notifications, account tags and metadata such as avatars. A missing feature doesn't break anything; the related indicator just doesn't appear.

The client identifies itself as **Lemon IRC** in its real name and in replies to CTCP VERSION requests.
