const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const net = require('node:net');
const fs = require('node:fs');
const {createBridge} = require('../bridge/server.cjs');

(async () =>
{
    const peers = new Set();
    const queries = [];
    const server = net.createServer(socket =>
    {
        peers.add(socket);
        socket.on('close', () => peers.delete(socket));
        socket.setEncoding('utf8');
        let nick = 'Tester';
        let pending = '';
        const reply = line => socket.write(line + '\r\n');
        socket.on('data', data =>
        {
            pending += data;
            let end;
            while ((end = pending.indexOf('\r\n')) >= 0)
            {
                const line = pending.slice(0, end);
                pending = pending.slice(end + 2);
                queries.push(line);
                if (line.startsWith('NICK '))
                {
                    nick = line.slice(5);
                }
                if (line === 'CAP LS 302')
                {
                    reply(':s CAP * LS :');
                }
                if (line === 'CAP END')
                {
                    reply(':s 001 ' + nick + ' :Welcome');
                    reply(':s 005 ' + nick + ' NETWORK=MobileTest PREFIX=(ov)@+ :supported');
                }
                if (line === 'LIST')
                {
                    reply(':s 322 ' + nick + ' #music 12 :Topic stays in the description');
                    reply(':s 322 ' + nick + ' #empty 0 :An empty room');
                    reply(':s 323 ' + nick + ' :End');
                }
                if (line === 'NAMES #music')
                {
                    reply(':s 353 ' + nick + ' = #music :@Alice');
                    reply(':s 366 ' + nick + ' #music :End');
                }
                if (line === 'JOIN #music')
                {
                    reply(':' + nick + '!u@h JOIN #music');
                    reply(':s 353 ' + nick + ' = #music :@Alice +Bob ' + nick);
                    reply(':s 366 ' + nick + ' #music :End');
                    reply(':s 332 ' + nick + ' #music :Topic stays in the description');
                    reply(':Alice!u@h PRIVMSG #music :Hello from Alice');
                }
                if (line.startsWith('PRIVMSG '))
                {
                    reply(':Alice!u@h PRIVMSG ' + (line.includes('#music') ? '#music' : nick) + ' :Received your message');
                }
            }
        });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const bridge = await createBridge({port: 0, target: {host: '127.0.0.1', port: server.address().port, tls: false}});
    const browser = await chromium.launch({executablePath: process.env.BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true});
    fs.mkdirSync('test-results', {recursive: true});
    try
    {
        for (const theme of ['default-mobile', 'mobile-2'])
        {
            const context = await browser.newContext({viewport: {width: 390, height: 844}, hasTouch: true, isMobile: true});
            const page = await context.newPage();
            const errors = [];
            page.on('pageerror', error => errors.push(error.message));
            await page.addInitScript(theme => localStorage.setItem('lemon-irc-theme', theme), theme);
            try
            {
                await page.goto(bridge.url);
                await page.locator('#connections-menu-button').tap();
                await page.locator('#connections-menu-connect').tap();
                await page.locator('#irc-nickname').fill('Tester');
                await page.locator('#irc-username').fill('tester');
                await page.locator('#irc-realname').fill('Lemon Tester');
                await page.screenshot({path: 'test-results/' + theme + '-phone-connect.png'});
                await page.locator('#connect-button').tap();
                await page.waitForFunction(() => window.ircClient.connected && window.ircClient.directory.size === 2);
                const music = page.locator('.single-channel[aria-label="#music"]');
                await music.locator('.single-channel-people-count').getByText('12', {exact: true}).waitFor();
                assert.equal(await page.locator('#channel-list-container').getByText('Topic stays in the description', {exact: true}).count(), 0);
                await page.locator('.single-channel[aria-label="#empty"] .single-channel-people-count').getByText('0', {exact: true}).waitFor();
                const before = queries.length;
                await page.getByRole('button', {name: 'Toggle members of #music', exact: true}).tap();
                await page.waitForFunction(() => window.ircClient.channel('#music').members.size === 1);
                assert.equal(await music.locator('.single-channel-people-count').textContent(), '12');
                assert.deepEqual(queries.slice(before), ['NAMES #music']);
                await page.screenshot({path: 'test-results/' + theme + '-phone-channels.png'});
                await music.tap();
                await page.getByText('Hello from Alice', {exact: true}).waitFor();
                assert.equal(await page.locator('#channel-list-container .connected-client').count(), 3);
                await page.locator('#chat-input-container-text-input').fill('Mobile send test');
                await page.locator('#chat-input-container-send-chat-input').tap();
                await page.getByText('Received your message', {exact: true}).waitFor();
                await page.screenshot({path: 'test-results/' + theme + '-phone-chat.png'});
                await page.locator('#hide-chat-button').tap();
                await music.locator('.single-channel-people-count').getByText('3', {exact: true}).waitFor();
                await page.locator('#local-settings-button').tap();
                await page.locator('#local-settings-section-select').selectOption('local-settings-tab-appearance');
                const roleSetting = page.getByLabel('show IRC role icons in the channel list', {exact: false});
                await roleSetting.uncheck();
                await page.locator('#local-settings-show-channel-people').uncheck();
                await page.locator('#local-settings-close-button').tap();
                await page.locator('#local-settings-x-button').tap();
                assert.ok(await music.locator('.single-channel-people').isHidden());
                assert.ok(await page.locator('#channel-list-container .irc-role').first().isHidden());
                await page.locator('#local-settings-button').tap();
                await roleSetting.check();
                await page.locator('#local-settings-show-channel-people').check();
                await page.locator('#local-settings-x-button').tap();
                assert.ok(await music.locator('.single-channel-people').isHidden());
                assert.ok(await page.locator('#channel-list-container .irc-role').first().isHidden());
                await page.locator('#local-settings-button').tap();
                await roleSetting.check();
                await page.locator('#local-settings-show-channel-people').check();
                await page.screenshot({path: 'test-results/' + theme + '-phone-settings.png'});
                assert.deepEqual(await page.locator('#local-settings-section-select option').allTextContents(), ['Appearance', 'Chat', 'Audio', 'Advanced']);
                for (const section of ['appearance', 'chat', 'audio', 'advanced'])
                {
                    await page.locator('#local-settings-section-select').selectOption('local-settings-tab-' + section);
                    const visible = await page.locator('#local-settings-page-' + section).innerText();
                    assert.doesNotMatch(visible, /public keys|microphone|push.to.talk|WebRTC|server groups|identity key size|only my channel|flat channel list|people on the side/i);
                    assert.equal(await page.locator('#local-settings-page-' + section + ' :is(input, select, button):disabled:visible:not(input[type="color"])').count(), 0);
                    if (section === 'appearance')
                    {
                        const colors = await page.locator('.irc-color-controls').evaluateAll(rows => rows.map(row =>
                        {
                            const enabled = row.querySelector('input[type="checkbox"]');
                            const color = row.querySelector('input[type="color"]');
                            return color.disabled === !enabled.checked && row.getBoundingClientRect().right <= innerWidth;
                        }));
                        assert.ok(colors.every(Boolean));
                    }
                }
                await page.locator('#local-settings-section-select').selectOption('local-settings-tab-audio');
                assert.ok(await page.locator('#local-settings-sound-effects').isEnabled());
                await page.locator('#local-settings-section-select').selectOption('local-settings-tab-appearance');
                await page.locator('#local-settings-close-button').tap();
                await page.locator('#local-settings-x-button').tap();
                assert.ok(await music.locator('.single-channel-people').isVisible());
                assert.ok(await page.locator('#channel-list-container .irc-role').first().isVisible());
                await music.tap();
                await page.locator('#channel-list-container .connected-client').filter({hasText: 'Alice'}).tap();
                await page.locator('#chat-input-container-text-input').fill('Private mobile test');
                await page.locator('#chat-input-container-send-chat-input').tap();
                await page.getByText('Received your message', {exact: true}).waitFor();
                if (theme === 'mobile-2')
                {
                    await page.locator('#irc-conversation-picker').click();
                    await page.locator('.irc-conversation-option[data-context="channel:#music"]').click();
                    await page.getByText('Hello from Alice', {exact: true}).waitFor();
                    await page.locator('#show-hide-member-list-button').tap();
                    await page.locator('#current-channel-description').getByText('Topic stays in the description', {exact: true}).waitFor();
                    await page.locator('#show-hide-member-list-button').tap();
                }
                await page.setViewportSize({width: 1024, height: 768});
                await music.locator('.single-channel-people-count').getByText('3', {exact: true}).waitFor();
                await page.screenshot({path: 'test-results/' + theme + '-wide.png'});
                await page.locator('#choose-theme-button').tap();
                await page.locator('.choose-theme-item[data-name="aero"]').tap();
                assert.equal(await page.evaluate(() => g_layout.grid_active), true);
                assert.ok(await music.isVisible());
                await page.locator('#choose-theme-button').tap();
                await page.locator('.choose-theme-item[data-name="' + theme + '"]').tap();
                await page.setViewportSize({width: 320, height: 568});
                await page.locator('#hide-chat-button').tap();
                await music.waitFor();
                await page.screenshot({path: 'test-results/' + theme + '-small.png'});
                const connections = await page.locator('#connections-menu-button').boundingBox();
                assert.ok(connections.x >= 0 && connections.x + connections.width <= 320, theme + ' Connections fits at 320 pixels');
                await page.locator('#connections-menu-button').tap();
                await page.locator('#connections-menu-connect').tap();
                await page.locator('#connect-window-close-button').tap();
                await page.evaluate(() =>
                {
                    for (let index = 0; index < 1000; index++)
                    {
                        const name = '#room' + index;
                        window.ircClient.directory.set(name, {id: 'channel:' + name, name, count: 2, topic: ''});
                    }
                    window.ircClient.directoryRevision++;
                    window.ircClient.changed();
                });
                await page.waitForFunction(() => document.querySelector('.single-channel[data-channel-id="network"]')?.title.startsWith('1002 public channels'));
                await page.locator('#channel-list-container').evaluate(node => node.scrollTop = node.scrollHeight);
                await page.getByRole('button', {name: '#room999', exact: true}).waitFor();
                assert.ok(await page.locator('#channel-list-container .single-channel').count() < 100);
                await page.keyboard.press('Control+f');
                await page.getByRole('searchbox', {name: 'Filter channels', exact: true}).fill('room998');
                await page.getByRole('button', {name: '#room998', exact: true}).waitFor();
                await page.getByRole('button', {name: 'Close channel filter', exact: true}).tap();
                await page.locator('#local-settings-button').tap();
                await roleSetting.uncheck();
                await page.locator('#local-settings-show-channel-people').uncheck();
                await page.locator('#local-settings-close-button').tap();
                await page.locator('#local-settings-x-button').tap();
                await page.reload();
                await page.locator('#local-settings-button').tap();
                assert.equal(await roleSetting.isChecked(), false);
                assert.equal(await page.locator('#local-settings-show-channel-people').isChecked(), false);
                assert.deepEqual(errors, []);
                console.log('PASS ' + theme + ': counts, roles, touch joins and messages, settings save/cancel/reload, contexts, small toolbar, large tree, resize and theme switching');
            }
            catch (error)
            {
                await page.screenshot({path: 'test-results/' + theme + '-mobile-failure.png'});
                console.error('Page errors:', errors);
                throw error;
            }
            finally
            {
                await context.close();
            }
        }
    }
    finally
    {
        await browser.close();
        bridge.close();
        for (const socket of peers)
        {
            socket.destroy();
        }
        server.close();
    }
})().catch(error =>
{
    console.error(error);
    process.exitCode = 1;
});
