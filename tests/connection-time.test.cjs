const test = require('node:test');
const assert = require('node:assert/strict');
const {Client} = require('../client-source-code/client-development/browser/main/scripts/irc/protocol');

test('connection time uses the signon timestamp rather than idle seconds', () =>
{
    const sent = [];
    const client = new Client(line => sent.push(line));
    client.connected = true;
    const info = client.requestUserInfo('Alice', true);
    assert.deepEqual(sent, ['WHOIS Alice Alice']);
    assert.ok(info.background);
    assert.equal(client.requestUserInfo('Alice'), info);
    assert.equal(info.background, false, 'an explicit profile lookup must report its own failures');
    const signon = Math.floor(Date.now() / 1000) - 7200;
    client.receive(':s 317 Me Alice 17 ' + signon + ' :seconds idle, signon time');
    assert.equal(client.user('Alice').connectedAt, signon * 1000);
    assert.equal(info.fields.get('Idle'), '17 seconds');
    assert.equal(info.fields.get('Connected since'), new Date(signon * 1000).toLocaleString());
    assert.equal(client.user('Alice').lastActiveAt, 0);
    client.receive(':s 318 Me Alice :end');
    assert.ok(info.complete);
});

test('missing, zero, malformed and future signon timestamps remain unknown', () =>
{
    for (const value of ['', '0', '-1', 'not-a-date', 'Infinity', '9007199254740992', String(Math.floor(Date.now() / 1000) + 3600)])
    {
        const client = new Client(() =>
        {
        });
        client.connected = true;
        client.requestUserInfo('Alice', true);
        client.receive(':s 317 Me Alice 80 ' + value + ' :idle');
        client.receive(':s 318 Me Alice :end');
        assert.equal(client.user('Alice').connectedAt, 0);
        assert.ok(client.user('Alice').connectionTimeChecked);
        assert.equal(client.user('Alice').fields.has('Connected since'), false);
    }
});

test('connection time survives nickname changes and channel leaves but not quitting or reconnecting', () =>
{
    const client = new Client(() =>
    {
    });
    client.nick = 'Me';
    client.connected = true;
    client.receive(':Alice!u@h JOIN #test');
    client.requestUserInfo('Alice', true);
    client.receive(':s 317 Me Alice 80 1700000000 :idle, signon');
    client.receive(':s 318 Me Alice :end');
    const user = client.user('Alice');
    client.receive(':Alice!u@h NICK Alicia');
    assert.equal(client.user('Alicia'), user);
    client.receive(':Alicia!u@h PART #test');
    assert.equal(user.connectedAt, 1700000000000);
    const pending = client.requestUserInfo('Alicia', true);
    client.receive(':Alicia!u@h QUIT :gone');
    client.receive(':s 317 Me Alicia 80 1700000000 :late reply');
    assert.ok(pending.complete);
    assert.equal(user.connectedAt, 0);
    assert.equal(user.connectionTimeChecked, false);
    assert.equal(user.fields.has('Connected since'), false);
    client.requestUserInfo('Alicia', true);
    client.receive(':s 317 Me Alicia 80 1700000001 :new connection');
    client.register('Me');
    assert.equal(user.connectedAt, 0);
    assert.equal(user.connectionTimeChecked, false);
    assert.equal(user.fields.has('Connected since'), false);
});
