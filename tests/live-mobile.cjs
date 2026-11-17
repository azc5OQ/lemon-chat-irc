const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const {createBridge} = require('../bridge/server.cjs');

(async () =>
{
    const bridge = await createBridge({port: 0});
    const browser = await chromium.launch({executablePath: process.env.BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true});
    const suffix = crypto.randomBytes(3).toString('hex');
    const channel = '##lemon-mobile-' + suffix;
    const names = ['Lm' + suffix + 'A', 'Lm' + suffix + 'B'];
    const themes = ['default-mobile', 'mobile-2'];
    const pages = [];
    const contexts = [];
    const errors = [];
    const results = [];
    fs.mkdirSync('test-results', {recursive: true});
    try
    {
        for (const [index, theme] of themes.entries())
        {
            const context = await browser.newContext({viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true});
            contexts.push(context);
            const page = await context.newPage();
            pages.push(page);
            page.on('pageerror', error => errors.push(error.message));
            await page.addInitScript(theme => localStorage.setItem('lemon-irc-theme', theme), theme);
            await page.goto(bridge.url);
            await page.getByRole('button', {name: 'Browse IRC servers', exact: true}).tap();
            await page.getByRole('button', {name: 'Choose Libera.Chat', exact: true}).tap();
            await page.locator('#irc-nickname').fill(names[index]);
            await page.locator('#connect-button').tap();
            await page.waitForFunction(() => window.ircClient.connected, null, {timeout: 60000});
            await page.waitForFunction(() => !window.ircClient.listing, null, {timeout: 90000});
            const directory = await page.evaluate(() => ({count: window.ircClient.directory.size, replies: window.ircClient.conversation('network').messages.map(message => message.text)}));
            if (directory.count === 0)
            {
                assert.ok(directory.replies.some(reply => reply.includes('263')), 'an empty list has a server refusal');
            }
            if (await page.locator('#textarea-log').isVisible())
            {
                await page.locator('#show-hide-log-button').tap();
            }
            if (directory.count > 0)
            {
                await page.waitForFunction(() => document.querySelector('.single-channel[data-channel-id="network"]')?.title.startsWith(window.ircClient.directory.size + ' public channels'));
                const last = await page.evaluate(() => [...window.ircClient.directory.values()].sort((a, b) => a.name.localeCompare(b.name)).at(-1).name);
                await page.locator('#channel-list-container').evaluate(node => node.scrollTop = node.scrollHeight);
                await page.getByRole('button', {name: last, exact: true}).waitFor();
                await page.locator('#channel-list-container').evaluate(node => node.scrollTop = 0);
            }
            await page.screenshot({path: 'test-results/live-' + theme + '-directory.png'});
            await page.locator('.single-channel[data-channel-id="network"]').click({button: 'right'});
            await page.getByRole('menuitem', {name: 'Create channel', exact: true}).tap();
            await page.getByRole('textbox', {name: 'Channel name', exact: true}).fill(channel);
            await page.getByRole('dialog').getByRole('button', {name: 'Confirm', exact: true}).tap();
            await page.waitForFunction(name => window.ircClient.channels.get(window.ircClient.fold(name))?.joined, channel, {timeout: 30000});
            results.push({theme, listed: directory.count, listRefused: directory.count === 0});
            console.log('LIVE ' + theme + ': connected, ' + directory.count + ' listed channels, joined test channel');
        }
        for (const page of pages)
        {
            await page.waitForFunction(name => window.ircClient.channel(name).members.size === 2, channel);
            await page.locator('#hide-chat-button').tap();
            await page.locator('.single-channel[aria-label="' + channel + '"] .single-channel-people-count').getByText('2', {exact: true}).waitFor();
            await page.locator('.single-channel[aria-label="' + channel + '"]').tap();
        }
        const message = 'Mobile channel test ' + suffix;
        await pages[0].locator('#chat-input-container-text-input').fill(message);
        await pages[0].locator('#chat-input-container-send-chat-input').tap();
        await pages[1].getByText(message, {exact: true}).waitFor({timeout: 30000});
        const answer = 'Mobile reply ' + suffix;
        await pages[1].locator('#chat-input-container-text-input').fill(answer);
        await pages[1].locator('#chat-input-container-send-chat-input').tap();
        await pages[0].getByText(answer, {exact: true}).waitFor({timeout: 30000});
        for (const [index, page] of pages.entries())
        {
            await page.screenshot({path: 'test-results/live-' + themes[index] + '-chat.png'});
        }
        await pages[1].locator('#channel-list-container .connected-client').filter({hasText: names[0]}).tap();
        const privateMessage = 'Mobile private test ' + suffix;
        await pages[1].locator('#chat-input-container-text-input').fill(privateMessage);
        await pages[1].locator('#chat-input-container-send-chat-input').tap();
        await pages[0].locator('#channel-list-container .connected-client').filter({hasText: names[1]}).tap();
        await pages[0].getByText(privateMessage, {exact: true}).waitFor({timeout: 30000});
        await pages[1].locator('#hide-chat-button').tap();
        await pages[1].locator('.single-channel[aria-label="' + channel + '"]').click({button: 'right'});
        await pages[1].getByRole('menuitem', {name: 'Leave channel', exact: true}).tap();
        await pages[0].waitForFunction(name => window.ircClient.channel(name).members.size === 1, channel);
        await pages[0].locator('#hide-chat-button').tap();
        await pages[0].locator('.single-channel[aria-label="' + channel + '"] .single-channel-people-count').getByText('1', {exact: true}).waitFor();
        assert.deepEqual(errors, []);
        fs.writeFileSync('test-results/live-mobile.json', JSON.stringify({network: 'Libera.Chat', results, passed: true, checks: ['registration', 'directory scrolling', 'channel counts', 'channel delivery both ways', 'private delivery', 'part count update']}, null, 4));
        console.log('PASS live Mobile 1 and Mobile 2: directory scrolling, counts, channel and private delivery, part count update');
    }
    catch (error)
    {
        for (const [index, page] of pages.entries())
        {
            await page.screenshot({path: 'test-results/live-' + themes[index] + '-failure.png'});
            console.log(await page.evaluate(() => window.ircClient?.conversation('network').messages.slice(-8).map(message => message.text)));
        }
        console.error('Page errors:', errors);
        throw error;
    }
    finally
    {
        for (const page of pages)
        {
            await page.evaluate(() =>
            {
                if (window.ircClient?.connected)
                {
                    window.ircClient.write('QUIT :Lemon IRC mobile test complete');
                }
            }).catch(() =>
            {
            });
        }
        for (const context of contexts)
        {
            await context.close();
        }
        await browser.close();
        bridge.close();
    }
})().catch(error =>
{
    console.error(error);
    process.exitCode = 1;
});
