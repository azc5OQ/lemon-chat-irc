const test = require('node:test');
const assert = require('node:assert/strict');
const {Client} = require('../client-source-code/client-development/browser/main/scripts/irc/protocol');

function connected()
{
    const sent = [];
    const client = new Client(line => sent.push(line));
    client.register('me', '', '', 'lemontest', 'Lemon Test');
    client.receive(':s CAP * LS :');
    client.receive(':s 001 me :Welcome');
    client.receive(':s 005 me CHANMODES=b,k,l,imnst PREFIX=(ov)@+ :supported');
    client.receive(':me!u@h JOIN #test');
    client.receive(':s 353 me = #test :@me Alice Bob');
    client.receive(':s 366 me #test :end');
    return {client, sent};
}

test('unread counts include incoming messages and exclude events and outgoing messages', () =>
{
    const {client} = connected();
    const chat = client.conversation('channel:#test');
    assert.equal(chat.unread, 0);
    client.receive(':Guest!u@h JOIN #test');
    client.receive(':Guest!u@h NICK Guest2');
    client.receive(':Guest2!u@h PART #test');
    client.receive(':Alice!u@h TOPIC #test :New topic');
    client.message(chat.id, chat.name, '', 'Cannot send to channel');
    client.say(chat.id, 'Outgoing');
    assert.equal(chat.unread, 0);
    client.receive(':Alice!u@h PRIVMSG #test :Incoming');
    client.receive(':Bob!u@h PRIVMSG #test :\x01ACTION waves\x01');
    assert.equal(chat.unread, 2);
    client.eventLocation = 'log';
    const length = chat.messages.length;
    client.receive(':Other!u@h JOIN #test');
    assert.equal(chat.messages.length, length);
    assert.equal(client.conversation('network').messages.at(-1).kind, 'join');
    assert.equal(client.conversation('network').unread, 0);
    client.receive(':s 404 me #test :Cannot send');
    assert.equal(client.conversation('network').messages.at(-1).kind, 'error');
});

test('channel snapshots, mode arguments, role updates and ban lists follow server replies', () =>
{
    const {client, sent} = connected();
    const channel = client.channel('#test');
    client.requestChannelSettings('#test');
    assert.deepEqual(sent.slice(-3), ['MODE #test', 'TOPIC #test', 'MODE #test b']);
    client.receive(':s 324 me #test +ntkl key 25');
    assert.equal(channel.modes.get('k'), 'key');
    assert.equal(channel.modes.get('l'), '25');
    client.receive(':s 367 me #test bad!*@* setter 100');
    client.receive(':s 368 me #test :End of bans');
    assert.equal(channel.bansKnown, true);
    assert.equal(channel.bans.get('bad!*@*').setter, 'setter');
    client.receive(':s MODE #test -k+ov key Alice Bob');
    assert.equal(channel.modes.has('k'), false);
    assert.equal(channel.members.get(client.user('Alice').id).modes, 'o');
    assert.equal(channel.members.get(client.user('Bob').id).modes, 'v');
    client.receive(':s MODE #test -l+i');
    assert.equal(channel.modes.has('l'), false);
    assert.equal(channel.modes.has('i'), true);
    client.receive(':s MODE #test -b bad!*@*');
    assert.equal(channel.bans.size, 0);
    client.receive(':s 324 me #test +n');
    assert.deepEqual([...channel.modes], [['n', true]]);
    client.receive(':s 331 me #test :No topic');
    assert.equal(channel.topic, '');
    assert.throws(() => client.requestChannelSettings('#unjoined'), /Join the channel/);
});

test('IRC operator state requires server confirmation and tracks loss of privileges', () =>
{
    const {client} = connected();
    assert.equal(client.operator, false);
    client.write('OPER admin :password');
    assert.equal(client.operator, false);
    client.receive(':s 464 me :Password incorrect');
    assert.equal(client.operator, false);
    client.receive(':s 381 me :You are now an IRC operator');
    assert.equal(client.operator, true);
    client.receive(':me MODE me -o');
    assert.equal(client.operator, false);
    client.receive(':me MODE me +o');
    assert.equal(client.operator, true);
    client.receive(':s 221 me +i');
    assert.equal(client.operator, false);
});

test('private lookup distinguishes missing users from incomplete replies and cached profiles', () =>
{
    const {client} = connected();
    client.user('Missing').fields.set('Nickname', 'Missing');
    const missing = client.requestUserInfo('Missing');
    client.receive(':s 401 me Missing :No such nick');
    assert.equal(missing.errorCode, '401');
    assert.equal(missing.found, false);
    const user = client.requestUserInfo('Alice');
    client.receive(':s 311 me Alice alice host * :Alice Example');
    client.receive(':s 318 me Alice :end');
    assert.equal(user.found, true);
    assert.equal(user.complete, true);
    const incomplete = client.requestUserInfo('Unknown');
    client.receive(':s 318 me Unknown :end');
    assert.equal(incomplete.found, false);
    assert.equal(incomplete.complete, true);
});
