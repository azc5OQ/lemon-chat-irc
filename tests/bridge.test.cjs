const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const {once} = require('node:events');
const WebSocket = require('../vendor/ws');
const fs = require('node:fs');
const path = require('node:path');
const {createBridge} = require('../bridge/server.cjs');

test('loopback bridge checks origin and token, forwards lines and rejects injection', {timeout: 15000}, async () =>
{
    const lines = [];
    const sockets = new Set();
    const tcp = net.createServer(socket =>
    {
        sockets.add(socket);
        socket.on('close', () => sockets.delete(socket));
        socket.on('data', data =>
        {
            lines.push(data.toString());
            socket.write(':s NOTICE * :round trip\r\n');
        });
    });
    tcp.listen(0, '127.0.0.1');
    await once(tcp, 'listening');
    const bridge = await createBridge({port: 0, target: {host: '127.0.0.1', port: tcp.address().port, tls: false}});
    try
    {
        const catalog = await fetch(bridge.origin + '/networks?token=' + bridge.token).then(response => response.json());
        assert.equal(catalog.defaultId, 'configured');
        assert.ok(catalog.networks.some(network => network.id === 'libera' && network.tls && network.port === 6697));
        assert.equal((await fetch(bridge.origin + '/networks?token=wrong')).status, 403);
        const malformed = net.connect(new URL(bridge.origin).port, '127.0.0.1');
        malformed.write('GET http://[ HTTP/1.1\r\nHost: ' + new URL(bridge.origin).host + '\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n');
        assert.match((await once(malformed, 'data'))[0].toString(), /400 Bad Request/);
        malformed.destroy();
        for (const [token, origin] of [['wrong', bridge.origin], [bridge.token, 'https://example.com'], [bridge.token, 'null']])
        {
            const rejected = new WebSocket(bridge.origin.replace('http', 'ws') + '/irc?token=' + token, {origin});
            const [error] = await once(rejected, 'error');
            assert.match(error.message, /403/);
        }
        const unknown = new WebSocket(bridge.origin.replace('http', 'ws') + '/irc?token=' + bridge.token + '&network=unknown', {origin: bridge.origin});
        assert.match((await once(unknown, 'error'))[0].message, /403/);
        const ws = new WebSocket(bridge.origin.replace('http', 'ws') + '/irc?token=' + bridge.token, 'text.ircv3.net', {origin: bridge.origin});
        await once(ws, 'open');
        const response = once(ws, 'message');
        ws.send('NICK LemonTest');
        assert.equal((await response)[0].toString(), ':s NOTICE * :round trip');
        assert.equal(lines.join(''), 'NICK LemonTest\r\n');
        const closed = once(ws, 'close');
        ws.send('PRIVMSG #a :hello\r\nOPER bad');
        assert.equal((await closed)[0], 1008);
        assert.equal(lines.join(''), 'NICK LemonTest\r\n');
        await assert.rejects(createBridge({port: 0, target: {host: 'bad host', port: 6667, tls: false}}));
    }
    finally
    {
        bridge.close();
        for (const socket of sockets)
        {
            socket.destroy();
        }
        tcp.close();
    }
});

test('the selected network reaches its configured server', {timeout: 15000}, async () =>
{
    const sockets = new Set();
    const servers = ['first', 'second'].map(name => net.createServer(socket =>
    {
        sockets.add(socket);
        socket.on('close', () => sockets.delete(socket));
        socket.write(':server NOTICE * :' + name + '\r\n');
    }));
    for (const server of servers)
    {
        server.listen(0, '127.0.0.1');
        await once(server, 'listening');
    }
    const target = {host: '127.0.0.1', port: servers[0].address().port, tls: false};
    const bridge = await createBridge({port: 0, target, networks: [{id: 'second', name: 'Second server', host: '127.0.0.1', port: servers[1].address().port, tls: false}]});
    try
    {
        for (const [id, expected] of [['configured', 'first'], ['second', 'second']])
        {
            const ws = new WebSocket(bridge.origin.replace('http', 'ws') + '/irc?token=' + bridge.token + '&network=' + id, 'text.ircv3.net', {origin: bridge.origin});
            const message = once(ws, 'message');
            assert.equal((await message)[0].toString(), ':server NOTICE * :' + expected);
            ws.close();
        }
    }
    finally
    {
        bridge.close();
        for (const socket of sockets)
        {
            socket.destroy();
        }
        for (const server of servers)
        {
            server.close();
        }
    }
});

