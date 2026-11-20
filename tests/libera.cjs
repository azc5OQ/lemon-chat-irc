const crypto = require('node:crypto');
const {createBridge} = require('../bridge/server.cjs');
const WebSocket = require('../vendor/ws');
const {Client} = require('../client-source-code/client-development/browser/main/scripts/irc/protocol');

(async () =>
{
    const bridge = await createBridge({port: 0});
    const suffix = crypto.randomBytes(4).toString('hex');
    const nick = 'Lmn' + suffix;
    const channel = '##lemon-irc-check-' + suffix;
    let ws;
    try
    {
        await new Promise((resolve, reject) =>
        {
            const timeout = setTimeout(() => reject(new Error('Libera verification timed out')), 90000);
            let registered = false;
            let joined = false;
            const client = new Client(line => ws.send(line));
            ws = new WebSocket(bridge.origin.replace('http:', 'ws:') + '/irc?token=' + bridge.token, 'text.ircv3.net', {origin: bridge.origin});
            ws.on('open', () => client.register(nick, '', '', 'lemontest', 'Lemon Test'));
            ws.on('error', reject);
            ws.on('close', (code, reason) =>
            {
                clearTimeout(timeout);
                reject(new Error('Connection closed: ' + code + ' ' + reason));
            });
            ws.on('message', data =>
            {
                const line = data.toString();
                client.receive(line);
                if (/^ERROR /.test(line) || / (464|465) /.test(line))
                {
                    clearTimeout(timeout);
                    reject(new Error('The network rejected the connection. No public messages were sent.'));
                    return;
                }
                if (client.connected && !registered)
                {
                    registered = true;
                    console.log('PASS real Libera TLS registration through the local WebSocket bridge');
                    client.write('JOIN ' + channel);
                }
                if (client.channels.get(client.fold(channel))?.joined && !joined)
                {
                    joined = true;
                    console.log('PASS joined the temporary test channel');
                    client.write('PRIVMSG ' + nick + ' :lemon-irc-private-roundtrip-' + suffix);
                }
                if (line.includes(' PRIVMSG ' + nick + ' :lemon-irc-private-roundtrip-' + suffix))
                {
                    console.log('PASS received a private message sent only to the test nickname');
                    client.write('PART ' + channel);
                    client.write('QUIT :Lemon IRC verification complete');
                    clearTimeout(timeout);
                    resolve();
                }
            });
        });
    }
    finally
    {
        ws?.close();
        bridge.close();
    }
})().catch(error =>
{
    console.error(error.message);
    process.exitCode = 1;
});
