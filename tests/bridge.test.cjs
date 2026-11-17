const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const {once} = require('node:events');
const WebSocket = require('../vendor/ws');
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
