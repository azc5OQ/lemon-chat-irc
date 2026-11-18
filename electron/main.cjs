const {app, BrowserWindow, shell, Menu, dialog} = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const {createBridge} = require('../bridge/server.cjs');

// one window owns the bridge
if (!app.requestSingleInstanceLock())
{
    app.quit();
}
let bridge;
let mainWindow;

/**
 * @brief reads the bridge configuration, preferring a user copy next to the app data
 *
 * @return object bridge options
 */
function loadConfig()
{
    const candidates = [path.join(app.getPath('userData'), 'bridge.config.json'), path.join(__dirname, '../bridge.config.json')];
    for (const file of candidates)
    {
        if (fs.existsSync(file))
        {
            const config = JSON.parse(fs.readFileSync(file, 'utf8'));
            // a random free port avoids clashing with a separately running bridge
            return {...config, port: 0, discovery: config.discovery !== false, cacheFile: path.join(app.getPath('userData'), 'networks.cache.json')};
        }
    }
    return {port: 0, discovery: true, cacheFile: path.join(app.getPath('userData'), 'networks.cache.json')};
}

/**
 * @brief shows the right-click menu of a text field that a browser shows: spelling suggestions for a misspelled
 *        word, then cut, copy, paste and select all. Electron shows no right-click menu by itself. Paste also pastes
 *        a picture from the clipboard in the same way as Ctrl+V. The page lets this event through only in text fields
 *
 * @param object params -> the parameters of the context-menu event of Electron
 *
 * @return void
 */
function showTextFieldMenu(params)
{
    // text field only
    if (!params.isEditable || !mainWindow || mainWindow.isDestroyed())
    {
        return;
    }

    // spelling suggestions
    const items = params.dictionarySuggestions.map(word => ({label: word, click: () => mainWindow.webContents.replaceMisspelling(word)}));
    if (items.length)
    {
        items.push({type: 'separator'});
    }

    // menu at the pointer
    items.push({role: 'cut', enabled: params.editFlags.canCut}, {role: 'copy', enabled: params.editFlags.canCopy}, {role: 'paste'},
        {type: 'separator'}, {role: 'selectAll'});
    Menu.buildFromTemplate(items).popup({window: mainWindow});
}

/**
 * @brief opens the client window on the bridge's full local address, including its token
 *
 * @return void
 */
function createWindow()
{
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 860,
        minWidth: 360,
        minHeight: 480,
        title: 'Lemon IRC',
        backgroundColor: '#101418',
        icon: path.join(__dirname, 'icon.png'),
        autoHideMenuBar: true,
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            spellcheck: true,
            autoplayPolicy: 'no-user-gesture-required'
        }
    });
    const origin = new URL(bridge.url).origin;
    // links from chat open in the system browser
    mainWindow.webContents.setWindowOpenHandler(({url}) =>
    {
        if (/^https?:\/\//i.test(url))
        {
            shell.openExternal(url);
        }
        return {action: 'deny'};
    });
    mainWindow.webContents.on('will-navigate', (event, url) =>
    {
        if (new URL(url).origin !== origin)
        {
            event.preventDefault();
            if (/^https?:\/\//i.test(url))
            {
                shell.openExternal(url);
            }
        }
    });
    // right-click menu in text fields
    mainWindow.webContents.on('context-menu', (event, params) =>
    {
        showTextFieldMenu(params);
    });
    mainWindow.on('closed', () =>
    {
        mainWindow = null;
    });
    mainWindow.loadURL(bridge.url);
}

app.on('second-instance', () =>
{
    if (mainWindow)
    {
        if (mainWindow.isMinimized())
        {
            mainWindow.restore();
        }
        mainWindow.focus();
    }
});

app.whenReady().then(async () =>
{
    Menu.setApplicationMenu(Menu.buildFromTemplate([
        {label: 'File', submenu: [{role: 'quit'}]},
        // the Edit roles give cut, copy and paste their keyboard keys, which macOS needs
        {label: 'Edit', submenu: [{role: 'undo'}, {role: 'redo'}, {type: 'separator'}, {role: 'cut'}, {role: 'copy'}, {role: 'paste'}, {role: 'selectAll'}]},
        {label: 'View', submenu: [{role: 'reload'}, {role: 'forceReload'}, {role: 'toggleDevTools'}, {type: 'separator'}, {role: 'resetZoom'}, {role: 'zoomIn'}, {role: 'zoomOut'}, {type: 'separator'}, {role: 'togglefullscreen'}]}
    ]));
    try
    {
        bridge = await createBridge(loadConfig());
    }
    catch (error)
    {
        dialog.showErrorBox('Lemon IRC', 'The local IRC bridge could not start: ' + error.message);
        app.quit();
        return;
    }
    createWindow();
    app.on('activate', () =>
    {
        if (BrowserWindow.getAllWindows().length === 0)
        {
            createWindow();
        }
    });
});

app.on('window-all-closed', () =>
{
    if (process.platform !== 'darwin')
    {
        app.quit();
    }
});

app.on('will-quit', () =>
{
    bridge?.close();
});
