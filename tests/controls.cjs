const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const net = require('node:net');
const fs = require('node:fs');
const {createBridge} = require('../bridge/server.cjs');

(async () =>
{
    const peers = new Set();
    const sent = [];
    const timedQueries = [];
    const server = net.createServer(socket =>
    {
        peers.add(socket);
        socket.on('close', () => peers.delete(socket));
        socket.setEncoding('utf8');
        let pending = '';
        let nick = 'Tester';
        const reply = line => socket.write(line + '\r\n');
        socket.on('data', data =>
        {
            pending += data;
            let end;
            while ((end = pending.indexOf('\r\n')) >= 0)
            {
                const line = pending.slice(0, end);
                pending = pending.slice(end + 2);
                sent.push(line);
                if (line.startsWith('NICK '))
                {
                    nick = line.slice(5);
                }
                else if (line === 'CAP LS 302')
                {
                    reply(':s CAP * LS :');
                }
                else if (line === 'CAP END')
                {
                    reply(':s 001 ' + nick + ' :Welcome');
                    reply(':s 004 ' + nick + ' s Fixture1 oi biklmnopst');
                    reply(':s 005 ' + nick + ' NETWORK=TestNet CHANMODES=b,k,l,imnst PREFIX=(ov)@+ :supported');
                }
                else if (line === 'LIST')
                {
                    for (const [name, count] of [['#Alpha', 2], ['#music', 6], ['#Zulu', 17]])
                    {
                        reply(':s 322 ' + nick + ' ' + name + ' ' + count + ' :Topic');
                    }
                    reply(':s 323 ' + nick + ' :end');
                }
                else if (line === 'JOIN #music')
                {
                    reply(':' + nick + '!u@h JOIN #music');
                    reply(':s 353 ' + nick + ' = #music :@' + nick + ' Alice Bob');
                    reply(':s 366 ' + nick + ' #music :end');
                }
                else if (line.startsWith('WHOIS '))
                {
                    const target = line.split(' ').at(-1);
                    timedQueries.push({line, time: Date.now()});
                    if (target === 'Missing')
                    {
                        reply(':s 401 ' + nick + ' Missing :No such nick');
                    }
                    else if (target !== 'NoReply')
                    {
                        reply(':s 311 ' + nick + ' ' + target + ' user host * :Example Person');
                        if (target === 'Alice' || target === 'Bob')
                        {
                            reply(':s 317 ' + nick + ' ' + target + ' 4 ' + (Math.floor(Date.now() / 1000) - (target === 'Alice' ? 7200 : 60)) + ' :seconds idle, signon time');
                        }
                        reply(':s 318 ' + nick + ' ' + target + ' :end');
                    }
                }
                else if (line === 'JOIN #locked')
                {
                    reply(':s 473 ' + nick + ' #locked :Cannot join channel (+i)');
                }
                else if (line === 'MODE #music')
                {
                    reply(':s 324 ' + nick + ' #music +nt');
                }
                else if (line === 'TOPIC #music')
                {
                    reply(':s 332 ' + nick + ' #music :Original topic');
                }
                else if (line === 'MODE #music b')
                {
                    reply(':s 367 ' + nick + ' #music banned!*@* oper 100');
                    reply(':s 368 ' + nick + ' #music :end');
                }
                else if (line.startsWith('MODE ') || line.startsWith('TOPIC '))
                {
                    reply(':s ' + line);
                }
                else if (line.startsWith('OPER '))
                {
                    reply(':s ' + (line === 'OPER oper :correct' ? '381 ' + nick + ' :You are now an IRC operator' : '464 ' + nick + ' :Password incorrect'));
                }
                else if (line === 'REHASH')
                {
                    reply(':s 382 ' + nick + ' fixture.conf :Rehashing');
                }
            }
        });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const bridge = await createBridge({port: 0, target: {host: '127.0.0.1', port: server.address().port, tls: false}});
    const browser = await chromium.launch({executablePath: process.env.BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true});
    const page = await browser.newPage({viewport: {width: 1280, height: 800}});
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.setDefaultTimeout(15000);
    const broadcast = line =>
    {
        for (const peer of peers)
        {
            peer.write(line + '\r\n');
        }
    };
    const root = page.locator('.single-channel[data-channel-id="network"]');
    const music = page.locator('.single-channel[aria-label="#music"]');
    const settings = async tab =>
    {
        await page.locator('#local-settings-button').click();
        if (await page.locator('#local-settings-section-select').isVisible())
        {
            await page.locator('#local-settings-section-select').selectOption('local-settings-tab-' + tab);
        }
        else
        {
            await page.locator('#local-settings-tab-' + tab).click();
        }
    };
    const save = async () =>
    {
        await page.locator('#local-settings-close-button').click();
        await page.locator('#local-settings-x-button').click();
    };
    const sort = async (owner, submenu, option) =>
    {
        await owner.click({button: 'right'});
        await page.getByRole('menuitem', {name: submenu, exact: true}).hover();
        await page.getByRole('menuitemradio', {name: option, exact: true}).click();
    };
    const lookup = async () =>
    {
        await root.click({button: 'right'});
        await page.getByRole('menuitem', {name: 'new chat', exact: true}).click();
        return page.locator('#irc-new-private-chat');
    };
    try
    {
        await page.addInitScript(() =>
        {
            window.soundEvents = [];
            const play = HTMLMediaElement.prototype.play;
            HTMLMediaElement.prototype.play = function()
            {
                const event = {source: this.src, played: false};
                window.soundEvents.push(event);
                const promise = play.call(this);
                promise?.then(() => event.played = true, () => event.played = false);
                return promise;
            };
        });
        await page.goto(bridge.url);
        await page.locator('#irc-nickname').fill('Invalid Nick');
        await page.locator('#irc-username').fill('tester');
        await page.locator('#irc-realname').fill('Lemon Tester');
        await page.locator('#connect-button').click();
        await page.waitForFunction(() => window.soundEvents.some(event => event.source === g_sound_effects.error.src && event.played));
        assert.equal(await page.evaluate(() => window.ircClient.connected), false);
        await page.locator('#irc-nickname').fill('Tester');
        await page.locator('#irc-username').fill('tester');
        await page.locator('#irc-realname').fill('Lemon Tester');
        await page.locator('#connect-button').click();
        await page.waitForFunction(() => window.ircClient.connected && window.ircClient.directory.size === 3);
        await music.dblclick();
        await page.waitForFunction(() => window.ircClient.channel('#music').members.size === 3);
        const order = () => page.locator('#channel-list-container > .single-channel').evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label')));
        const beforeQueries = sent.filter(line => /^(LIST|NAMES|WHO)/.test(line)).length;
        for (const theme of ['default', 'hybrid', 'hybrid-v2', 'aero', 'termix', 'ozone'])
        {
            await page.locator('#choose-theme-button').click();
            await page.locator('.choose-theme-item[data-name="' + theme + '"]').click();
            await sort(root, 'sort', 'name z–a');
            assert.deepEqual(await order(), ['TestNet', '#music', '#Zulu', '#Alpha']);
            await sort(root, 'sort', 'name a–z');
            assert.deepEqual(await order(), ['TestNet', '#music', '#Alpha', '#Zulu']);
            await sort(root, 'sort', 'most users');
            assert.deepEqual(await order(), ['TestNet', '#music', '#Zulu', '#Alpha']);
            await sort(root, 'sort', 'fewest users');
            assert.deepEqual(await order(), ['TestNet', '#music', '#Alpha', '#Zulu']);
            await root.click({button: 'right'});
            await page.getByRole('menuitem', {name: 'sort', exact: true}).focus();
            await page.keyboard.press('ArrowRight');
            await page.keyboard.press('Escape');
            await page.keyboard.press('ArrowRight');
            assert.ok(await page.getByRole('menuitemradio', {name: 'name a–z', exact: true}).isVisible());
            await page.screenshot({path: 'test-results/' + theme + '-sort-menu.png'});
            await page.keyboard.press('Escape');
            await page.keyboard.press('Escape');
        }
        assert.equal(sent.filter(line => /^(LIST|NAMES|WHO)/.test(line)).length, beforeQueries);
        await settings('appearance');
        assert.ok(await page.locator('#irc-settings-joined-first').isChecked());
        await page.locator('#irc-settings-joined-first').uncheck();
        await save();
        for (const [label, expected] of [['name a–z', ['#Alpha', '#music', '#Zulu']], ['name z–a', ['#Zulu', '#music', '#Alpha']], ['most users', ['#Zulu', '#music', '#Alpha']], ['fewest users', ['#Alpha', '#music', '#Zulu']]])
        {
            await sort(root, 'sort', label);
            assert.deepEqual(await order(), ['TestNet', ...expected]);
        }
        broadcast(':Tester!u@h JOIN #Hidden');
        await page.waitForFunction(() => window.ircClient.channel('#Hidden').joined);
        assert.deepEqual(await order(), ['TestNet', '#Hidden', '#Alpha', '#music', '#Zulu']);
        broadcast(':Tester!u@h PART #Hidden :Fixture');
        await page.waitForFunction(() => !window.ircClient.channel('#Hidden').joined);
        await music.click();
        await settings('appearance');
        await page.locator('#irc-settings-joined-first').check();
        assert.deepEqual(await order(), ['TestNet', '#music', '#Alpha', '#Zulu']);
        await page.locator('#local-settings-x-button').click();
        assert.deepEqual(await order(), ['TestNet', '#Alpha', '#music', '#Zulu']);
        assert.equal(sent.filter(line => /^(LIST|NAMES|WHO)/.test(line)).length, beforeQueries);
        await page.evaluate(() =>
        {
            window.ircClient.user('Alice').lastActiveAt = Date.now() - 3600000;
            window.ircClient.user('Bob').lastActiveAt = Date.now();
            window.ircClient.user('Tester').lastActiveAt = 0;
        });
        await sort(music, 'sort users', 'recently active');
        assert.deepEqual(await page.locator('#channel-list-container .client-name-text').allTextContents(), ['Bob', 'Alice', 'Tester']);
        await sort(music, 'sort users', 'name a–z');
        assert.deepEqual(await page.locator('#channel-list-container .client-name-text').allTextContents(), ['Alice', 'Bob', 'Tester']);
        broadcast(':s 005 Tester PREFIX=(yoav)!@&+ :supported');
        broadcast(':s MODE #music +y Bob');
        broadcast(':s MODE #music +v Alice');
        await page.waitForFunction(() => window.ircClient.prefixModes === 'yoav');
        await sort(music, 'sort users', 'role');
        assert.deepEqual(await page.locator('#channel-list-container .client-name-text').allTextContents(), ['Bob', 'Tester', 'Alice']);
        assert.deepEqual(await page.locator('#member-list-body .client-name-text').allTextContents(), ['Bob', 'Tester', 'Alice']);
        broadcast(':s MODE #music -y Bob');
        broadcast(':s MODE #music -v Alice');
        broadcast(':s 005 Tester PREFIX=(ov)@+ :supported');
        await sort(music, 'sort users', 'role');
        assert.deepEqual(await page.locator('#channel-list-container .client-name-text').allTextContents(), ['Tester', 'Alice', 'Bob']);
        await page.evaluate(() => window.ircClient.user('NotVisible'));
        const beforeTimes = timedQueries.length;
        await sort(music, 'sort users', 'online longest');
        await page.evaluate(() => window.timeSortRedraw = setInterval(() => window.ircClient.changed(), 100));
        await page.waitForFunction(() => ['Alice', 'Bob', 'Tester'].every(nick => window.ircClient.user(nick).connectionTimeChecked));
        await page.waitForFunction(() => window.ircClient.user('Alice').connectedAt > 0 && window.ircClient.user('Bob').connectedAt > 0);
        await page.evaluate(() => clearInterval(window.timeSortRedraw));
        assert.deepEqual(await page.locator('#channel-list-container .client-name-text').allTextContents(), ['Alice', 'Bob', 'Tester']);
        assert.deepEqual(await page.locator('#member-list-body .client-name-text').allTextContents(), ['Alice', 'Bob', 'Tester']);
        const timeQueries = timedQueries.slice(beforeTimes);
        assert.equal(timeQueries.length, 3);
        assert.ok(timeQueries.every(query => /^WHOIS (Alice|Bob|Tester) \1$/.test(query.line)));
        assert.ok(timeQueries.slice(1).every((query, index) => query.time - timeQueries[index].time >= 2300));
        await page.locator('#channel-list-container [data-irc-user][title="Connection time unavailable"]').filter({hasText: 'Tester'}).waitFor();
        await sort(music, 'sort users', 'online shortest');
        assert.deepEqual(await page.locator('#channel-list-container .client-name-text').allTextContents(), ['Bob', 'Alice', 'Tester']);
        assert.equal(await page.evaluate(() => utils__storage_get('member_sort')), 'connected-asc');
        await page.screenshot({path: 'test-results/member-time-sort.png'});
        await sort(music, 'sort users', 'name a–z');
        await page.evaluate(() =>
        {
            const user = window.ircClient.user('Bob');
            user.connectedAt = 0;
            user.connectionTimeChecked = false;
            window.ircClient.changed();
        });
        await page.waitForTimeout(2800);
        assert.equal(timedQueries.length, beforeTimes + 3, 'changing sort stops automatic lookups');
        await settings('appearance');
        await page.locator('#irc-settings-joined-color').fill('#ff0088');
        await save();
        assert.equal(await music.locator('.single-channel-name-p').evaluate(node => getComputedStyle(node).color), 'rgb(255, 0, 136)');
        await settings('appearance');
        assert.ok(await page.locator('#irc-settings-client-color').isDisabled());
        assert.ok(await page.locator('#irc-settings-self-color').isDisabled());
        await page.locator('#irc-settings-joined-color-enabled').uncheck();
        assert.ok(await page.locator('#irc-settings-joined-color').isDisabled());
        const ordinary = await page.locator('.single-channel[aria-label="#Alpha"] .single-channel-name-p').evaluate(node => getComputedStyle(node).color);
        assert.equal(await music.locator('.single-channel-name-p').evaluate(node => getComputedStyle(node).color), ordinary);
        await page.locator('#irc-settings-client-color-enabled').check();
        await page.locator('#irc-settings-client-color').fill('#3377ee');
        await page.locator('#irc-settings-self-color-enabled').check();
        await page.locator('#irc-settings-self-color').fill('#ee7733');
        await save();
        broadcast(':Alice!u@h PRIVMSG #music :Color preview');
        await page.locator('#chat-input-container-text-input').fill('Own color preview');
        await page.locator('#chat-input-container-send-chat-input').click();
        for (const theme of ['default', 'hybrid', 'hybrid-v2', 'aero', 'termix', 'ozone', 'default-mobile', 'mobile-2'])
        {
            await page.locator('#choose-theme-button').click();
            await page.locator('.choose-theme-item[data-name="' + theme + '"]').click();
            for (const selector of ['#channel-list-container', '#member-list-body'])
            {
                assert.equal(await page.locator(selector + ' .connected-client:not(.connected-local-client) .client-name-text').first().evaluate(node => getComputedStyle(node).color), 'rgb(51, 119, 238)');
                assert.equal(await page.locator(selector + ' .connected-local-client .client-name-text').first().evaluate(node => getComputedStyle(node).color), 'rgb(238, 119, 51)');
            }
            assert.equal(await page.locator('.single-chat-message:not(.irc-own-message) .single-chat-message-sender-username').first().evaluate(node => getComputedStyle(node).color), 'rgb(51, 119, 238)');
            assert.equal(await page.locator('.irc-own-message .single-chat-message-sender-username').first().evaluate(node => getComputedStyle(node).color), 'rgb(238, 119, 51)');
            await settings('appearance');
            if (theme === 'mobile-2' || theme === 'hybrid-v2')
            {
                await page.locator('#irc-settings-self-color-enabled').scrollIntoViewIfNeeded();
                await page.screenshot({path: 'test-results/' + theme + '-color-settings.png'});
            }
            await save();
        }
        await page.locator('#choose-theme-button').click();
        await page.locator('.choose-theme-item[data-name="ozone"]').click();
        await settings('appearance');
        await page.locator('#irc-settings-client-color-enabled').uncheck();
        const themeColor = await page.locator('#channel-list-container .connected-client:not(.connected-local-client) .client-name-text').first().evaluate(node => getComputedStyle(node).color);
        assert.notEqual(themeColor, 'rgb(51, 119, 238)');
        await page.getByRole('button', {name: 'Reset custom color for your name', exact: true}).click();
        assert.ok(!await page.locator('#irc-settings-self-color-enabled').isChecked());
        await page.locator('#local-settings-x-button').click();
        assert.equal(await page.locator('#channel-list-container .connected-local-client .client-name-text').first().evaluate(node => getComputedStyle(node).color), 'rgb(238, 119, 51)');
        await settings('appearance');
        await page.locator('#irc-settings-joined-color-enabled').check();
        await page.locator('#irc-settings-joined-color').fill('#00ff00');
        await page.locator('#local-settings-x-button').click();
        assert.equal(await music.locator('.single-channel-name-p').evaluate(node => getComputedStyle(node).color), ordinary);
        assert.ok(!await page.locator('#irc-settings-joined-color-enabled').isChecked());
        let panel = await lookup();
        await panel.getByLabel('Nickname', {exact: true}).fill('Missing');
        await panel.getByRole('button', {name: 'Open chat', exact: true}).click();
        await panel.getByText(/No user named Missing is online/).waitFor();
        assert.ok(await panel.evaluate(node => node.open), 'a missing user keeps the lookup open');
        await panel.getByLabel('Nickname', {exact: true}).fill('NoReply');
        await panel.getByRole('button', {name: 'Open chat', exact: true}).click();
        await page.evaluate(() => window.ircClient.userQueries.get('noreply').started -= 31000);
        await panel.getByText('The server has not replied. Try again', {exact: true}).waitFor();
        await panel.getByRole('button', {name: 'Cancel', exact: true}).click();
        // the + button beside the conversation picker opens the same lookup, and a found user opens the chat directly
        await page.locator('#irc-conversation-new').click();
        panel = page.locator('#irc-new-private-chat');
        await panel.getByLabel('Nickname', {exact: true}).fill('Outside');
        await panel.getByLabel('Nickname', {exact: true}).press('Enter');
        await page.waitForFunction(() => !document.getElementById('irc-new-private-chat')?.open);
        assert.equal(await page.locator('#irc-conversation-picker .irc-conversation-name').textContent(), 'Outside');
        await page.locator('#chat-input-container-text-input').fill('Private without a shared channel');
        await page.locator('#chat-input-container-send-chat-input').click();
        await page.waitForTimeout(50);
        assert.ok(sent.includes('PRIVMSG Outside :Private without a shared channel'));
        const chatBefore = await page.evaluate(() => window.ircClient.conversation('channel:#music').unread);
        broadcast(':NewGuest!u@h JOIN #music');
        await page.waitForFunction(() => window.ircClient.channel('#music').members.size === 4);
        assert.equal(await page.evaluate(() => window.ircClient.conversation('channel:#music').unread), chatBefore);
        broadcast(':Alice!u@h PRIVMSG #music :Unread message');
        await page.waitForFunction(() => window.ircClient.conversation('channel:#music').unread === 1);
        await page.locator('#irc-conversation-picker').click();
        const option = page.locator('.irc-conversation-option[data-context="channel:#music"]');
        assert.equal(await option.locator('.irc-conversation-name').textContent(), 'music');
        assert.equal(await option.locator('.irc-unread-badge').textContent(), '1');
        await page.screenshot({path: 'test-results/unread-conversation-dropdown.png'});
        await option.click();
        assert.equal(await page.evaluate(() => window.ircClient.conversation('channel:#music').unread), 0);
        // chat message menu: private chat and ignore, with the ignore list in chat settings
        broadcast(':Spammy!s@h PRIVMSG #music :buy cheap stuff');
        const spam = page.locator('.single-chat-message', {hasText: 'buy cheap stuff'});
        await spam.waitFor();
        await spam.click({button: 'right'});
        const messageMenu = page.locator('#contextmenus-container .irc-compact-menu');
        assert.deepEqual(await messageMenu.locator('.context-menu-item').allTextContents(), ['message', 'info', 'copy', 'ignore']);
        await messageMenu.getByRole('menuitem', {name: 'ignore', exact: true}).click();
        await spam.waitFor({state: 'detached'});
        broadcast(':Spammy!s@h PRIVMSG #music :more spam');
        await page.waitForTimeout(100);
        assert.equal(await page.locator('.single-chat-message', {hasText: 'more spam'}).count(), 0);
        await settings('chat');
        assert.equal(await page.locator('.irc-ignored-row .irc-ignored-nick').allTextContents().then(nicks => nicks.join()), 'Spammy');
        await page.locator('.irc-ignored-row').getByRole('button', {name: 'Stop ignoring', exact: true}).click();
        await page.locator('.irc-ignored-empty').waitFor();
        await save();
        await page.locator('.single-chat-message', {hasText: 'buy cheap stuff'}).waitFor();
        await page.locator('.single-chat-message', {hasText: 'buy cheap stuff'}).locator('.irc-message-author').click();
        await messageMenu.getByRole('menuitem', {name: 'message', exact: true}).click();
        assert.equal(await page.locator('#irc-conversation-picker .irc-conversation-name').textContent(), 'Spammy');
        await page.locator('#irc-conversation-picker').click();
        await page.locator('.irc-conversation-option[data-context="channel:#music"]').click();
        await settings('chat');
        await page.locator('#irc-event_location').selectOption('log');
        await page.locator('#irc-error_location').selectOption('log');
        await save();
        broadcast(':LogGuest!u@h JOIN #music');
        broadcast(':s 404 Tester #music :Fixture send refusal');
        await page.waitForFunction(() => window.ircClient.conversation('network').messages.some(message => message.text.includes('Fixture send refusal')));
        assert.equal(await page.locator('#chat-context-container').getByText('LogGuest joined', {exact: true}).count(), 0);
        assert.equal(await page.locator('#chat-context-container').getByText(/Fixture send refusal/).count(), 0);
        await page.locator('#show-hide-log-button').click();
        await page.locator('#textarea-log .irc-log-join').getByText(/LogGuest/).waitFor();
        assert.ok(await page.locator('#textarea-log .irc-log-error').getByText(/Fixture send refusal/).isVisible());
        await page.screenshot({path: 'test-results/colored-event-log.png'});
        await page.locator('#show-hide-log-button').click();
        await settings('audio');
        assert.equal(await page.locator('#irc-sound-message_sent').isChecked(), false);
        assert.ok(await page.locator('#irc-sound-error').isChecked());
        await page.locator('#irc-sound-incoming_channel').uncheck();
        await save();
        const sounds = await page.evaluate(() => window.soundEvents.length);
        broadcast(':Alice!u@h PRIVMSG #music :Muted channel sound');
        await page.getByText('Muted channel sound', {exact: true}).waitFor();
        assert.equal(await page.evaluate(() => window.soundEvents.length), sounds);
        broadcast(':Outside!u@h PRIVMSG Tester :Private sound enabled');
        await page.waitForFunction(count => window.soundEvents.length > count && window.soundEvents.at(-1).played, sounds);
        await settings('audio');
        await page.locator('#irc-sound-incoming_channel').check();
        await save();
        const errorSounds = () => page.evaluate(() => window.soundEvents.filter(event => event.source === g_sound_effects.error.src && event.played).length);
        let errorCount = await errorSounds();
        await page.evaluate(() => window.ircClient.write('JOIN #locked'));
        await page.waitForFunction(count => window.soundEvents.filter(event => event.source === g_sound_effects.error.src && event.played).length === count + 1, errorCount);
        assert.equal(await page.evaluate(() => window.ircClient.channels.get('#locked')?.joined || false), false);
        errorCount = await errorSounds();
        broadcast(':s 475 Tester #locked :Bad channel key');
        await page.getByRole('dialog').filter({hasText: 'Channel password'}).waitFor();
        await page.waitForFunction(count => window.soundEvents.filter(event => event.source === g_sound_effects.error.src && event.played).length === count + 1, errorCount);
        await page.getByRole('dialog').getByRole('button', {name: 'Cancel', exact: true}).click();
        await settings('audio');
        await page.locator('#irc-sound-error').uncheck();
        await save();
        errorCount = await errorSounds();
        broadcast(':s 404 Tester #music :Muted error');
        await page.waitForFunction(() => window.ircClient.conversation('network').messages.some(message => message.text.includes('Muted error')));
        assert.equal(await errorSounds(), errorCount);
        await settings('audio');
        await page.locator('#irc-sound-error').check();
        await save();
        await page.locator('#sound-effects-button').click();
        broadcast(':s 404 Tester #music :Master muted error');
        await page.waitForFunction(() => window.ircClient.conversation('network').messages.some(message => message.text.includes('Master muted error')));
        assert.equal(await errorSounds(), errorCount);
        await page.locator('#sound-effects-button').click();
        broadcast(':s 422 Tester :No MOTD');
        await page.waitForFunction(() => window.ircClient.conversation('network').messages.some(message => message.text.includes('No MOTD')));
        assert.equal(await errorSounds(), errorCount);
        broadcast(':s FAIL JOIN CHANNEL_FORBIDDEN #locked :Join denied');
        await page.waitForFunction(count => window.soundEvents.filter(event => event.source === g_sound_effects.error.src && event.played).length === count + 1, errorCount);
        await page.locator('#enter-server-settings').click();
        panel = page.locator('#irc-management');
        await panel.getByRole('combobox', {name: 'Manage', exact: true}).selectOption('channel');
        await page.waitForFunction(() => window.ircClient.channel('#music').modesKnown && window.ircClient.channel('#music').bansKnown);
        await panel.getByLabel('Invite only (+i)', {exact: true}).check();
        await page.waitForFunction(() => window.ircClient.channel('#music').modes.has('i'));
        await panel.getByLabel('Topic', {exact: true}).fill('Managed topic');
        await panel.getByRole('button', {name: 'Set topic', exact: true}).click();
        await page.waitForFunction(() => window.ircClient.channel('#music').topic === 'Managed topic');
        await panel.getByLabel('Channel password', {exact: true}).fill('channel-secret');
        await panel.getByRole('button', {name: 'Set password', exact: true}).click();
        await page.waitForFunction(() => window.ircClient.channel('#music').modes.has('k'));
        await panel.getByRole('button', {name: 'Remove password', exact: true}).click();
        await panel.getByLabel('Member limit', {exact: true}).fill('42');
        await panel.getByRole('button', {name: 'Set limit', exact: true}).click();
        await panel.getByLabel('Ban mask', {exact: true}).fill('Another!*@*');
        await panel.getByRole('button', {name: 'Add ban', exact: true}).click();
        await panel.getByRole('combobox', {name: 'Member', exact: true}).selectOption('Alice');
        await panel.getByRole('combobox', {name: 'Role', exact: true}).selectOption('v');
        await panel.getByRole('button', {name: 'Grant role', exact: true}).click();
        await page.waitForFunction(() => window.ircClient.channel('#music').members.get(window.ircClient.user('Alice').id).modes === 'v');
        await page.screenshot({path: 'test-results/channel-management.png'});
        await panel.getByRole('combobox', {name: 'Manage', exact: true}).selectOption('operator');
        assert.ok(await panel.getByRole('button', {name: 'Disconnect user (KILL)', exact: true}).isDisabled());
        await panel.getByLabel('Operator account', {exact: true}).fill('oper');
        await panel.getByLabel('Operator password', {exact: true}).fill('wrong');
        await panel.getByRole('button', {name: 'Log in as IRC operator', exact: true}).click();
        await panel.getByText(/464 Tester|464 Password incorrect|464.*Password incorrect/).waitFor();
        assert.equal(await page.evaluate(() => window.ircClient.operator), false);
        await panel.getByLabel('Operator password', {exact: true}).fill('correct');
        await panel.getByRole('button', {name: 'Log in as IRC operator', exact: true}).click();
        await panel.getByText('IRC operator privileges confirmed by the server', {exact: true}).waitFor();
        assert.equal(await panel.getByLabel('Operator password', {exact: true}).inputValue(), '');
        await panel.getByLabel('Nickname to disconnect', {exact: true}).fill('Outside');
        await panel.getByLabel('Reason', {exact: true}).fill('Fixture test');
        await panel.getByRole('button', {name: 'Disconnect user (KILL)', exact: true}).click();
        await page.getByRole('dialog').last().getByRole('button', {name: 'Cancel', exact: true}).click();
        assert.equal(sent.some(line => line.startsWith('KILL ')), false);
        await panel.getByRole('button', {name: 'Disconnect user (KILL)', exact: true}).click();
        await page.getByRole('dialog').last().getByRole('button', {name: 'Confirm', exact: true}).click();
        await panel.getByRole('button', {name: 'Reload configuration (REHASH)', exact: true}).click();
        await page.getByRole('dialog').last().getByRole('button', {name: 'Confirm', exact: true}).click();
        await panel.getByText(/382.*Rehashing/).waitFor();
        assert.ok(sent.includes('KILL Outside :Fixture test'));
        assert.ok(sent.includes('MODE #music +l 42'));
        assert.ok(sent.includes('MODE #music +b Another!*@*'));
        await page.screenshot({path: 'test-results/operator-management.png'});
        await panel.getByRole('button', {name: 'Drop operator privileges', exact: true}).click();
        await page.waitForFunction(() => !window.ircClient.operator);
        await panel.getByRole('button', {name: 'Close', exact: true}).click();
        const own = page.locator('#channel-list-container .connected-client').filter({has: page.locator('.client-name-text').filter({hasText: /^Tester$/})});
        await own.click({button: 'right'});
        await page.getByRole('menuitem', {name: 'my info', exact: true}).click();
        await page.locator('#irc-user-information').getByText('#music', {exact: true}).waitFor();
        await page.locator('#irc-user-information').getByRole('button', {name: 'Close', exact: true}).click();
        await page.reload();
        assert.equal(await page.evaluate(() => utils__storage_get('channel_sort')), 'count-asc');
        assert.equal(await page.evaluate(() => utils__storage_get('joined_color')), '#ff0088');
        assert.equal(await page.evaluate(() => utils__storage_get('joined_first')), 'false');
        assert.equal(await page.evaluate(() => document.body.classList.contains('irc-color-joined')), false);
        assert.equal(await page.locator('#irc-settings-client-color').inputValue(), '#3377ee');
        assert.equal(await page.locator('#irc-settings-self-color').inputValue(), '#ee7733');
        assert.ok(await page.locator('#irc-settings-client-color-enabled').isChecked());
        assert.ok(await page.locator('#irc-settings-self-color-enabled').isChecked());
        assert.equal(await page.evaluate(() => utils__storage_get('event_location')), 'log');
        assert.deepEqual(errors, []);
        console.log('PASS sorting, lookup, badges, event routing, individual audio, colors, own info, channel management, operator authentication and confirmed actions');
    }
    catch (error)
    {
        await page.screenshot({path: 'test-results/controls-failure.png'});
        throw error;
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
