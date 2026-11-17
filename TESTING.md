# Testing

Install the dependencies once with `npm ci`.

## Unit tests

```
npm test
```

These run without a network or a browser. They cover the IRC parser (including the [ircdocs parser test corpus](https://github.com/ircdocs/parser-tests) in `tests/fixtures`), the connection state, SASL, CAP negotiation, the bridge, the server directory parsers, activity tracking, connection times and the channel tools.

`tests/tls.test.cjs` creates a temporary certificate with OpenSSL. On Windows it uses the copy that comes with Git. Set `OPENSSL` to another `openssl` executable if needed.

## Browser tests

These start the bridge and a fake IRC server on your computer, then drive the client in a headless browser with Playwright.

| Command | What it checks |
| --- | --- |
| `npm run test:browser` | The desktop themes: connecting, chatting, private chats, the message menu, ignoring, settings, the server list and member columns |
| `npm run test:mobile` | Both mobile themes at phone widths |
| `node tests/controls.cjs` | Sorting, user lookup, unread badges, sounds, colors, channel settings and operator tools |
| `node tests/connection-window.cjs` | The connection window in all eight themes: logging in, errors, reconnecting and dragging |

On Windows they use Microsoft Edge. Elsewhere, set `BROWSER_PATH` to a Chrome or Chromium executable:

```
BROWSER_PATH=/usr/bin/google-chrome npm run test:browser
```

Screenshots are saved in `test-results/`.

## Live tests

These connect to real IRC networks, so they need internet access. They can fail when a network is busy or limits new connections.

| Command | What it checks |
| --- | --- |
| `npm run test:networks` | Each built-in network answers, with a valid certificate for TLS entries |
| `npm run test:libera` | Connects to Libera.Chat, joins a temporary channel and sends itself a private message |
| `node tests/live-browser.cjs` | Connects to each built-in network in the browser. Set `IRC_TEST_NETWORK` to a network id from `networks.json` to test one. |
| `node tests/live-discovery.cjs` | Reads the public server directories and connects to a network found there |
| `node tests/live-channel-refresh.cjs` | Refreshes Libera's channel list and member counts |
| `node tests/live-mobile.cjs` | The mobile themes on a real network |
