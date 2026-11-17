const test = require('node:test');
const assert = require('node:assert/strict');
const {Client} = require('../client-source-code/client-development/browser/main/scripts/irc/protocol');
const media = require('../client-source-code/client-development/browser/main/scripts/irc/media');
const identities = require('../client-source-code/client-development/browser/main/scripts/irc/identities');

function connected()
{
    const sent = [];
    const client = new Client(line => sent.push(line));
    client.register('me');
    client.receive(':s CAP * LS :message-tags batch draft/metadata-2=max-subs=2 extended-join account-tag account-notify away-notify chghost setname');
    const requested = sent.at(-1).slice(9);
    client.receive(':s CAP * ACK :' + requested);
    client.receive(':s 001 me :Welcome');
    return {client, sent};
}

test('capability acknowledgements, runtime changes and metadata limits', () =>
{
    const sent = [];
    const client = new Client(line => sent.push(line));
    client.register('me');
    client.receive(':s CAP * LS * :message-tags');
    assert.equal(client.enabled.size, 0);
    client.receive(':s CAP * LS :server-time');
    client.receive(':s CAP * ACK :message-tags');
    assert.equal(sent.includes('CAP END'), false);
    client.receive(':s CAP * ACK :server-time');
    assert.equal(sent.filter(line => line === 'CAP END').length, 1);
    client.receive(':s 001 me :Welcome');
    client.receive(':s CAP me NEW :batch draft/metadata-2=max-subs=2');
    client.receive(':s CAP me ACK :draft/metadata-2');
    assert.equal(sent.some(line => line.startsWith('METADATA')), false);
    client.receive(':s CAP me ACK :batch');
    assert.equal(sent.at(-1), 'METADATA * SUB avatar display-name');
    client.receive(':s CAP me DEL :message-tags');
    assert.equal(client.enabled.has('message-tags'), false);
    assert.equal(sent.filter(line => line === 'CAP END').length, 1);
    assert.equal(sent.some(line => line.startsWith('AUTHENTICATE')), false);
});

test('typing stays in existing conversations and obeys throttling and server restrictions', () =>
{
    const {client, sent} = connected();
    client.receive(':me!u@h JOIN #room * :Me');
    client.receive(':Alice!u@h JOIN #room alice :Alice Example');
    const room = client.conversation('channel:#room');
    const alice = client.user('Alice');
    client.receive('@+typing=active :Alice!u@h TAGMSG #room');
    assert.equal(room.typing.get(alice.id).state, 'active');
    const count = client.conversations.size;
    client.receive('@+typing=active :Stranger!u@h TAGMSG me');
    assert.equal(client.conversations.size, count);
    client.sendTyping(room.id, true, 10000);
    client.sendTyping(room.id, true, 11000);
    client.sendTyping(room.id, false, 12000);
    assert.deepEqual(sent.filter(line => line.includes(' TAGMSG ')), ['@+typing=active TAGMSG #room']);
    client.sendTyping(room.id, false, 13000);
    assert.equal(sent.at(-1), '@+typing=done TAGMSG #room');
    client.receive(':s 005 me CLIENTTAGDENY=* :supported');
    const before = sent.length;
    client.sendTyping(room.id, true, 17000);
    assert.equal(sent.length, before);
    client.receive(':s 005 me CLIENTTAGDENY=*,-typing :supported');
    client.sendTyping(room.id, true, 17000);
    assert.equal(sent.length, before + 1);
    client.receive(':Alice!u@h PRIVMSG #room :sent');
    assert.equal(room.typing.size, 0);
    client.receive('@+typing=paused :Alice!u@h TAGMSG #room');
    assert.ok(room.typing.get(alice.id).expires > Date.now() + 29000);
    client.receive(':Alice!u@h PART #room');
    assert.equal(room.typing.size, 0);
});

test('profiles retain advertised data, metadata removal and country replies', () =>
{
    const {client} = connected();
    client.receive(':Alice!ident@cloak JOIN #room alice-account :Alice Example');
    const alice = client.user('Alice');
    assert.equal(alice.account, 'alice-account');
    assert.equal(alice.fields.get('Real name'), 'Alice Example');
    client.receive(':s METADATA Alice avatar * :https://images.example/avatar/{size}.png');
    assert.match(alice.metadata.get('avatar'), /\{size\}/);
    client.receive(':Bob!u@h METADATA Alice avatar * :https://bad.example/picture.png');
    assert.match(alice.metadata.get('avatar'), /images.example/);
    client.receive(':s METADATA Alice avatar *');
    assert.equal(alice.metadata.has('avatar'), false);
    client.receive(':Alice!ident@cloak AWAY :Lunch');
    assert.equal(alice.away, 'Lunch');
    client.receive(':Alice!ident@cloak CHGHOST newident newcloak');
    assert.equal(alice.fields.get('Host'), 'newcloak');
    client.receive(':Alice!newident@newcloak ACCOUNT *');
    assert.equal(alice.account, '');
    client.receive(':Alice!newident@newcloak SETNAME :New name');
    assert.equal(alice.fields.get('Real name'), 'New name');
    const info = client.requestUserInfo('Alice');
    client.receive(':s 344 me Alice SK :is connecting from Slovakia');
    assert.equal(alice.country, 'SK');
    assert.match(info.fields.get('Country'), /Slovakia/);
    client.receive(':s 005 me draft/FILEHOST=https://files.example/upload?a=b=c :supported');
    assert.equal(client.isupport.get('draft/FILEHOST'), 'https://files.example/upload?a=b=c');
    client.receive(':s 005 me -draft/FILEHOST :supported');
    assert.equal(client.isupport.has('draft/FILEHOST'), false);
});

