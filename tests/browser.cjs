const {chromium} = require('playwright');
const net = require('node:net');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {createBridge} = require('../bridge/server.cjs');

(async () =>
{
    const peers = new Set();
    const memberQueries = [];
    const commands = [];
    const irc = net.createServer(socket =>
    {
        peers.add(socket);
        socket.on('close', () => peers.delete(socket));
        socket.setEncoding('utf8');
        let pending = '';
        let nick = 'test';
        const reply = text => socket.write(text + '\r\n');
        socket.on('data', data =>
        {
            pending += data;
            let end;
            while ((end = pending.indexOf('\r\n')) >= 0)
            {
                const line = pending.slice(0, end);
                commands.push(line);
                pending = pending.slice(end + 2);
                if (line.startsWith('NICK '))
                {
                    nick = line.slice(5);
                }
                if (line === 'CAP LS 302')
                {
                    reply(':s CAP * LS :multi-prefix server-time message-tags batch draft/metadata-2 account-notify away-notify extended-join chghost setname');
                }
                if (line.startsWith('CAP REQ '))
                {
                    reply(':s CAP * ACK :' + line.slice(9));
                }
                if (line === 'CAP END')
                {
                    reply(':s NOTICE ' + nick + ' :Server welcome notice');
                    reply(':s 001 ' + nick + ' :Welcome');
                    reply(':s 005 ' + nick + ' NETWORK=LocalTest PREFIX=(ov)@+ draft/FILEHOST=https://media.example.test/upload?a=b=c :supported');
                }
                if (line === 'LIST')
                {
                    reply(':s 321 ' + nick + ' Channel :Users Name');
                    for (const channel of ['#music', '#programming', '#private', '#locked'])
                    {
                        reply(':s 322 ' + nick + ' ' + channel + ' 2 :A shared channel');
                    }
                    reply(':s 323 ' + nick + ' :End of LIST');
                }
                if (line.startsWith('NAMES '))
                {
                    memberQueries.push(line);
                    const channel = line.slice(6);
                    reply(':s 353 ' + nick + ' = ' + channel + ' :@Alice');
                    reply(':s 366 ' + nick + ' ' + channel + ' :end');
                }
                if (['JOIN #music', 'JOIN #programming', 'JOIN #locked secret'].includes(line))
                {
                    const channel = line.split(' ')[1];
                    reply(':' + nick + '!u@h JOIN ' + channel + ' * :Test client');
                    reply(':s 353 ' + nick + ' = ' + channel + ' :@Alice @' + nick);
                    reply(':s 366 ' + nick + ' ' + channel + ' :end');
                    reply(':s METADATA Alice avatar * :https://media.example.test/avatar.png');
                    reply(':s METADATA Alice display-name * :Alice Example');
                    reply(':s 332 ' + nick + ' ' + channel + ' :A shared channel');
                    reply(':Alice!u@h PRIVMSG ' + channel + ' :Hello from ' + channel);
                    if (channel === '#music')
                    {
                        reply(':Alice!u@h PRIVMSG ' + nick + ' :Private hello');
                    }
                }
                if (line.startsWith('PRIVMSG #music :'))
                {
                    reply(':Alice!u@h PRIVMSG #music :Received your message');
                }
                if (line === 'WHOIS Alice')
                {
                    reply(':s 311 ' + nick + ' Alice alice cloak.example * :Alice Example');
                    reply(':s 312 ' + nick + ' Alice s :Test server');
                    reply(':s 319 ' + nick + ' Alice :@#music @#programming');
                    reply(':s 344 ' + nick + ' Alice SK :is connecting from Slovakia');
                    reply(':s 318 ' + nick + ' Alice :End of WHOIS');
                }
                if (line.startsWith('MODE #music '))
                {
                    reply(':s ' + line);
                }
                if (line === 'JOIN #private')
                {
                    reply(':s 473 ' + nick + ' #private :This channel requires an invitation');
                }
                if (line === 'JOIN #locked')
                {
                    reply(':s 475 ' + nick + ' #locked :A channel password is required');
                }
            }
        });
    });
    await new Promise(resolve => irc.listen(0, '127.0.0.1', resolve));
    const target = {host: '127.0.0.1', port: irc.address().port, tls: false};
    const bridge = await createBridge({port: 0, target, networks: [{...target, id: 'primary', name: 'Local test'}, {...target, id: 'secondary', name: 'Other test'}]});
    const browser = await chromium.launch({executablePath: process.env.BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true});
    try
    {
        const page = await browser.newPage({viewport: {width: 1280, height: 800}});
        const uploads = [];
        await page.route('https://media.example.test/**', async route =>
        {
            const headers = {'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-expose-headers': 'Location'};
            if (route.request().method() === 'OPTIONS')
            {
                await route.fulfill({status: 204, headers});
            }
            else if (route.request().method() === 'POST')
            {
                uploads.push({url: route.request().url(), body: route.request().postData(), authorization: route.request().headers().authorization});
                await route.fulfill({status: 201, headers: {...headers, Location: '/photo.png'}});
            }
            else
            {
                await route.fulfill({status: 200, headers, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64')});
            }
        });
        await page.addInitScript(() =>
        {
            window.audioEvents = [];
            const play = HTMLMediaElement.prototype.play;
            HTMLMediaElement.prototype.play = function()
            {
                const record = {source: this.src, played: false};
                window.audioEvents.push(record);
                const result = play.call(this);
                result?.then(() => record.played = true, () => record.played = false);
                return result;
            };
        });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(bridge.url);
        await page.locator('#connections-menu-button').click();
        await page.locator('#connections-menu-connect').click();
        await page.locator('#irc-nickname').fill('LemonTest');
        await page.locator('#connect-button').click();
        await page.waitForFunction(() => window.ircClient.connected && window.ircClient.directory.size === 4 && !window.ircClient.listing);
        assert.equal(await page.evaluate(() => window.ircClient.channels.size), 0);
        assert.deepEqual(memberQueries, []);
        assert.equal(await page.locator('.single-channel[data-channel-id^="channel:"] [aria-expanded="true"]').count(), 0);
        assert.equal(await page.locator('.chat-context-selector[data-chat-context-selector-id="network"]').count(), 0);
        assert.equal(await page.locator('#chat-context-container').textContent(), '');
        assert.deepEqual(await page.locator('#connections-menu-list .head-menu-dropdown-item').allTextContents(), ['connect', 'disconnect']);
        assert.equal(await page.locator('#groups-menu').count(), 0);
        await page.getByRole('button', {name: 'Toggle members of #music', exact: true}).click();
        await page.waitForFunction(() => window.ircClient.channel('#music').members.size === 1);
        assert.equal(await page.evaluate(() => window.ircClient.channel('#music').joined), false);
        await page.getByRole('button', {name: 'Toggle members of #music', exact: true}).click();
        await page.getByRole('button', {name: 'Toggle members of #music', exact: true}).click();
        assert.deepEqual(memberQueries, ['NAMES #music']);
        await page.locator('.single-channel[aria-label="#music"]').dblclick();
        await page.locator('.single-channel[aria-label="#programming"]').dblclick();
        await page.waitForFunction(() => window.ircClient.channel('#music').joined && window.ircClient.channel('#programming').joined);
        await page.evaluate(() => window.ircClient.channel('#music').membersUpdated = 0);
        await page.getByRole('button', {name: 'Toggle members of #music', exact: true}).click();
        await page.getByRole('button', {name: 'Toggle members of #music', exact: true}).click();
        assert.deepEqual(memberQueries, ['NAMES #music']);
        assert.equal(await page.evaluate(() => [...window.ircClient.conversations.values()].some(conversation => conversation.user?.nick === 's')), false);
        await page.locator('.single-channel[aria-label="#music"]').click();
        for (const peer of peers)
        {
            peer.write('@+typing=active :Alice!u@h TAGMSG #music\r\n');
        }
        await page.locator('#typing-indicator-container').getByText('Alice is typing', {exact: true}).waitFor();
        await page.locator('#chat-input-container-text-input').fill('Testing the copied composer');
        fs.mkdirSync('test-results', {recursive: true});
        await page.screenshot({path: 'test-results/composer.png'});
        await page.locator('#chat-input-container-send-chat-input').click();
        await page.getByText('Received your message', {exact: true}).waitFor();
        assert.ok(await page.locator('#typing-indicator-container').isHidden());
        await page.locator('#choose_image_input').setInputFiles({name: 'picture.png', mimeType: 'image/png', buffer: Buffer.from('test upload')});
        await page.getByRole('dialog').getByRole('button', {name: 'Upload', exact: true}).click();
        await page.waitForFunction(() => document.getElementById('chat-input-container-text-input').value.includes('https://media.example.test/photo.png'));
        assert.equal(uploads[0].url, 'https://media.example.test/upload?a=b=c');
        assert.equal(uploads[0].body, 'test upload');
        assert.equal(uploads[0].authorization, undefined);
        await page.locator('#chat-input-container-send-chat-input').click();
        await page.locator('#chat-context-container img[alt="Shared image"]').waitFor();
        for (const peer of peers)
        {
            peer.write(':Alice!u@h PRIVMSG #music :https://media.example.test/song.opus\r\n');
        }
        await page.locator('#chat-context-container audio').waitFor();
        await page.evaluate(() => window.testAudioPlayer = document.querySelector('#chat-context-container audio'));
        for (const peer of peers)
        {
            peer.write('@+typing=active :Alice!u@h TAGMSG #music\r\n');
        }
        await page.locator('#typing-indicator-container').getByText('Alice is typing', {exact: true}).waitFor();
        assert.equal(await page.evaluate(() => window.testAudioPlayer === document.querySelector('#chat-context-container audio')), true);
        await page.waitForFunction(() => window.audioEvents.some(event => event.played && event.source === g_sound_effects.message_received.src));
        assert.equal(await page.evaluate(() => window.audioEvents.some(event => event.source === g_sound_effects.message_sent.src)), false);
        await page.locator('#chat-input-container-text-input').fill('/this is ordinary message text');
        await page.locator('#chat-input-container-send-chat-input').click();
        await page.getByText('/this is ordinary message text', {exact: true}).waitFor();
        await page.locator('#chat-input-container-text-input').fill('A'.repeat(600));
        await page.locator('#chat-input-container-send-chat-input').click();
        await page.locator('#chat-context-container').getByText('This IRC line is too long or contains a line break.', {exact: true}).waitFor();
        assert.equal(await page.locator('#chat-input-container-text-input').inputValue(), 'A'.repeat(600));
        await page.locator('#chat-input-container-text-input').fill('');
        await page.locator('.single-channel[aria-label="#private"]').dblclick();
        await page.locator('#chat-context-container').getByText('#private This channel requires an invitation', {exact: true}).waitFor();
        const aliceRows = page.locator('#channel-list-container .connected-client').filter({hasText: 'Alice'});
        assert.equal(await aliceRows.count(), 2);
        assert.equal(await aliceRows.locator('.client-audio-state').count(), 2);
        await aliceRows.first().click();
        await page.getByText('Private hello', {exact: true}).waitFor();
        await page.locator('#current-client-description').getByText('SK · is connecting from Slovakia', {exact: true}).waitFor();
        assert.equal(await aliceRows.first().locator('.irc-role[title="Channel operator (@)"]').count(), 1);
        assert.equal(await aliceRows.first().locator('.irc-avatar').count(), 1);
        assert.equal(await aliceRows.first().locator('.country-flag-sk').count(), 1);
        assert.ok(await aliceRows.first().locator('.irc-role').isVisible());
        await aliceRows.first().click({button: 'right'});
        await page.getByRole('menuitem', {name: 'give voice', exact: true}).click();
        await aliceRows.first().locator('.irc-role[title*="Voice (moderated text) (+)"]').waitFor();
        await aliceRows.first().click({button: 'right'});
        await page.getByRole('menuitem', {name: 'take voice', exact: true}).click();
        await page.waitForFunction(() => !window.ircClient.channel('#music').members.get(window.ircClient.user('Alice').id).modes.includes('v'));
        await aliceRows.last().click();
        assert.equal(await page.locator('.chat-context-selector').filter({hasText: /^Alice$/}).count(), 1);
        for (const peer of peers)
        {
            peer.write(':Alice!u@h AWAY :Taking a break\r\n');
        }
        await aliceRows.first().and(page.locator('.irc-away')).waitFor();
        fs.mkdirSync('test-results', {recursive: true});
        const themes = await page.locator('.choose-theme-item').evaluateAll(options => options.map(option => option.dataset.name));
        assert.deepEqual(themes, ['default', 'hybrid', 'hybrid-v2', 'aero', 'ozone', 'termix', 'default-mobile', 'mobile-2']);
        for (const theme of themes.filter(name => !['default-mobile', 'mobile-2'].includes(name)))
        {
            await page.locator('#choose-theme-button').click();
            await page.locator('.choose-theme-item[data-name="' + theme + '"]').click();
            await aliceRows.first().click();
            const awayIcon = await aliceRows.first().locator('.client-audio-state').boundingBox();
            const localIcon = await page.locator('#channel-list-container .connected-local-client .client-audio-state').first().boundingBox();
            assert.ok(Math.abs(awayIcon.x - localIcon.x) < 1, theme + ' away and active members have equal indentation');
            // activity dots, flags and role badges keep one column each, whatever the row contains
            const columns = await page.evaluate(() =>
            {
                const rows = [...document.querySelectorAll('#channel-list-container .connected-client')].filter(row => row.offsetWidth);
                const lefts = selector => [...new Set(rows.map(row => row.querySelector(selector)).filter(node => node && node.offsetWidth).map(node => Math.round(node.getBoundingClientRect().left)))];
                return [lefts('.client-groups'), lefts('.irc-activity'), lefts('.connected-client-country-flag')];
            });
            assert.ok(columns.every(column => column.length <= 1), theme + ' member indicators stay in columns ' + JSON.stringify(columns));
            // left to right: role, activity, flag
            const order = columns.filter(column => column.length).map(column => column[0]);
            assert.deepEqual(order, [...order].sort((a, b) => a - b), theme + ' member indicators keep the order role, activity, flag ' + JSON.stringify(columns));
            assert.ok(await aliceRows.first().locator('.irc-role').first().isVisible(), theme + ' role badge remains visible');
            await aliceRows.first().click({button: 'right'});
            const infoAction = page.getByRole('menuitem', {name: 'info', exact: true});
            const icon = await infoAction.evaluate(node => ({display: getComputedStyle(node, '::before').display, image: getComputedStyle(node, '::before').backgroundImage, mask: getComputedStyle(node, '::before').maskImage}));
            if (icon.display !== 'none')
            {
                assert.ok(icon.image.startsWith('url(') || icon.mask.startsWith('url('), theme + ' menu keeps its copied icon');
            }
            await page.screenshot({path: 'test-results/' + theme + '-member-menu.png'});
            await infoAction.click();
            await page.locator('#irc-user-information').getByRole('button', {name: 'Close', exact: true}).click();
            await page.getByRole('button', {name: 'Show country flags', exact: true}).click();
            assert.ok(await aliceRows.first().locator('.connected-client-country-flag').isHidden());
            await page.getByRole('button', {name: 'Show country flags', exact: true}).click();
            assert.ok(await aliceRows.first().locator('.country-flag-sk').isVisible());
            assert.ok(await page.locator('#current-client-description').isVisible(), theme + ' client details are visible');
            await page.screenshot({path: 'test-results/' + theme + '-client-profile.png'});
            assert.ok(await page.locator('#irc-channel-filter').isHidden());
            await page.locator('#chat-input-container-text-input').focus();
            await page.keyboard.press('Control+f');
            await page.getByRole('searchbox', {name: 'Filter channels', exact: true}).fill('MUSIC');
            assert.deepEqual(await page.locator('#channel-list-container .single-channel-name-p').allTextContents(), ['LocalTest', 'music']);
            assert.equal(await page.locator('#irc-channel-filter output').textContent(), '1 channel');
            assert.equal(await page.evaluate(() => window.ircClient.channel('#programming').joined), true);
            const filterBounds = await page.locator('#irc-channel-filter').boundingBox();
            const listBounds = await page.locator('#channel-list-container').boundingBox();
            assert.ok(filterBounds.y + filterBounds.height <= listBounds.y + 1, theme + ' filter stays above the list');
            await page.screenshot({path: 'test-results/' + theme + '-channel-filter.png'});
            await page.keyboard.press('Control+f');
            assert.equal(await page.locator('#irc-channel-filter').count(), 1);
            await page.getByRole('searchbox', {name: 'Filter channels', exact: true}).fill('no-such-channel');
            assert.equal(await page.locator('#irc-channel-filter output').textContent(), 'No matching channels');
            await page.keyboard.press('Escape');
            assert.ok(await page.locator('#irc-channel-filter').isHidden());
            assert.equal(await page.evaluate(() => document.activeElement.id), 'chat-input-container-text-input');
            await page.locator('.single-channel[aria-label="#music"]').click();
            assert.equal(await page.locator('.chat-context-selector[data-chat-context-selector-id="channel:#music"] .p-container').textContent(), 'music');
            assert.equal(await page.locator('#current-channel-description strong').textContent(), 'music');
            await page.screenshot({path: 'test-results/' + theme + '-desktop.png'});
            await page.locator('#show-hide-log-button').click();
            await page.locator('#textarea-log').getByText(/Server welcome notice/).waitFor();
            assert.equal(await page.locator('#chat-context-container').getByText(/Server welcome notice/).count(), 0);
            const logBounds = await page.locator('#textarea-log').boundingBox();
            assert.ok(logBounds.width > 100 && logBounds.height > 100 && logBounds.y >= 0 && logBounds.y + logBounds.height <= 800, theme + ' log stays on screen');
            const toolbarBounds = await page.locator('#communication-system-head-menu').boundingBox();
            assert.ok(logBounds.y >= toolbarBounds.y + toolbarBounds.height, theme + ' toolbar does not hide log lines');
            await page.screenshot({path: 'test-results/' + theme + '-log.png'});
            await page.locator('#show-hide-log-button').click();
            assert.ok(await page.locator('#textarea-log').isHidden());
            const bounds = await page.locator('#chat-input-container-text-input').boundingBox();
            assert.ok(bounds && bounds.width > 100 && bounds.y + bounds.height <= 800, theme + ' composer on screen');
            const tree = await page.locator('#space-devider1').boundingBox();
            assert.ok(tree.width >= 180 && tree.width < 220, theme + ' original 15% channel column');
            const toolbar = await page.locator('#communication-system-head-menu').boundingBox();
            assert.ok(toolbar.height < 70, theme + ' original compact toolbar');
            assert.equal(await page.locator('#chat-input-container-send-chat-input').evaluate(node => node.parentElement.className), 'chat-controls-container');
            for (const icon of ['#choose-theme-button', '#clear-chat-button', '#hide-chat-button', '#local-settings-button', '#layout-edit-button'])
            {
                assert.ok(await page.locator(icon).isVisible(), theme + ' retains ' + icon);
            }
            await page.locator('#local-settings-button').click();
            await page.locator('#local-settings-show-channel-people').uncheck();
            await page.getByLabel('show IRC role icons in the channel list', {exact: false}).uncheck();
            await page.locator('#local-settings-chat-scale').fill('125');
            await page.locator('#local-settings-close-button').click();
            assert.ok(await page.locator('#local-settings-container').isHidden(), theme + ' settings save works');
            assert.ok(await aliceRows.first().locator('.irc-role').first().isHidden(), theme + ' role setting hides badges');
            assert.ok(await page.locator('.single-channel[aria-label="#music"] .single-channel-people').isHidden(), theme + ' count setting hides counts');
            await page.locator('#local-settings-button').click();
            await page.locator('#local-settings-show-channel-people').check();
            await page.getByLabel('show IRC role icons in the channel list', {exact: false}).check();
            await page.locator('#local-settings-chat-scale-reset').click();
            await page.screenshot({path: 'test-results/' + theme + '-irc-settings.png'});
            await page.locator('#local-settings-close-button').click();
            assert.ok(await aliceRows.first().locator('.irc-role').first().isVisible(), theme + ' role setting restores badges');
            assert.ok(await page.locator('.single-channel[aria-label="#music"] .single-channel-people').isVisible(), theme + ' count setting restores counts');
            await page.getByRole('button', {name: 'Browse IRC servers', exact: true}).click();
            await page.getByRole('button', {name: 'Choose Other test', exact: true}).waitFor();
            await page.screenshot({path: 'test-results/' + theme + '-servers.png'});
            await page.locator('#irc-network-browser').getByRole('button', {name: 'Close', exact: true}).click();
            await aliceRows.first().click({button: 'right'});
            await page.getByRole('menuitem', {name: 'info', exact: true}).click();
            await page.locator('#irc-user-information').getByText('Alice Example', {exact: true}).first().waitFor();
            await page.locator('#irc-user-information').getByText('Information provided by the server', {exact: true}).waitFor();
            await page.screenshot({path: 'test-results/' + theme + '-user-information.png'});
            await page.locator('#irc-user-information').getByRole('button', {name: 'Close', exact: true}).click();
            await page.locator('#connections-menu-button').click();
            await page.locator('#connections-menu-connect').click();
            assert.ok(await page.locator('#input-ip-address').isVisible(), theme + ' server address is visible');
            assert.ok(await page.locator('#input-port-number').isVisible(), theme + ' server port is visible');
            assert.equal(await page.locator('#irc-nickname').inputValue(), 'LemonTest');
            const choose = page.locator('#connect-server-section').getByRole('button', {name: 'Choose server', exact: true});
            assert.equal(await choose.evaluate(node => getComputedStyle(node).whiteSpace), 'nowrap');
            await page.screenshot({path: 'test-results/' + theme + '-connection.png'});
            await page.locator('#connect-window-close-button').click();
        }
        await aliceRows.first().click({button: 'right'});
        await page.getByRole('menuitem', {name: 'ignore', exact: true}).click();
        for (const peer of peers)
        {
            peer.write(':Alice!u@h PRIVMSG #music :This is ignored\r\n');
        }
        await page.waitForTimeout(100);
        assert.equal(await page.evaluate(() => window.ircClient.conversation('channel:#music').messages.some(message => message.text === 'This is ignored')), false);
        await aliceRows.first().click({button: 'right'});
        await page.getByRole('menuitem', {name: 'unignore', exact: true}).click();
        await aliceRows.first().click({button: 'right'});
        await page.getByRole('menuitem', {name: 'kick', exact: true}).click();
        await page.getByRole('dialog').getByLabel('Reason', {exact: true}).fill('Test reason');
        await page.getByRole('dialog').getByRole('button', {name: 'Confirm', exact: true}).click();
        await page.waitForTimeout(50);
        assert.ok(commands.includes('KICK #music Alice :Test reason'));
        await aliceRows.first().click({button: 'right'});
        await page.getByRole('menuitem', {name: 'ban', exact: true}).click();
        await page.getByRole('dialog').getByLabel('Ban mask', {exact: true}).fill('Alice!*@*');
        await page.getByRole('dialog').getByRole('button', {name: 'Confirm', exact: true}).click();
        await page.waitForTimeout(50);
        assert.ok(commands.includes('MODE #music +b Alice!*@*'));
        await page.locator('.single-channel[aria-label="#music"]').click({button: 'right'});
        await page.getByRole('menuitem', {name: 'topic', exact: true}).click();
        await page.getByRole('dialog').getByLabel('Topic', {exact: true}).fill('An updated topic');
        await page.getByRole('dialog').getByRole('button', {name: 'Confirm', exact: true}).click();
        await page.waitForTimeout(50);
        assert.ok(commands.includes('TOPIC #music :An updated topic'));
        await page.evaluate(() =>
        {
            window.ircClient.user('Alice').lastActiveAt = Date.now() - 7200000;
            window.ircClient.changed();
        });
        await page.waitForFunction(() => document.querySelector('#channel-list-container .irc-activity[title="Last observed activity 2 hours ago"]')?.style.backgroundColor === 'rgb(0, 0, 0)');
        await page.evaluate(() =>
        {
            window.ircClient.user('Alice').lastActiveAt = Date.now();
            window.ircClient.changed();
        });
        await page.waitForFunction(() => document.querySelector('#channel-list-container .irc-activity[title="Last observed activity within the last minute"]')?.style.backgroundColor === 'rgb(0, 190, 70)');
        await page.locator('#local-settings-button').click();
        await page.locator('#irc-settings-activity').uncheck();
        await page.locator('#local-settings-close-button').click();
        assert.equal(await page.locator('.irc-activity').count(), 0);
        await page.locator('#local-settings-button').click();
        await page.locator('#irc-settings-activity').check();
        await page.locator('#local-settings-close-button').click();
        await page.locator('#local-settings-button').click();
        await page.locator('#local-settings-tab-advanced').click();
        await page.locator('#local-settings-show-log').uncheck();
        await page.locator('#local-settings-close-button').click();
        assert.ok(await page.locator('#show-hide-log-button').isHidden());
        assert.equal(await page.evaluate(() => localStorage.getItem('irc_show_log')), 'false');
        await page.locator('#local-settings-button').click();
        await page.locator('#local-settings-show-log').check();
        await page.locator('#local-settings-close-button').click();
        assert.ok(await page.locator('#show-hide-log-button').isVisible());
        await aliceRows.first().click();
        await page.locator('#chat-input-container-text-input').fill('Draft for Alice on the first network');
        await page.locator('#sound-effects-button').click();
        assert.equal(await page.evaluate(() => g_are_sound_effects_enabled), false);
        await page.evaluate(() => window.mutedSoundCount = window.audioEvents.length);
        await page.evaluate(() => window.firstClient = window.ircClient);
        await page.locator('#connections-menu-button').click();
        await page.locator('#connections-menu-connect').click();
        await page.locator('#connect-show-advanced').check();
        await page.locator('#irc-account').fill('first-account');
        await page.locator('#irc-password').fill('first-secret');
        await page.locator('#connect-server-section').getByRole('button', {name: 'Choose server', exact: true}).click();
        await page.getByRole('button', {name: 'Choose Other test', exact: true}).click();
        assert.equal(await page.locator('#irc-account').inputValue(), '');
        assert.equal(await page.locator('#irc-password').inputValue(), '');
        await page.locator('#connect-button').click();
        await page.waitForFunction(() => window.ircClient !== window.firstClient && window.ircClient.connected && window.ircClient.directory.size === 4);
        await page.locator('.single-channel[aria-label="#music"]').dblclick();
        await page.waitForFunction(() => window.ircClient.channel('#music').joined && window.ircClient.channel('#music').members.size === 2);
        await aliceRows.first().click();
        assert.equal(await page.locator('#chat-input-container-text-input').inputValue(), '');
        assert.equal(await page.evaluate(() => window.firstClient.private(window.firstClient.user('Alice')).draft), 'Draft for Alice on the first network');
        assert.equal(await page.evaluate(() => window.audioEvents.length), await page.evaluate(() => window.mutedSoundCount));
        await page.locator('#sound-effects-button').click();
        assert.equal(await page.evaluate(() => g_are_sound_effects_enabled), true);
        await page.locator('.single-channel[aria-label="#locked"]').dblclick();
        await page.getByRole('dialog').getByLabel('Password', {exact: true}).fill('secret');
        await page.getByRole('dialog').getByRole('button', {name: 'Confirm', exact: true}).click();
        await page.waitForFunction(() => window.ircClient.channel('#locked').joined);
        const duplicateIds = await page.evaluate(() =>
        {
            const ids = [...document.querySelectorAll('[id]')].map(node => node.id);
            return ids.filter((id, index) => ids.indexOf(id) !== index && id !== 'menu-bar-container');
        });
        assert.deepEqual(duplicateIds, []);
        const treePage = await browser.newPage({viewport: {width: 1280, height: 800}});
        treePage.on('pageerror', error => errors.push(error.message));
        await treePage.goto(bridge.url);
        await treePage.locator('#irc-nickname').fill('TreeTest');
        await treePage.locator('#connect-button').click();
        await treePage.waitForFunction(() => window.ircClient.connected && !window.ircClient.listing);
        await treePage.evaluate(() =>
        {
            window.ircClient.directory.clear();
            for (let index = 0; index < 8000; index++)
            {
                const name = '#channel' + index;
                window.ircClient.directory.set(name, {id: 'channel:' + name, name, count: 2, topic: ''});
            }
            for (const name of ['#libera', '#liberate', '##libera', '##liberal'])
            {
                window.ircClient.directory.set(name, {id: 'channel:' + name, name, count: 2, topic: ''});
            }
            window.ircClient.directoryRevision++;
            window.ircClient.changed();
        });
        await treePage.getByRole('button', {name: '##libera', exact: true}).waitFor();
        const lastChannel = await treePage.evaluate(() => [...window.ircClient.directory.values()].sort((a, b) => a.name.localeCompare(b.name)).at(-1).name);
        for (const theme of ['aero', 'hybrid', 'hybrid-v2', 'termix', 'ozone', 'default'])
        {
            await treePage.locator('#choose-theme-button').click();
            await treePage.locator('.choose-theme-item[data-name="' + theme + '"]').click();
            await treePage.waitForFunction(() => document.querySelector('.single-channel[data-channel-id="network"]')?.title.startsWith('8004 public channels'));
            await treePage.locator('#channel-list-container').evaluate(node => node.scrollTop = node.scrollHeight);
            await treePage.getByRole('button', {name: lastChannel, exact: true}).waitFor();
            await treePage.locator('#channel-list-container').evaluate(node => node.scrollTop = 0);
            await treePage.getByRole('button', {name: 'LocalTest', exact: true}).waitFor();
        }
        assert.equal(await treePage.getByRole('button', {name: '##libera', exact: true}).locator('.single-channel-name-p').textContent(), '#libera');
        await treePage.locator('#channel-list-container').focus();
        await treePage.keyboard.type('#libera');
        assert.equal(await treePage.evaluate(() => document.activeElement.getAttribute('aria-label')), '#libera');
        assert.ok(await treePage.locator('#channel-list-container .single-channel').count() < 150);
        await treePage.evaluate(() =>
        {
            window.previousFocusedRow = document.activeElement;
            window.ircClient.changed();
        });
        await treePage.waitForFunction(() => document.activeElement !== window.previousFocusedRow && document.activeElement.getAttribute('aria-label') === '#libera');
        await treePage.keyboard.press('Control+f');
        await treePage.getByRole('searchbox', {name: 'Filter channels', exact: true}).fill('channel7999');
        assert.deepEqual(await treePage.locator('#channel-list-container .single-channel-name-p').allTextContents(), ['LocalTest', 'channel7999']);
        await treePage.getByRole('button', {name: 'Close channel filter', exact: true}).click();
        assert.ok(await treePage.locator('#irc-channel-filter').isHidden());
        await treePage.evaluate(() =>
        {
            for (let index = 0; index < 30; index++)
            {
                window.ircClient.private(window.ircClient.user('LongConversationName' + index));
            }
            window.ircClient.changed();
        });
        for (const theme of ['default', 'hybrid', 'hybrid-v2', 'aero', 'termix', 'ozone'])
        {
            await treePage.locator('#choose-theme-button').click();
            await treePage.locator('.choose-theme-item[data-name="' + theme + '"]').click();
            const picker = treePage.locator('#irc-conversation-picker');
            const bounds = await picker.boundingBox();
            const chat = await treePage.locator('#space-devider2').boundingBox();
            assert.ok(bounds.x >= chat.x - 1 && bounds.x + bounds.width <= chat.x + chat.width + 1, theme + ' dropdown stays in the chat column');
            await picker.click();
            await treePage.getByRole('searchbox', {name: 'Find a conversation', exact: true}).fill('LongConversationName29');
            await treePage.getByRole('option', {name: 'LongConversationName29', exact: true}).click();
            await treePage.evaluate(() => window.ircClient.changed());
            await treePage.waitForTimeout(50);
            assert.equal(await picker.locator('.irc-conversation-name').textContent(), 'LongConversationName29');
            await treePage.screenshot({path: 'test-results/' + theme + '-conversation-picker.png'});
        }
        await treePage.close();
        const identityPage = await browser.newPage({viewport: {width: 1280, height: 800}});
        identityPage.on('pageerror', error => errors.push(error.message));
        await identityPage.goto(bridge.url);
        await identityPage.evaluate(network =>
        {
            const storage = {read: () => utils__storage_get('identities'), write: value => utils__storage_set('identities', value)};
            LemonIrc.Identities.remember(storage, network, 'GuestName', '');
            LemonIrc.Identities.remember(storage, network, 'AliceHome', 'alice-home');
            LemonIrc.Identities.remember(storage, {...network, host: 'other.example'}, 'OtherName', 'other-account');
            LemonIrc.Identities.remember(storage, network, 'AliceWork', 'alice-work');
        }, target);
        await identityPage.locator('#connections-menu-button').click();
        await identityPage.locator('#connections-menu-connect').click();
        await identityPage.locator('#irc-identity option[value="alice-work"]').waitFor({state: 'attached'});
        assert.equal(await identityPage.locator('#irc-identity').inputValue(), 'alice-work');
        assert.equal(await identityPage.locator('#irc-account').inputValue(), 'alice-work');
        assert.equal(await identityPage.locator('#irc-nickname').inputValue(), 'AliceWork');
        assert.equal(await identityPage.locator('#irc-password').inputValue(), '');
        assert.equal(await identityPage.locator('#irc-identity option[value="other-account"]').count(), 0);
        await identityPage.screenshot({path: 'test-results/saved-identities.png'});
        await identityPage.locator('#irc-password').fill('not-persisted');
        await identityPage.locator('#irc-identity').selectOption('alice-home');
        assert.equal(await identityPage.locator('#irc-password').inputValue(), '');
        assert.equal(await identityPage.locator('#irc-nickname').inputValue(), 'AliceHome');
        await identityPage.locator('#irc-identity').selectOption('');
        assert.equal(await identityPage.locator('#irc-account').inputValue(), '');
        assert.equal(await identityPage.locator('#irc-nickname').inputValue(), 'GuestName');
        assert.ok(await identityPage.locator('#irc-password').isHidden());
        await identityPage.locator('#irc-identity').selectOption('*new*');
        assert.ok(await identityPage.locator('#irc-password').isVisible());
        assert.equal(await identityPage.locator('#irc-account').inputValue(), '');
        await identityPage.locator('#irc-identity').selectOption('alice-work');
        await identityPage.getByRole('button', {name: 'Forget saved identity', exact: true}).click();
        await identityPage.locator('#irc-identity option[value="alice-work"]').waitFor({state: 'detached'});
        assert.equal(await identityPage.locator('#irc-password').inputValue(), '');
        assert.equal(await identityPage.evaluate(() => utils__storage_get('identities').includes('not-persisted')), false);
        await identityPage.close();
        assert.deepEqual(errors, []);
        console.log('PASS connection, shared memberships, same DM, send/receive, visible errors, literal slash messages, original sound playback and mute, original toolbar and composer, settings, network browser, user information, isolated network drafts and credentials, and all six desktop themes');
    }
    finally
    {
        await browser.close();
        bridge.close();
        for (const socket of peers)
        {
            socket.destroy();
        }
        irc.close();
    }
})().catch(error =>
{
    console.error(error);
    process.exitCode = 1;
});
