const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const {createBridge} = require('../bridge/server.cjs');
const {networks} = require('../networks.json');

(async () =>
{
    const bridge = await createBridge({port: 0});
    const browser = await chromium.launch({executablePath: process.env.BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true});
    const results = [];
    const themes = ['default', 'aero', 'hybrid', 'hybrid-v2', 'termix', 'ozone'];
    fs.mkdirSync('test-results', {recursive: true});
    try
    {
        for (const [index, network] of networks.entries())
        {
            if (process.env.IRC_TEST_NETWORK && network.id !== process.env.IRC_TEST_NETWORK)
            {
                continue;
            }
            const suffix = crypto.randomBytes(3).toString('hex');
            const names = ['Li' + suffix + 'A', 'Li' + suffix + 'B'];
            const channel = '##lemon-irc-check-' + suffix;
            const context = await browser.newContext({viewport: {width: 1280, height: 800}});
            const pages = [];
            const errors = [];
            const directories = [];
            console.log('LIVE ' + network.name + ': registering two browser clients');
            try
            {
                for (const nickname of names)
                {
                    const page = await context.newPage();
                    pages.push(page);
                    page.on('pageerror', error => errors.push(error.message));
                    await page.addInitScript(() =>
                    {
                        window.receivedSounds = 0;
                        window.errorSounds = 0;
                        const play = HTMLMediaElement.prototype.play;
                        HTMLMediaElement.prototype.play = function()
                        {
                            const received = this.src === globalThis.g_sound_effects?.message_received?.src;
                            const failed = this.src === globalThis.g_sound_effects?.error?.src;
                            const result = play.call(this);
                            result?.then(() =>
                            {
                                if (received)
                                {
                                    window.receivedSounds++;
                                }
                                if (failed)
                                {
                                    window.errorSounds++;
                                }
                            }, () =>
                            {
                            });
                            return result;
                        };
                    });
                    await page.goto(bridge.url);
                    await page.locator('#choose-theme-button').click();
                    await page.locator('.choose-theme-item[data-name="' + themes[index % themes.length] + '"]').click();
                    await page.getByRole('button', {name: 'Browse IRC servers', exact: true}).click();
                    await page.getByRole('button', {name: 'Choose ' + network.name, exact: true}).click();
                    await page.locator('#irc-nickname').fill(nickname);
                    await page.locator('#irc-username').fill('tester');
                    await page.locator('#irc-realname').fill('Lemon Tester');
                    await page.locator('#connect-button').click();
                    await page.waitForFunction(() => window.ircClient.connected, null, {timeout: 60000});
                    await page.waitForFunction(() => !window.ircClient.listing, null, {timeout: 90000});
                    const directory = await page.evaluate(() => ({count: window.ircClient.directory.size, replies: window.ircClient.conversation('network').messages.map(message => message.text)}));
                    if (directory.count === 0)
                    {
                        assert.ok(directory.replies.some(reply => reply.includes('263')), 'empty directory has a visible server refusal');
                    }
                    directories.push({channels: directory.count, refused: directory.count === 0});
                    if (await page.locator('#textarea-log').isVisible())
                    {
                        await page.locator('#show-hide-log-button').click();
                    }
                    assert.ok(await page.locator('#channel-list-container .single-channel').count() < 150, 'large directory renders only visible rows');
                    if (pages.length === 1 && directory.count > 0)
                    {
                        await page.waitForFunction(() => document.querySelector('.single-channel[data-channel-id="network"]')?.title.startsWith(window.ircClient.directory.size + ' public channels'));
                        const name = await page.evaluate(() => [...window.ircClient.directory.values()].sort((a, b) => a.name.localeCompare(b.name)).at(-1).name);
                        await page.locator('#channel-list-container').evaluate(node => node.scrollTop = node.scrollHeight);
                        await page.getByRole('button', {name, exact: true}).waitFor();
                        await page.locator('#channel-list-container').evaluate(node => node.scrollTop = 0);
                        await page.screenshot({path: 'test-results/live-' + network.id + '-directory.png'});
                    }
                }
                async function send(page, text)
                {
                    await page.locator('#chat-input-container-text-input').fill(text);
                    await page.locator('#chat-input-container-send-chat-input').click();
                }
                async function menu(page, label)
                {
                    await page.locator('#connections-menu-button').click();
                    await page.locator('#connections-menu-list').getByRole('button', {name: label, exact: true}).click();
                }
                await pages[0].locator('.single-channel[data-channel-id="network"]').click({button: 'right'});
                await pages[0].getByRole('menuitem', {name: 'New private chat', exact: true}).click();
                const lookup = pages[0].locator('#irc-new-private-chat');
                await lookup.getByLabel('Nickname', {exact: true}).fill(names[1]);
                await lookup.getByRole('button', {name: 'Find user', exact: true}).click();
                await lookup.getByText(names[1] + ' was found on ' + await pages[0].evaluate(() => window.ircClient.network), {exact: true}).waitFor({timeout: 30000});
                await lookup.getByRole('button', {name: 'Start chat', exact: true}).click();
                await send(pages[0], 'Private before joining ' + suffix);
                await pages[1].waitForFunction(text => [...window.ircClient.conversations.values()].some(chat => chat.messages.some(message => message.text === text)), 'Private before joining ' + suffix, {timeout: 30000});
                for (const name of [channel, channel + '-2'])
                {
                    for (const page of pages)
                    {
                        await page.locator('#channel-list-container').evaluate(node => node.scrollTop = 0);
                        await page.locator('.single-channel[data-channel-id="network"]').click({button: 'right'});
                        await page.getByRole('menuitem', {name: 'Create channel', exact: true}).click();
                        await page.getByRole('textbox', {name: 'Channel name', exact: true}).fill(name);
                        await page.getByRole('dialog').getByRole('button', {name: 'Confirm', exact: true}).click();
                        await page.waitForFunction(name => window.ircClient.channels.get(window.ircClient.fold(name))?.joined, name, {timeout: 30000});
                    }
                }
                await pages[0].waitForFunction(name => [...window.ircClient.channels.values()].every(channel => [...channel.members.values()].some(member => member.user.nick === name)), names[1]);
                await pages[0].locator('.single-channel[aria-label="' + channel + '"]').click({button: 'right'});
                await pages[0].getByRole('menuitem', {name: 'Channel settings', exact: true}).click();
                const management = pages[0].locator('#irc-management');
                await pages[0].waitForFunction(name => window.ircClient.channel(name).modesKnown, channel, {timeout: 30000});
                await management.getByLabel('Topic', {exact: true}).fill('Lemon IRC temporary UI test');
                await management.getByRole('button', {name: 'Set topic', exact: true}).click();
                await pages[1].waitForFunction(name => window.ircClient.channel(name).topic === 'Lemon IRC temporary UI test', channel, {timeout: 30000});
                await management.getByRole('combobox', {name: 'Member', exact: true}).selectOption(names[1]);
                await management.getByRole('combobox', {name: 'Role', exact: true}).selectOption('v');
                await management.getByRole('button', {name: 'Grant role', exact: true}).click();
                await pages[1].waitForFunction(name => window.ircClient.channel(name).members.get(window.ircClient.user(window.ircClient.nick).id).modes.includes('v'), channel, {timeout: 30000});
                await management.getByLabel('Invite only (+i)', {exact: true}).check();
                await pages[0].waitForFunction(name => window.ircClient.channel(name).modes.has('i'), channel, {timeout: 30000});
                await pages[0].screenshot({path: 'test-results/live-' + network.id + '-channel-management.png'});
                await management.getByRole('button', {name: 'Close', exact: true}).click();
                const channelRow = pages[0].locator('.single-channel[aria-label="' + channel + '"]');
                await channelRow.click({button: 'right'});
                await pages[0].getByRole('menuitem', {name: 'Sort users by', exact: true}).hover();
                await pages[0].getByRole('menuitemradio', {name: 'Role: highest first', exact: true}).click();
                assert.deepEqual(await pages[0].locator('#channel-list-container [data-irc-channel="' + channel + '"] .client-name-text').allTextContents(), names);
                await channelRow.click({button: 'right'});
                await pages[0].getByRole('menuitem', {name: 'Sort users by', exact: true}).hover();
                await pages[0].getByRole('menuitemradio', {name: 'Connected: longest first', exact: true}).click();
                await pages[0].waitForFunction(nicks => nicks.every(nick => window.ircClient.user(nick).connectionTimeChecked), names, {timeout: 30000});
                await pages[0].waitForFunction(() => window.ircClient.userQueries.size === 0, null, {timeout: 30000});
                const connectionTimes = await pages[0].evaluate(nicks => nicks.map(nick => ({nick, connectedAt: window.ircClient.user(nick).connectedAt})), names);
                assert.ok(connectionTimes.every(user => user.connectedAt > 0 && user.connectedAt <= Date.now() + 300000));
                await pages[0].screenshot({path: 'test-results/live-' + network.id + '-connection-time-sort.png'});
                const peerRows = pages[0].locator('#channel-list-container .connected-client').filter({hasText: names[1]});
                await pages[0].waitForFunction(name => [...document.querySelectorAll('#channel-list-container .client-name-text')].filter(node => node.textContent === name).length === 2, names[1]);
                assert.equal(await peerRows.count(), 2);
                for (const page of pages)
                {
                    await page.locator('.single-channel[aria-label="' + channel + '"]').click();
                }
                const channelText = 'Live channel check ' + suffix;
                await send(pages[0], channelText);
                await pages[1].getByText(channelText, {exact: true}).waitFor({timeout: 30000});
                await pages[1].waitForFunction(() => window.receivedSounds > 0);
                const privateText = 'Live private check ' + suffix;
                await pages[1].locator('#channel-list-container .connected-client').filter({hasText: names[0]}).first().click();
                await send(pages[1], privateText);
                await peerRows.first().click();
                await pages[0].getByText(privateText, {exact: true}).waitFor({timeout: 30000});
                await peerRows.last().click();
                assert.equal(await pages[0].locator('.chat-context-selector .p-container').filter({hasText: names[1]}).count(), 1);
                await pages[1].locator('#channel-list-container .connected-local-client').first().click({button: 'right'});
                await pages[1].getByRole('menuitem', {name: 'Set nickname', exact: true}).click();
                await pages[1].getByRole('dialog').getByRole('textbox', {name: 'Nickname', exact: true}).fill('Li' + suffix + 'C');
                await pages[1].getByRole('dialog').getByRole('button', {name: 'Confirm', exact: true}).click();
                await pages[0].locator('.chat-context-selector .p-container').filter({hasText: 'Li' + suffix + 'C'}).waitFor({state: 'attached', timeout: 30000});
                await pages[0].getByText(privateText, {exact: true}).waitFor();
                await pages[0].locator('#channel-list-container .connected-client').filter({hasText: 'Li' + suffix + 'C'}).first().click({button: 'right'});
                await pages[0].getByRole('menuitem', {name: 'User information', exact: true}).click();
                await pages[0].locator('#irc-user-information').getByText('Lemon IRC', {exact: true}).waitFor({timeout: 30000});
                await pages[0].locator('#irc-user-information').getByText('Information provided by the server', {exact: true}).waitFor({timeout: 30000});
                await pages[0].screenshot({path: 'test-results/live-' + network.id + '-user-information.png'});
                await pages[0].locator('#irc-user-information').getByRole('button', {name: 'Close', exact: true}).click();
                await pages[1].locator('.single-channel[aria-label="' + channel + '-2"]').click({button: 'right'});
                await pages[1].getByRole('menuitem', {name: 'Leave channel', exact: true}).click();
                await pages[0].waitForFunction(name => [...document.querySelectorAll('#channel-list-container .client-name-text')].filter(node => node.textContent === name).length === 1, 'Li' + suffix + 'C');
                await pages[0].locator('.single-channel[aria-label="' + channel + '"]').click();
                await pages[0].screenshot({path: 'test-results/live-' + network.id + '.png'});
                await pages[1].locator('.single-channel[aria-label="' + channel + '"]').click({button: 'right'});
                await pages[1].getByRole('menuitem', {name: 'Leave channel', exact: true}).click();
                await pages[1].waitForFunction(name => !window.ircClient.channel(name).joined, channel);
                const errorsBeforeJoin = await pages[1].evaluate(() => window.errorSounds);
                await pages[1].locator('.single-channel[data-channel-id="network"]').click({button: 'right'});
                await pages[1].getByRole('menuitem', {name: 'Create channel', exact: true}).click();
                await pages[1].getByRole('textbox', {name: 'Channel name', exact: true}).fill(channel);
                await pages[1].getByRole('dialog').getByRole('button', {name: 'Confirm', exact: true}).click();
                await pages[1].waitForFunction(count => window.errorSounds === count + 1, errorsBeforeJoin, {timeout: 30000});
                assert.equal(await pages[1].evaluate(name => window.ircClient.channel(name).joined, channel), false);
                assert.deepEqual(errors, []);
                assert.equal(await pages[0].evaluate(() => [...window.ircClient.conversations.values()].some(conversation => conversation.user?.nick.includes('.'))), false);
                const summary = {network: network.name, theme: themes[index % themes.length], directories, connectionTimes, capabilities: await pages[0].evaluate(() => [...window.ircClient.enabled]), passed: true, checks: ['registration', 'channel discovery or visible server refusal', 'nickname lookup and private message without shared channels', 'two channels', 'shared user', 'channel settings, topic and voice role', 'role and connection time sorting', 'channel delivery and received sound playback', 'private delivery', 'nickname continuity', 'user information', 'part cleanup', 'failed join error playback', 'no server notice DM']};
                results.push(summary);
                console.log('PASS ' + network.name + ': ' + summary.checks.join(', '));
            }
            catch (error)
            {
                results.push({network: network.name, passed: false, error: error.message});
                console.log('FAIL ' + network.name + ': ' + error.message);
                for (const [pageIndex, page] of pages.entries())
                {
                    await page.screenshot({path: 'test-results/live-' + network.id + '-failure-' + pageIndex + '.png'});
                    console.log(await page.evaluate(() => window.ircClient?.conversation('network').messages.slice(-8).map(message => message.text)));
                }
            }
            finally
            {
                for (const page of pages)
                {
                    await page.evaluate(() =>
                    {
                        try
                        {
                            window.ircClient?.write('QUIT :Lemon IRC test complete');
                        }
                        catch (error)
                        {
                        }
                    });
                }
                await context.close();
                fs.writeFileSync('test-results/live-browser' + (process.env.IRC_TEST_NETWORK ? '-' + network.id : '') + '.json', JSON.stringify(results, null, 4));
            }
        }
    }
    finally
    {
        await browser.close();
        bridge.close();
    }
    if (results.some(result => !result.passed))
    {
        process.exitCode = 1;
    }
})().catch(error =>
{
    console.error(error);
    process.exitCode = 1;
});