test('media classification avoids executable schemes, credentials and local destinations', () =>
{
    for (const value of ['javascript:alert(1)', 'data:image/svg+xml,x', 'https://user:pass@example.com/a.png', 'https://127.1/a.png', 'https://10.2.3.4/a.png', 'https://host.local/a.png', 'https://example.com:8443/a.png', 'http://example.com/a.png'])
    {
        assert.equal(media.preview(value), null, value);
    }
    assert.equal(media.preview('https://example.com/a.png?size=1').type, 'image');
    assert.equal(media.preview('https://example.com/a.opus').type, 'audio');
    assert.equal(media.preview('https://example.com/a.webm').type, 'video');
    assert.equal(media.preview('https://youtu.be/abcdefghijk').source, 'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg');
    assert.equal(media.preview('https://youtube.com.evil.example/watch?v=abcdefghijk'), null);
});

test('legacy servers allow guest login but cannot silently bypass requested authentication', () =>
{
    const sent = [];
    const client = new Client(line => sent.push(line));
    client.register('me');
    client.receive(':s 421 me CAP :Unknown command');
    client.receive(':s 001 me :Welcome');
    assert.equal(client.connected, true);
    assert.equal(sent.includes('CAP END'), false);
    const authenticated = new Client(line => sent.push(line));
    authenticated.register('me', 'account', 'secret');
    assert.throws(() => authenticated.receive(':s 421 me CAP :Unknown command'), /account login/);
    assert.equal(authenticated.password, '');
    assert.equal(authenticated.connected, false);
    assert.throws(() => authenticated.receive(':s 001 me :Welcome'), /did not confirm/);
});

test('concurrent WHOIS responses stay with the requested users', () =>
{
    const {client} = connected();
    const alice = client.requestUserInfo('Alice');
    const bob = client.requestUserInfo('Bob');
    client.receive(':s 311 me Alice alice one.example * :First person');
    client.receive(':s 311 me Bob bob two.example * :Second person');
    client.receive(':s 319 me Alice :#first');
    client.receive(':s 318 me Bob :End');
    client.receive(':s 318 me Alice :End');
    assert.equal(alice.fields.get('Real name'), 'First person');
    assert.equal(bob.fields.get('Real name'), 'Second person');
    assert.equal(alice.complete && bob.complete, true);
    client.requestUserInfo('Alice');
    client.receive(':s 319 me Alice :#second');
    assert.equal(alice.fields.get('Visible channels'), '#second');
});

test('version requests identify the client without opening chats or flooding replies', () =>
{
    const {client, sent} = connected();
    const count = client.conversations.size;
    client.receive(':Alice!u@h PRIVMSG me :\x01VERSION\x01');
    assert.equal(sent.at(-1), 'NOTICE Alice :\x01VERSION Lemon IRC 0.1.0\x01');
    const replies = sent.length;
    client.receive(':Alice!u@h PRIVMSG me :\x01VERSION\x01');
    client.receive(':Bob!u@h PRIVMSG me :\x01VERSION\x01');
    assert.equal(sent.length, replies);
    assert.equal(client.conversations.size, count);
    client.lastVersionReply = Date.now() - 10001;
    client.receive(':Bob!u@h PRIVMSG me :\x01VERSION\x01');
    assert.equal(sent.at(-1), 'NOTICE Bob :\x01VERSION Lemon IRC 0.1.0\x01');
    client.receive(':Bob!u@h PRIVMSG #room :\x01VERSION\x01');
    assert.equal(sent.length, replies + 1);
});

test('Rizon list refusals without a command name preserve channels and stop loading', () =>
{
    const {client, sent} = connected();
    client.requestDirectory();
    client.receive(':s 322 me #room 5 :A room');
    client.receive(':s 323 me :End of list');
    const previous = client.directory;
    client.requestDirectory();
    client.receive(':s 263 me :Server load is temporarily too heavy. Please wait a while and try again.');
    assert.equal(client.listing, false);
    assert.equal(client.pendingDirectory, null);
    assert.equal(client.directory, previous);
    assert.equal(client.directory.get('#room').count, 5);
    client.requestDirectory();
    assert.equal(client.listing, true);
    assert.equal(sent.at(-1), 'LIST');
});

test('saved identities separate servers, keep the preferred nick and omit passwords', () =>
{
    let value = '[]';
    const storage = {read: () => value, write: next => value = next};
    const network = {host: 'IRC.Example', port: 6697, tls: true};
    identities.remember(storage, network, 'Alice', 'alice');
    identities.remember(storage, network, 'Guest', '');
    identities.remember(storage, network, 'AliceWork', 'ALICE');
    assert.equal(identities.list(storage, network).length, 2);
    assert.equal(identities.list(storage, network).filter(profile => profile.selected).length, 1);
    assert.equal(identities.list(storage, network).find(profile => profile.selected).nick, 'AliceWork');
    assert.equal(identities.list(storage, {...network, host: 'other.example'}).length, 0);
    assert.equal(identities.list(storage, {...network, tls: false}).length, 0);
    assert.equal(identities.list(storage, {...network, port: 7000}).length, 0);
    const data = JSON.parse(value);
    data[0].password = 'must-not-survive';
    value = JSON.stringify(data);
    assert.equal(identities.list(storage, network).some(profile => 'password' in profile), false);
    identities.forget(storage, network, 'ALICE');
    assert.equal(value.includes('must-not-survive'), false);
    assert.deepEqual(identities.list(storage, network).map(profile => profile.account), ['']);
    value = 'invalid json';
    assert.deepEqual(identities.list(storage, network), []);
    value = '[null, {}, {"network": 3, "nick": "n", "account": "a"}]';
    assert.deepEqual(identities.list(storage, network), []);
});
