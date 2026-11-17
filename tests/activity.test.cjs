const test = require('node:test');
const assert = require('node:assert/strict');
const {Client} = require('../client-source-code/client-development/browser/main/scripts/irc/protocol');

test('activity comes from observed actions, not names, whois, history or pings', () =>
{
    const client = new Client(() =>
    {
    });
    client.nick = 'Me';
    client.connected = true;
    client.enabled.add('server-time');
    client.receive(':s 353 Me = #test :@Alice Bob');
    client.receive(':s 366 Me #test :End');
    assert.equal(client.user('Alice').lastActiveAt, 0);
    client.receive('PING :s');
    client.requestUserInfo('Alice');
    client.receive(':s 312 Me Alice ruthenium.libera.chat :São Paulo, BR');
    assert.equal(client.user('Alice').lastActiveAt, 0);
    assert.equal(client.user('Alice').country, '');
    assert.equal(client.user('Alice').serverCountry, 'BR');
    const old = Date.now() - 7200000;
    client.receive('@time=' + new Date(old).toISOString() + ' :Alice!u@h PRIVMSG #test :An earlier message');
    assert.equal(client.user('Alice').lastActiveAt, old);
    client.receive('@batch=history :Alice!u@h PRIVMSG #test :Backlog');
    assert.equal(client.user('Alice').lastActiveAt, old);
    client.receive(':Alice!u@h NOTICE Me :\x01VERSION automatic reply\x01');
    assert.equal(client.user('Alice').lastActiveAt, old);
    client.receive(':Alice!u@h PRIVMSG #test :A new message');
    const recent = client.user('Alice').lastActiveAt;
    assert.ok(Date.now() - recent < 1000);
    client.receive('@time=' + new Date(old).toISOString() + ' :Alice!u@h PRIVMSG #test :Another old message');
    assert.equal(client.user('Alice').lastActiveAt, recent);
    client.receive(':Alice!u@h NICK Alicia');
    assert.ok(client.user('Alicia').lastActiveAt >= recent);
    assert.equal(client.user('Bob').lastActiveAt, 0);
});

test('local ignore blocks messages and typing while membership and role updates continue', () =>
{
    const client = new Client(() =>
    {
    });
    client.nick = 'Me';
    client.connected = true;
    client.enabled.add('message-tags');
    client.receive(':Me!u@h JOIN #test');
    client.receive(':Alice!u@h JOIN #test');
    const alice = client.user('Alice');
    alice.ignored = true;
    const count = client.conversation('channel:#test').messages.length;
    client.receive(':Alice!u@h PRIVMSG #test :Hidden');
    client.receive(':Alice!u@h NOTICE Me :Hidden notice');
    client.receive('@+typing=active :Alice!u@h TAGMSG #test');
    assert.equal(client.conversation('channel:#test').messages.length, count);
    assert.equal(client.conversation('channel:#test').typing.size, 0);
    assert.equal(client.conversations.has('user:' + alice.id), false);
    client.receive(':s MODE #test +o Alice');
    assert.equal(client.channel('#test').members.get(alice.id).modes, 'o');
    client.receive(':Alice!u@h NICK Alicia');
    assert.equal(client.user('Alicia'), alice);
    assert.equal(alice.ignored, true);
    alice.ignored = false;
    client.receive(':Alicia!u@h PRIVMSG #test :Visible');
    assert.equal(client.conversation('channel:#test').messages.at(-1).text, 'Visible');
});
