# Desktop app and releases

The desktop app is the same client packaged with [Electron](https://www.electronjs.org). It starts the bridge inside the app on a free port and opens the client in its own window. Links from the chat open in your default browser.

## Release files

| System | File | Notes |
| --- | --- | --- |
| Windows x64 | `lemon-chat-irc-<version>-portable-x64.exe` | One file. It unpacks itself into a temporary folder on each start and installs nothing. |
| Linux x86-64 | `lemon-chat-irc-<version>-linux-x86_64.AppImage` | One file. Make it executable with `chmod +x`. |
| macOS | `lemon-chat-irc-<version>-mac-<arch>.dmg` | Built on a Mac only. |

Neither file is code-signed. Windows SmartScreen can warn the first time; choose **More info → Run anyway**. macOS asks for confirmation on the first start.

If an AppImage doesn't start, your system may lack FUSE 2. Install the `libfuse2` package, or run the file with `--appimage-extract-and-run`.

## Building

Each script uses Node.js 22.12 or later when it is installed. Otherwise it downloads the latest Node.js 24 into `.tools` and checks it against the published SHA-256 checksum. On Windows the download uses `curl`, then `bitsadmin`, then PowerShell, whichever works first. Set `NODEJS_ORG_MIRROR` to download from a mirror. The script then runs `npm ci` to install the locked build dependencies, builds `client.html` and packages the app into `dist/`.

| System | Command |
| --- | --- |
| Windows | `build-windows.bat` |
| Linux | `bash build-linux.sh` |
| macOS | `bash build-mac.sh` |

You can also run the npm scripts directly after `npm ci`:

| Script | Result |
| --- | --- |
| `npm run electron` | Starts the app from source |
| `npm run dist:win` | Windows portable `.exe` |
| `npm run dist:linux` | Linux AppImage |
| `npm run dist:mac` | macOS `.dmg` files |
| `npm run dist:dir` | An unpacked app folder, for a quick check |

The Windows `.exe` can be built on Linux too. It skips the step that edits the executable's icon and version details, which would need Wine.

## Settings in the desktop app

The app keeps its data in its user folder: `%APPDATA%\Lemon IRC\` on Windows and `~/.config/Lemon IRC/` on Linux. A `bridge.config.json` placed there replaces the one packaged with the app.

To zoom the whole interface, press **Ctrl +**, **Ctrl −** and **Ctrl 0**. Press **Alt** to show the menu bar.
