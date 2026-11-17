const net = require('node:net');
const fs = require('node:fs');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {createBridge} = require('../bridge/server.cjs');
test('server directory merges public listings and picks a working server', async () =>
{
    const irc = net.createServer(s => s.end());
    await new Promise(r => irc.listen(0, '127.0.0.1', r));
    const port = irc.address().port;
    const pages = {
        'https://ircbits.com/articles/irc-networks-overview': '<table><tr><th>Network</th></tr><tr> <td><strong>Libera.Chat</strong></td> <td align="right">~31,000</td> <td>~22,000</td> <td><code>irc.libera.chat</code></td> <td>Free &amp; open-source software</td> <td><a href="https://libera.chat">libera.chat</a></td> </tr><tr> <td><strong>GameSurge</strong></td> <td>~1,800</td> <td>1</td> <td><code>127.0.0.1:' + port + '</code></td> <td>Gaming communities</td> <td></td> </tr></table>',
        'https://www.irchelp.org/networks/popular.html': '<h3 id="x"><a href="https://www.dal.net/"> DALnet </a></h3><p><b>Servers:</b>  irc.dal.net, ix.dal.net <br><b>Information:</b><br>\nStarted in 1994.</p>',
        'https://netsplit.de/networks/': '<td><a class="competitor" href="/networks/SkyChatz/" title="x">SkyChatz</a><td><a class="competitor" href="/networks/Tiny/" title="x">Tiny</a>',
        'https://netsplit.de/networks/top100.php': '<td align="left"><a href="/networks/SkyChatz/" title="x">SkyChatz</a></td> <td align="right" valign="top">14161</td>',
        'https://netsplit.de/servers/?net=SkyChatz': "<tr><td align='left'>127.0.0.1</td><td align='center'>1</td><td align='center'>on</td><td>yes</td></tr><tr><td align='left'>127.0.0.1</td><td align='center'>" + port + "</td><td align='center'>off</td><td>yes</td></tr> servers last connected to",
        'https://netsplit.de/servers/?net=Tiny': 'nothing',
        'https://bot.ircnet.info/api/v2/serversByCountry': JSON.stringify({countriesWithServers: [{serverList: [{serverName: 'irc.atw-inter.net', open: true, version: '2.11', userCount: 600}, {serverName: 'vienna.irc.at', open: false, version: '2.11', userCount: 60}]}]})
    };
    global.fetch = async url => pages[url] !== undefined ? new Response(pages[url]) : new Response('', {status: 404});
    const cacheFile = path.join(os.tmpdir(), 'lemon-irc-directory-test.json');
    const realFetch = global.fetch;
    fs.rmSync(cacheFile, {force: true});
    const bridge = await createBridge({port: 0, discovery: true, cacheFile, target: {host: 'irc.libera.chat', port: 6697, tls: true}});
    await new Promise(r => setTimeout(r, 300));
    const get = async p => JSON.parse(await (new Promise((res, rej) => require('node:http').get(bridge.origin + p, {headers: {host: new URL(bridge.origin).host}}, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)); }).on('error', rej))));
    const list = await get('/networks?token=' + bridge.token);
    const names = list.networks.map(n => n.name + (n.verified ? '*' : '') + (n.ready ? '' : '?') + ':' + (n.users || 0));
    assert.deepEqual(list.directory.sources, {ircbits: 2, irchelp: 1, netsplit: 2, ircnet: 1});
    assert.ok(names.some(n => n.startsWith('Libera.Chat*')), 'builtin libera kept');
    assert.equal(list.networks.filter(n => n.name.toLowerCase().startsWith('libera')).length, 1, 'libera merged');
    const ircnet = list.networks.find(n => n.name === 'IRCnet' || n.name === 'ircnet');
    assert.ok(ircnet && ircnet.verified, 'built-in IRCnet kept');
    const sky = list.networks.find(n => n.name === 'SkyChatz');
    const resolved = await get('/resolve?token=' + bridge.token + '&id=' + sky.id);
    assert.equal(resolved.port, port);
    const tiny = list.networks.find(n => n.name === 'Tiny');
    assert.match((await get('/resolve?token=' + bridge.token + '&id=' + tiny.id)).error, /No server address/);
    const again = await get('/networks?token=' + bridge.token);
    assert.equal(again.networks.find(n => n.name === 'SkyChatz').ready, true);
    assert.equal(JSON.parse(fs.readFileSync(cacheFile, 'utf8')).networks.find(n => n.name === 'SkyChatz').ready, true);
    bridge.close();
    irc.close();
    global.fetch = realFetch;
    fs.rmSync(cacheFile, {force: true});
});
