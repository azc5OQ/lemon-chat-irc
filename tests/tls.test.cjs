const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const tls = require('node:tls');
const net = require('node:net');
const {once} = require('node:events');
const {execFileSync} = require('node:child_process');
const {createBridge} = require('../bridge/server.cjs');
const WebSocket = require('../vendor/ws');

test('WSS accepts its trusted test certificate and IRC TLS rejects an untrusted certificate', {timeout: 20000}, async () =>
{
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lemon-irc-tls-'));
    const key = path.join(directory, 'key.pem');
    const cert = path.join(directory, 'cert.pem');
    const openssl = process.env.OPENSSL || (fs.existsSync('C:/Program Files/Git/usr/bin/openssl.exe') ? 'C:/Program Files/Git/usr/bin/openssl.exe' : 'openssl');
    execFileSync(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=IP:127.0.0.1,DNS:localhost'], {stdio: 'ignore', windowsHide: true, timeout: 10000});
    const sockets = new Set();
    const echo = socket =>
    {
        sockets.add(socket);
        socket.on('close', () => sockets.delete(socket));
        socket.on('error', () => {});
        socket.on('data', () => socket.write(':s NOTICE * :secure bridge\r\n'));
    };
    const tcp = net.createServer(echo);
    const untrusted = tls.createServer({key: fs.readFileSync(key), cert: fs.readFileSync(cert)}, echo);
    untrusted.on('tlsClientError', () => {});
    let secureBridge;
    let rejectedBridge;
    try
    {
        tcp.listen(0, '127.0.0.1');
        await once(tcp, 'listening');
        untrusted.listen(0, '127.0.0.1');
        await once(untrusted, 'listening');
        secureBridge = await createBridge({port: 0, cert, key, target: {host: '127.0.0.1', port: tcp.address().port, tls: false}});
        const ws = new WebSocket(secureBridge.origin.replace('https', 'wss') + '/irc?token=' + secureBridge.token, 'text.ircv3.net', {origin: secureBridge.origin, ca: fs.readFileSync(cert)});
        await once(ws, 'open');
        const message = once(ws, 'message');
        ws.send('NICK Test');
        assert.equal((await message)[0].toString(), ':s NOTICE * :secure bridge');
        ws.close();
        rejectedBridge = await createBridge({port: 0, target: {host: '127.0.0.1', port: untrusted.address().port, tls: true}});
        const rejected = new WebSocket(rejectedBridge.origin.replace('http', 'ws') + '/irc?token=' + rejectedBridge.token, 'text.ircv3.net', {origin: rejectedBridge.origin});
        const closed = once(rejected, 'close');
        await once(rejected, 'open');
        assert.equal((await closed)[0], 1011);
    }
    finally
    {
        secureBridge?.close();
        rejectedBridge?.close();
        for (const socket of sockets)
        {
            socket.destroy();
        }
        tcp.close();
        untrusted.close();
        fs.unlinkSync(key);
        fs.unlinkSync(cert);
        fs.rmdirSync(directory);
    }
});
