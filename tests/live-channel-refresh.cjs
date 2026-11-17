const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const {createBridge} = require('../bridge/server.cjs');

(async () =>
{
    const bridge = await createBridge({port: 0});
    const browser = await chromium.launch({executablePath: process.env.BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true});
    const page = await browser.newPage({viewport: {width: 1280, height: 800}});
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try
    {
        await page.goto(bridge.url);
        await page.locator('#connections-menu-button').click();
        await page.locator('#connections-menu-connect').click();
        await page.locator('#irc-nickname').fill('Li' + crypto.randomBytes(3).toString('hex'));
        await page.locator('#connect-button').click();
        await page.waitForFunction(() => window.ircClient.connected && window.ircClient.directory.size > 0 && !window.ircClient.listing, null, {timeout: 90000});
        const initialChannels = await page.evaluate(() => window.ircClient.directory.size);
        console.log('Connected to Libera, initial public channels: ' + initialChannels);
        await page.keyboard.press('Control+f');
        await page.getByRole('searchbox', {name: 'Filter channels', exact: true}).fill('#libera');
        await page.getByRole('button', {name: 'Toggle members of #libera', exact: true}).click();
        await page.waitForFunction(() => window.ircClient.channels.get('#libera')?.membersUpdated > 0 && window.ircClient.channels.get('#libera').names === null);
        const beforeJoining = await page.evaluate(() => window.ircClient.channels.get('#libera').members.size);
        await page.getByRole('button', {name: '#libera', exact: true}).dblclick();
        await page.waitForFunction(() => window.ircClient.channels.get('#libera')?.joined && window.ircClient.channels.get('#libera').names === null && window.ircClient.channels.get('#libera').members.size > 1);
        const afterJoining = await page.evaluate(() => window.ircClient.channels.get('#libera').members.size);
        console.log('Visible members before joining: ' + beforeJoining + ', after joining: ' + afterJoining);
        await page.evaluate(() => window.directoryBeforeRefresh = window.ircClient.directory);
        await page.locator('#channel-list-container').evaluate(node => node.scrollTop = 0);
        await page.locator('.single-channel[data-channel-id="network"]').click({button: 'right'});
        await page.getByRole('menuitem', {name: 'Refresh channels', exact: true}).click();
        await page.waitForFunction(() => !window.ircClient.listing, null, {timeout: 90000});
        let refreshed = await page.evaluate(() => window.ircClient.directory !== window.directoryBeforeRefresh);
        let immediateRefusal = '';
        if (!refreshed)
        {
            immediateRefusal = await page.evaluate(() => window.ircClient.conversation('network').messages.findLast(message => message.text.startsWith('263 '))?.text || 'No replacement list received');
            console.log('Immediate refresh: ' + immediateRefusal + '. Waiting before one retry');
            await new Promise(resolve => setTimeout(resolve, 60000));
            await page.locator('#channel-list-container').evaluate(node => node.scrollTop = 0);
            await page.locator('.single-channel[data-channel-id="network"]').click({button: 'right'});
            await page.getByRole('menuitem', {name: 'Refresh channels', exact: true}).click();
            await page.waitForFunction(() => !window.ircClient.listing, null, {timeout: 90000});
            refreshed = await page.evaluate(() => window.ircClient.directory !== window.directoryBeforeRefresh);
        }
        const currentChannels = await page.evaluate(() => window.ircClient.directory.size);
        assert.ok(currentChannels > 1000);
        assert.equal(await page.evaluate(() => window.ircClient.connected && window.ircClient.channel('#libera').joined), true);
        await page.screenshot({path: 'test-results/live-libera-filter-after-join.png'});
        assert.deepEqual(errors, []);
        const result = {passed: true, network: 'Libera.Chat', initialChannels, channelsAfterRefresh: currentChannels, immediateRefusal, refreshAccepted: refreshed, visibleMembersBeforeJoining: beforeJoining, membersAfterJoining: afterJoining, stayedConnected: true, filterPreserved: await page.getByRole('searchbox', {name: 'Filter channels', exact: true}).inputValue()};
        fs.writeFileSync('test-results/live-channel-refresh.json', JSON.stringify(result, null, 4));
        console.log(result);
    }
    finally
    {
        await page.evaluate(() =>
        {
            try
            {
                window.ircClient.write('QUIT :Lemon IRC query test complete');
            }
            catch (error)
            {
            }
        });
        await browser.close();
        bridge.close();
    }
})().catch(error =>
{
    console.error(error);
    process.exitCode = 1;
});
