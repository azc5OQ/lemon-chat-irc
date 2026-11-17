<p align="center">
  <img src="docs/images/logo.svg" alt="" width="120">
</p>

<h1 align="center">Lemon IRC</h1>

<p align="center"><b>What if Lemon Chat worked on IRC?</b></p>

This project answers that question. It takes the Lemon Chat web client, with its channel tree, themes, sounds and layout, and connects it to ordinary IRC networks such as Libera.Chat, OFTC and Rizon.

![Lemon IRC with the Default theme](docs/images/default.png)

## Features

- The Lemon Chat channel tree, with the public channel list of the network, member counts and roles
- Eight themes from Lemon Chat: Default, Hybrid, Hybrid v2, Aero, Termix, Ozone, Mobile and Mobile 2
- A server list that combines verified networks with public directories such as netsplit.de
- Private chats with anyone online, including people who share no channel with you
- Right-click menus on chat messages, plus an ignore list you can edit later
- Link previews, image previews and typing indicators
- Account login with SASL, saved identities and channel management for operators
- Lemon Chat's sound clips, with a switch for each event
- A desktop app for Windows and Linux in a single file

## Download

Each release has two files:

| System | File | How to start |
| --- | --- | --- |
| Windows 10 and 11 | `lemon-chat-irc-<version>-portable-x64.exe` | Double-click it. Nothing is installed. |
| Linux (x86-64) | `lemon-chat-irc-<version>-linux-x86_64.AppImage` | Run `chmod +x` on the file, then start it. |

The desktop app doesn't need Node.js. Windows can show a SmartScreen warning the first time, because the file isn't code-signed. Choose **More info → Run anyway**.

## Run from source

Run `start.bat` on Windows or `sh start.sh` on Linux and macOS. The script downloads Node.js into `.tools` if your computer doesn't have it, then opens the client in your browser.

## Screenshots

| | |
| --- | --- |
| ![Aero theme](docs/images/aero.png) | ![Termix theme](docs/images/termix.png) |
| Aero | Termix |
| ![Hybrid v2 theme](docs/images/hybrid-v2.png) | ![Ozone theme](docs/images/ozone.png) |
| Hybrid v2 | Ozone |
| ![Server list](docs/images/server-list.png) | ![Message menu](docs/images/message-menu.png) |
| The server list behind the globe button | Right-click a message to start a private chat or ignore someone |

<p align="center"><img src="docs/images/mobile-2.png" alt="Mobile 2 theme on a narrow screen" width="300"></p>

## Documentation

- [Getting started](docs/getting-started.md): connecting, nicknames, accounts and channels that require a login
- [Using the client](docs/using.md): channels, private chats, the message menu, ignoring, previews, settings and themes
- [Server list](docs/server-list.md): where the list of networks comes from and how a server gets picked
- [Desktop app and releases](docs/desktop-app.md): building the `.exe` and the AppImage
- [How it works](docs/architecture.md): the bridge, the client build and the project layout
- [Testing](TESTING.md): unit, browser and live network tests

## Build the desktop app

| System | Command | Result in `dist/` |
| --- | --- | --- |
| Windows | `build-windows.bat` | Portable `.exe` |
| Linux | `bash build-linux.sh` | `.AppImage` |
| macOS | `bash build-mac.sh` | `.dmg` for Intel and Apple silicon |

Each script downloads Node.js into `.tools` if needed, installs the locked build dependencies with `npm ci` and packages the app. The Windows and Linux packages can also be built on Linux. See [Desktop app and releases](docs/desktop-app.md).

## Project status

The client covers everyday IRC use: channels, private messages, topics, roles, nickname changes, channel browsing, account login and basic operator commands. It doesn't implement automatic reconnect, bouncer sessions, server-side chat history, DCC file transfers or voice. IRC has no voice transport, so Lemon Chat's voice and streaming features are hidden.

## Credits

- The interface, themes and sounds come from the Lemon Chat web client.
- [ws](https://github.com/websockets/ws) (MIT) is included in `vendor/ws`.
- The role icons come from [Tabler Icons](https://tabler.io/icons) (MIT); their license is in `vendor/tabler-icons`.
- Parser test cases come from [ircdocs/parser-tests](https://github.com/ircdocs/parser-tests); their license is in `tests/fixtures/parser-tests`.
- The server list uses data from [netsplit.de](https://netsplit.de), [IRCHelp.org](https://www.irchelp.org), [ircbits.com](https://ircbits.com) and [ircnet.info](https://www.ircnet.info).

No license has been chosen for this project yet.
