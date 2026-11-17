# Server list

The globe button opens a list of IRC networks sorted by the number of users. The list has two parts.

## Built-in networks

`networks.json` lists networks with a known address, port and TLS setting, such as Libera.Chat, OFTC, Rizon and hackint. These connect immediately. To add your own, add an entry with an `id`, `name`, `host`, `port` and `tls`, then restart the bridge.

`npm run test:networks` connects to each built-in network and reports whether its certificate is valid. Networks marked unencrypted are only checked for a connection.

## Networks from public directories

The bridge also reads these sites:

| Source | What it provides |
| --- | --- |
| [netsplit.de](https://netsplit.de/networks/) | All registered networks, user counts for the top 100, and each network's servers with their TLS ports |
| [ircbits.com](https://ircbits.com/articles/irc-networks-overview) | The big networks with user counts and server addresses |
| [IRCHelp.org](https://www.irchelp.org/networks/popular.html) | Popular networks with server lists and descriptions |
| [ircnet.info](https://www.ircnet.info/servers) | IRCnet servers that accept users from any country |

The bridge downloads them when its saved copy is more than a day old, then once a day. The result is saved in `networks.cache.json`, so the list opens instantly. Entries with the same network name are merged.

A network from these sources shows **server found when chosen**. When you click it, the bridge tests its known servers. It tries TLS with a certificate check first and an unencrypted port second. The first server that answers is used and remembered. If none answers, the row says so in red.

## Turning it off

Set `"discovery": false` in `bridge.config.json` to show only the built-in networks.
