const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const net = require('node:net');
const fs = require('node:fs');
const {createBridge} = require('../bridge/server.cjs');

(async () =>
{
    const peers = new Set();
    let registration;
    let mode = 'hold';
    const server = net.createServer(socket =>
    {
        peers.add(socket);
        socket.on('close', () => peers.delete(socket));
        socket.setEncoding('utf8');
        let pending = '';
        let nick = '';
        socket.on('data', data =>
        {
            pending += data;
            let end;
            while ((end = pending.indexOf('\r\n')) >= 0)
            {
                const line = pending.slice(0, end);
                pending = pending.slice(end + 2);
                if (line.startsWith('NICK '))
                {
                    nick = line.slice(5);
                }
                if (line === 'CAP LS 302')
                {
                    socket.write(':s CAP * LS :\r\n');
                }
                if (line === 'CAP END')
                {
                    registration = () => socket.write(':s 001 ' + nick + ' :Welcome\r\n');
                    if (mode === 'accept')
                    {
                        registration();
                    }
                    else if (mode === 'reject')
                    {
                        socket.write(':s 904 ' + nick + ' :Authentication failed\r\n');
                    }
                }
                if (line === 'LIST')
                {
                    socket.write(':s 323 ' + nick + ' :End\r\n');
                }
            }
        });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const bridge = await createBridge({port: 0, target: {host: '127.0.0.1', port: server.address().port, tls: false}});
    const browser = await chromium.launch({executablePath: process.env.BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true});
    const errors = [];
    const toolbarSnapshots = new Map();
    fs.mkdirSync('test-results', {recursive: true});
    try
    {
        const page = await browser.newPage({viewport: {width: 1280, height: 800}});
        const toolbarSnapshot = () => page.locator('#communication-system-head-menu').evaluate(async toolbar =>
        {
            await Promise.all(toolbar.getAnimations({subtree: true}).filter(animation => Number.isFinite(animation.effect.getTiming().iterations)).map(animation => animation.finished.catch(() =>
            {
            })));
            const controls = [...toolbar.querySelectorAll(':scope > input[type="button"]')].filter(node => node.getBoundingClientRect().width > 0);
            controls.sort((first, second) => first.getBoundingClientRect().left - second.getBoundingClientRect().left);
            return controls.map(node =>
            {
                const style = getComputedStyle(node);
                const rect = node.getBoundingClientRect();
                return {id: node.id, width: Math.round(rect.width), height: Math.round(rect.height), image: style.backgroundImage, mask: style.maskImage, color: style.backgroundColor};
            });
        });
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(bridge.url);
        await page.waitForFunction(() => !document.getElementById('connect-button').disabled);
        assert.ok(await page.locator('#verification-system').isVisible());
        assert.ok(await page.locator('#communication-system-container').isHidden());
        assert.ok(await page.locator('#connect-window-close-button').isVisible());
        await page.locator('#connect-window-close-button').click();
        assert.ok(await page.locator('#verification-system').isHidden());
        assert.ok(await page.locator('#communication-system-container').isHidden());
        await page.locator('#connections-menu-button').click();
        await page.locator('#connections-menu-connect').click();
        assert.ok(await page.locator('#verification-system').isVisible());
        for (const theme of ['default', 'hybrid', 'hybrid-v2', 'aero', 'termix', 'ozone', 'default-mobile', 'mobile-2'])
        {
            await page.evaluate(() => g_is_chat_hidden = false);
            await page.locator('#choose-theme-button').click();
            await page.locator('.choose-theme-item[data-name="' + theme + '"]').click();
            const box = page.locator('#container-2');
            await box.evaluate(node => Promise.all(node.getAnimations().filter(animation => Number.isFinite(animation.effect.getTiming().iterations)).map(animation => animation.finished)));
            const before = await box.boundingBox();
            const title = await box.locator('[id="menu-bar-container"]').boundingBox();
            await page.mouse.move(title.x + 80, title.y + title.height / 2);
            await page.mouse.down();
            await page.mouse.move(title.x + 150, title.y + title.height / 2 + 40, {steps: 6});
            await page.mouse.up();
            const after = await box.boundingBox();
            if (Math.abs(after.x - before.x - 70) >= 2 || Math.abs(after.y - before.y - 40) >= 2)
            {
                console.log(theme, {before, after, title}, await box.evaluate(node => ({transform: getComputedStyle(node).transform, left: node.style.left, top: node.style.top, position: getComputedStyle(node).position})));
                await page.screenshot({path: 'test-results/' + theme + '-drag-failure.png'});
            }
            assert.ok(Math.abs(after.x - before.x - 70) < 2, theme + ' horizontal drag');
            assert.ok(Math.abs(after.y - before.y - 40) < 2, theme + ' vertical drag');
            assert.ok(await page.locator('#communication-system-container').isHidden());
            const icons = await toolbarSnapshot();
            toolbarSnapshots.set(theme, icons);
            const sound = icons.find(icon => icon.id === 'sound-effects-button');
            const flags = icons.find(icon => icon.id === 'hide-show-flags-button');
            const globe = icons.find(icon => icon.id === 'irc-network-browser-button');
            assert.ok(sound && sound.mask !== 'none', theme + ' sound icon is present');
            assert.ok(flags && flags.mask !== 'none', theme + ' flag icon is present');
            assert.notEqual(flags.mask, globe.mask, theme + ' flag and server icons differ');
            await page.screenshot({path: 'test-results/' + theme + '-disconnected.png'});
        }
        await page.setViewportSize({width: 390, height: 620});
        await page.locator('#connect-show-advanced').check();
        const fitted = await page.locator('#container-2').boundingBox();
        assert.ok(fitted.x >= 0 && fitted.y >= 0 && fitted.x + fitted.width <= 390 && fitted.y + fitted.height <= 620);
        await page.locator('#connect-show-advanced').uncheck();
        await page.setViewportSize({width: 1280, height: 800});
        await page.locator('#irc-nickname').fill('WindowTest');
        await page.locator('#connect-button').click();
        await page.waitForFunction(() => window.ircClient.nick === 'WindowTest');
        assert.ok(await page.locator('#verification-system').isVisible());
        assert.ok(await page.locator('#communication-system-container').isHidden());
        assert.match(await page.locator('#another-buttons-loading-container-p').textContent(), /Connecting/);
        while (!registration)
        {
            await new Promise(resolve => setTimeout(resolve, 20));
        }
        registration();
        await page.waitForFunction(() => window.ircClient.connected);
        assert.ok(await page.locator('#verification-system').isHidden());
        assert.ok(await page.locator('#communication-system-container').isVisible());
        for (const [theme, icons] of toolbarSnapshots)
        {
            await page.evaluate(() => g_is_chat_hidden = false);
            await page.locator('#choose-theme-button').click();
            await page.locator('.choose-theme-item[data-name="' + theme + '"]').click();
            assert.deepEqual(await toolbarSnapshot(), icons, theme + ' toolbar icons and order do not change on connection');
            await page.screenshot({path: 'test-results/' + theme + '-connected-toolbar.png'});
            const sound = page.locator('#sound-effects-button');
            const enabled = await sound.evaluate(node => ({mask: getComputedStyle(node).maskImage, color: getComputedStyle(node).backgroundColor, opacity: getComputedStyle(node).opacity}));
            await sound.click();
            const muted = await sound.evaluate(node => ({mask: getComputedStyle(node).maskImage, color: getComputedStyle(node).backgroundColor, opacity: getComputedStyle(node).opacity}));
            assert.notEqual(muted.mask, enabled.mask, theme + ' uses the copied crossed out icon');
            assert.equal(muted.color, enabled.color, theme + ' keeps its icon color');
            assert.equal(muted.opacity, enabled.opacity, theme + ' keeps its icon opacity');
            await page.locator('#communication-system-head-menu').screenshot({path: 'test-results/' + theme + '-muted-toolbar.png'});
            await sound.click();
        }
        await page.locator('#sound-effects-button').click();
        assert.equal(await page.locator('#sound-effects-button').evaluate(node => node.classList.contains('sfx-on')), false);
        await page.locator('#sound-effects-button').click();
        assert.equal(await page.locator('#sound-effects-button').evaluate(node => node.classList.contains('sfx-on')), true);
        await page.locator('#connections-menu-button').click();
        await page.locator('#connections-menu-connect').click();
        await page.locator('#connect-window-close-button').click();
        assert.ok(await page.locator('#verification-system').isHidden());
        for (const peer of peers)
        {
            peer.destroy();
        }
        await page.waitForFunction(() => !window.ircClient.connected);
        assert.ok(await page.locator('#verification-system').isVisible());
        assert.ok(await page.locator('#communication-system-container').isHidden());
        assert.equal(await page.locator('#irc-nickname').inputValue(), 'WindowTest');
        mode = 'accept';
        await page.locator('#connect-button').click();
        await page.waitForFunction(() => window.ircClient.connected);
        await page.locator('#connections-menu-button').click();
        await page.locator('#connections-menu-disconnect').click();
        await page.waitForFunction(() => !window.ircClient.connected);
        assert.ok(await page.locator('#verification-system').isVisible());
        assert.match(await page.locator('#another-buttons-loading-container-p').textContent(), /Disconnected/);
        mode = 'reject';
        await page.locator('#connect-button').click();
        await page.locator('#another-buttons-loading-container-p').getByText(/Account login failed/).waitFor();
        assert.ok(await page.locator('#communication-system-container').isHidden());
        const failed = await browser.newPage();
        await failed.route('**/networks?*', route => route.fulfill({status: 403, body: 'Forbidden'}));
        await failed.goto(bridge.url);
        // a refused list falls back to the built-in server list
        await failed.waitForFunction(() => document.getElementById('input-ip-address').value === 'irc.libera.chat');
        await failed.locator('#irc-network-browser-button').click();
        assert.ok(await failed.locator('#irc-network-browser .irc-network-row').count() > 10);
        await failed.locator('#irc-network-browser').getByRole('button', {name: 'Close', exact: true}).click();
        assert.ok(await failed.locator('#verification-system').isVisible());
        assert.ok(await failed.locator('#communication-system-container').isHidden());
        assert.deepEqual(errors, []);
        console.log('PASS connection startup, pending login, success, loss, disconnect, retry, rejection, catalog failure and dragging across all eight themes');
    }
    finally
    {
        await browser.close();
        bridge.close();
        for (const peer of peers)
        {
            peer.destroy();
        }
        server.close();
    }
})().catch(error =>
{
    console.error(error);
    process.exitCode = 1;
});