test('saved conversations are stored in SQLite and returned only to the page', {timeout: 15000}, async () =>
{
    fs.mkdirSync(path.join(__dirname, '../test-results'), {recursive: true});
    const folder = fs.mkdtempSync(path.join(__dirname, '../test-results/history-'));
    const bridge = await createBridge({port: 0, historyFile: path.join(folder, 'conversations.sqlite')});
    try
    {
        const address = bridge.origin + '/history?token=' + bridge.token;
        const entries = [
            {network: 'libera', conversation: 'channel:#a', name: '#a', author: 'Alice', text: 'first', time: '2026-11-20T10:00:00.000Z', kind: 'info', is_own: false, is_action: false},
            {network: 'libera', conversation: 'channel:#a', name: '#a', author: 'me', text: 'waves', time: '2026-11-20T10:01:00.000Z', kind: 'info', is_own: true, is_action: true},
            {network: 'libera', conversation: 'channel:#b', name: '#b', author: 'Bob', text: 'other', time: '2026-11-20T10:02:00.000Z', kind: 'info', is_own: false, is_action: false}
        ];
        const post = (body, origin = bridge.origin, token = bridge.token) => fetch(bridge.origin + '/history?token=' + token, {method: 'POST', headers: {'Content-Type': 'application/json', Origin: origin}, body});
        assert.equal((await post(JSON.stringify(entries))).status, 200);
        assert.equal((await post(JSON.stringify(entries), 'https://example.com')).status, 403);
        assert.equal((await post(JSON.stringify(entries), bridge.origin, 'wrong')).status, 403);
        assert.equal((await post('not json')).status, 400);
        const saved = await fetch(address + '&network=libera&conversation=channel:%23a&limit=10').then(response => response.json());
        assert.deepEqual(saved.map(row => [row.author, row.text, row.is_own, row.is_action]), [['Alice', 'first', 0, 0], ['me', 'waves', 1, 1]]);
        const older = await fetch(address + '&network=libera&conversation=channel:%23a&limit=10&before=2026-11-20T10:01:00.000Z').then(response => response.json());
        assert.deepEqual(older.map(row => row.text), ['first']);
        const limited = await fetch(address + '&network=libera&conversation=channel:%23a&limit=1').then(response => response.json());
        assert.deepEqual(limited.map(row => row.text), ['waves']);
        assert.equal((await fetch(bridge.origin + '/history?token=wrong&network=libera&conversation=channel:%23a&limit=10')).status, 403);
    }
    finally
    {
        bridge.close();
        fs.rmSync(folder, {recursive: true, force: true});
    }
});

test('the encrypted identities file is stored as sent and returned only to the page', {timeout: 15000}, async () =>
{
    fs.mkdirSync(path.join(__dirname, '../test-results'), {recursive: true});
    const folder = fs.mkdtempSync(path.join(__dirname, '../test-results/identities-'));
    const file = path.join(folder, 'identities.lemon');
    const bridge = await createBridge({port: 0, identitiesFile: file});
    try
    {
        const address = bridge.origin + '/identities?token=' + bridge.token;
        const post = (body, origin = bridge.origin) => fetch(address, {method: 'POST', headers: {'Content-Type': 'application/json', Origin: origin}, body});
        assert.deepEqual(await fetch(address).then(response => response.json()), {is_existing: false});
        const content = {version: 1, iterations: 600000, salt: 'c2FsdA==', iv: 'aXY=', data: 'ZGF0YQ=='};
        assert.equal((await post(JSON.stringify(content))).status, 200);
        assert.deepEqual(await fetch(address).then(response => response.json()), {is_existing: true, file: content});
        assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), content);
        assert.equal((await post(JSON.stringify(content), 'https://example.com')).status, 403);
        assert.equal((await post(JSON.stringify({...content, data: 'not base64 <>'}))).status, 400);
        assert.equal((await post(JSON.stringify({...content, version: 2}))).status, 400);
        assert.equal((await fetch(bridge.origin + '/identities?token=wrong')).status, 403);
        assert.equal(fs.existsSync(file + '.new'), false);
    }
    finally
    {
        bridge.close();
        fs.rmSync(folder, {recursive: true, force: true});
    }
});

test('a server typed by the user is reached through host, port and tls, invalid values are refused', {timeout: 15000}, async () =>
{
    const lines = [];
    const tcp = net.createServer(socket =>
    {
        socket.on('data', data =>
        {
            lines.push(data.toString());
            socket.write(':custom NOTICE * :typed server\r\n');
        });
    });
    tcp.listen(0, '127.0.0.1');
    await once(tcp, 'listening');
    const bridge = await createBridge({port: 0, networks: []});
    try
    {
        const address = bridge.origin.replace('http', 'ws') + '/irc?token=' + bridge.token;
        const ws = new WebSocket(address + '&host=127.0.0.1&port=' + tcp.address().port + '&tls=false', 'text.ircv3.net', {origin: bridge.origin});
        await once(ws, 'open');
        const reply = once(ws, 'message');
        ws.send('NICK typed');
        assert.equal(String((await reply)[0]), ':custom NOTICE * :typed server');
        assert.match(lines.join(''), /NICK typed\r\n/);
        ws.close();
        for (const query of ['&host=bad host&port=6667', '&host=example.org&port=0', '&host=example.org&port=70000', '&host=a/b&port=6667', '&host=&port=6667'])
        {
            const refused = new WebSocket(address + query, 'text.ircv3.net', {origin: bridge.origin});
            assert.match((await once(refused, 'error'))[0].message, /403/);
        }
    }
    finally
    {
        bridge.close();
        tcp.close();
    }
});
