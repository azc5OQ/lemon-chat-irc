const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const {createBridge} = require('../bridge/server.cjs');

(async () =>
{
    const bridge = await createBridge({port: 0});
    const browser = await chromium.launch({executablePath: process.env.BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true});
    const context = await browser.newContext({viewport: {width: 1280, height: 800}});
    const preferred = 'Li' + crypto.randomBytes(3).toString('hex');
    const pages = [];
    const errors = [];
    const memberQueries = [];
    try
    {
        for (let index = 0; index < 2; index++)
        {
            const page = await context.newPage();
            pages.push(page);
            page.on('pageerror', error => errors.push(error.message));
            page.on('websocket', socket => socket.on('framesent', frame =>
            {
                if (String(frame.payload).startsWith('NAMES '))
                {
                    memberQueries.push(String(frame.payload));
                }
            }));
            await page.goto(bridge.url);
            await page.locator('#connections-menu-button').click();
            await page.locator('#connections-menu-connect').click();
            await page.locator('#irc-nickname').waitFor({state: 'visible'});
            if (index === 0)
            {
                await page.locator('#irc-nickname').fill(preferred);
                await page.locator('#irc-username').fill('tester');
                await page.locator('#irc-realname').fill('Lemon Tester');
            }
            else
            {
                assert.equal(await page.locator('#irc-nickname').inputValue(), preferred);
            }
            await page.locator('#connect-button').click();
            await page.waitForFunction(() => window.ircClient.connected && window.ircClient.directory.size > 0 && !window.ircClient.listing, null, {timeout: 90000});
        }
        const firstNick = await pages[0].evaluate(() => window.ircClient.nick);
        const secondNick = await pages[1].evaluate(() => window.ircClient.nick);
        assert.equal(firstNick, preferred);
        assert.notEqual(secondNick, preferred);
        assert.equal(await pages[1].evaluate(() => localStorage.getItem('irc_preferred_nickname')), preferred);
        const page = pages[0];
        const total = await page.evaluate(() => window.ircClient.directory.size);
        assert.ok(total > 1000);
        assert.ok(await page.locator('#channel-list-container .single-channel').count() < 150);
        const lastName = await page.evaluate(() => [...window.ircClient.directory.values()].sort((a, b) => a.name.localeCompare(b.name)).at(-1).name);
        await page.locator('#channel-list-container').evaluate(node => node.scrollTop = node.scrollHeight);
        await page.getByRole('button', {name: lastName, exact: true}).waitFor();
        await page.locator('#channel-list-container').focus();
        await page.keyboard.type('#libera');
        assert.deepEqual(memberQueries, []);
        assert.equal(await page.getByRole('button', {name: 'Toggle members of #libera', exact: true}).getAttribute('aria-expanded'), 'false');
        await page.getByRole('button', {name: 'Toggle members of #libera', exact: true}).click();
        await page.waitForFunction(() => window.ircClient.channels.get('#libera')?.membersUpdated > 0 && window.ircClient.channels.get('#libera').names === null, null, {timeout: 30000});
        await page.getByRole('button', {name: '#libera', exact: true}).click();
        const members = await page.evaluate(() => window.ircClient.channels.get('#libera').members.size);
        assert.deepEqual(memberQueries, ['NAMES #libera']);
        assert.equal(await page.getByRole('button', {name: '#libera', exact: true}).locator('.single-channel-name-p').textContent(), 'libera');
        assert.equal(await page.evaluate(() => [...window.ircClient.channels.values()].some(channel => channel.joined)), false);
        await page.screenshot({path: 'test-results/live-libera-member-preview.png'});
        assert.equal(await page.locator('.chat-context-selector[data-chat-context-selector-id="network"]').count(), 0);
        await page.locator('#show-hide-log-button').click();
        await page.locator('#textarea-log').getByText(/001 /).waitFor();
        await page.screenshot({path: 'test-results/live-libera-log.png'});
        await page.locator('#show-hide-log-button').click();
        assert.deepEqual(errors, []);
        const result = {passed: true, network: 'Libera.Chat', publicChannels: total, visibleMembersBeforeJoining: members, automaticNicknameFallback: true, savedPreferenceUnchanged: true, scrollToLastChannel: true, typeToFindChannel: true, unsolicitedJoins: false, queriesBeforeExpansion: 0, memberQueries, channelPrefixHidden: true, repliesInOriginalLog: true};
        fs.writeFileSync('test-results/live-discovery.json', JSON.stringify(result, null, 4));
        console.log(result);
    }
    finally
    {
        for (const page of pages)
        {
            await page.evaluate(() =>
            {
                try
                {
                    window.ircClient.write('QUIT :Lemon IRC discovery test complete');
                }
                catch (error)
                {
                }
            });
        }
        await browser.close();
        bridge.close();
    }
})().catch(error =>
{
    console.error(error);
    process.exitCode = 1;
});
