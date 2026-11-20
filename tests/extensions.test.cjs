const test = require('node:test');
const assert = require('node:assert/strict');
const {Client} = require('../client-source-code/client-development/browser/main/scripts/irc/protocol');
const media = require('../client-source-code/client-development/browser/main/scripts/irc/media');
const identities = require('../client-source-code/client-development/browser/main/scripts/irc/identities');
const accounts = require('../client-source-code/client-development/browser/main/scripts/irc/accounts');

function connected()
{
    const sent = [];
    const client = new Client(line => sent.push(line));
    client.register('me', '', '', 'lemontest', 'Lemon Test');
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
    client.register('me', '', '', 'lemontest', 'Lemon Test');
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
    client.register('me', '', '', 'lemontest', 'Lemon Test');
    client.receive(':s 421 me CAP :Unknown command');
    client.receive(':s 001 me :Welcome');
    assert.equal(client.connected, true);
    assert.equal(sent.includes('CAP END'), false);
    const authenticated = new Client(line => sent.push(line));
    authenticated.register('me', 'account', 'secret', 'lemontest', 'Lemon Test');
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
    assert.equal(sent.at(-1), 'NOTICE Alice :\x01VERSION Lemon IRC 0.1.0 https://github.com/azc5OQ/lemon-chat-irc\x01');
    const replies = sent.length;
    client.receive(':Alice!u@h PRIVMSG me :\x01VERSION\x01');
    client.receive(':Bob!u@h PRIVMSG me :\x01VERSION\x01');
    assert.equal(sent.length, replies);
    assert.equal(client.conversations.size, count);
    client.lastVersionReply = Date.now() - 10001;
    client.is_project_address_shared = false;
    client.receive(':Bob!u@h PRIVMSG me :\x01VERSION\x01');
    assert.equal(sent.at(-1), 'NOTICE Bob :\x01VERSION Lemon IRC 0.1.0\x01');
    client.receive(':Bob!u@h PRIVMSG #room :\x01VERSION\x01');
    assert.equal(sent.length, replies + 1);
    const conversationCount = client.conversations.size;
    client.lastVersionReply = Date.now() - 10001;
    client.receive(':Bob!u@h PRIVMSG me :\x01SOURCE\x01');
    assert.equal(sent.length, replies + 1);
    client.is_project_address_shared = true;
    client.receive(':Bob!u@h PRIVMSG me :\x01SOURCE\x01');
    assert.equal(sent.at(-1), 'NOTICE Bob :\x01SOURCE https://github.com/azc5OQ/lemon-chat-irc\x01');
    assert.equal(client.conversations.size, conversationCount);
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

test('saved identities keep the username and real name', () =>
{
    let value = '';
    const storage = {read: () => value, write: next => value = next};
    const network = {host: 'irc.example', port: 6697, tls: true};
    identities.remember(storage, network, 'Alice', '');
    identities.rememberUser(storage, network, '', 'alice', 'Alice Example');
    identities.remember(storage, network, 'Bob', 'bob');
    identities.rememberUser(storage, network, 'bob', 'bob.b', 'Bob');
    const profiles = identities.list(storage, network);
    assert.deepEqual(profiles.map(profile => [profile.account, profile.username, profile.realname]), [['', 'alice', 'Alice Example'], ['bob', 'bob.b', 'Bob']]);
    value = JSON.stringify([{network: 'irc.example:6697:true', nick: 'n', account: '', username: 'x'.repeat(11), realname: 'y'.repeat(51)}]);
    assert.deepEqual(identities.list(storage, network).map(profile => [profile.username, profile.realname]), [['', '']]);
});

test('account registration commands for each service type', () =>
{
    const ircv3 = {is_available: true, is_email_required: true, is_custom_account_name: false};
    const none = {is_available: false, is_email_required: false, is_custom_account_name: false};
    const form = {account: 'Alice', password: 'secret12', repeat: 'secret12', email: 'alice@example.com'};
    assert.equal(accounts.serviceType(ircv3, '', ''), 'ircv3');
    assert.equal(accounts.serviceType(none, 'ergo-v2.14.0', ''), 'ergo');
    assert.equal(accounts.serviceType(none, 'UnrealIRCd-6', 'please type /msg NickServ CONFIRM <passcode>'), 'anope');
    assert.equal(accounts.serviceType(none, 'solanum-1.0', ''), 'atheme');
    assert.equal(accounts.registerLine('ircv3', form, ircv3), 'REGISTER Alice alice@example.com secret12');
    assert.equal(accounts.registerLine('ircv3', {...form, email: ''}, none), 'REGISTER Alice * secret12');
    assert.equal(accounts.registerLine('atheme', form, none), 'PRIVMSG NickServ :REGISTER secret12 alice@example.com');
    assert.equal(accounts.registerLine('anope', {...form, email: ''}, none), 'PRIVMSG NickServ :REGISTER secret12');
    assert.throws(() => accounts.registerLine('atheme', {...form, repeat: 'other'}, none), /different/);
    assert.throws(() => accounts.registerLine('atheme', {...form, password: 'has space', repeat: 'has space'}, none), /without spaces/);
    assert.throws(() => accounts.registerLine('atheme', {...form, email: 'alice'}, none), /e-mail address/);
    assert.throws(() => accounts.registerLine('ircv3', {...form, email: ''}, ircv3), /needs an e-mail/);
    assert.equal(accounts.confirmLine('ircv3', 'Alice', 'abc123'), 'VERIFY Alice abc123');
    assert.equal(accounts.confirmLine('atheme', 'Alice', ' abc123 '), 'PRIVMSG NickServ :VERIFY REGISTER Alice abc123');
    assert.equal(accounts.confirmLine('anope', 'Alice', 'abc123'), 'PRIVMSG NickServ :CONFIRM abc123');
    assert.equal(accounts.confirmLine('ergo', 'Alice', 'abc123'), 'PRIVMSG NickServ :VERIFY Alice abc123');
    assert.equal(accounts.confirmLine('atheme', 'Alice', '/msg NickServ VERIFY REGISTER Alice xyz'), 'PRIVMSG NickServ :VERIFY REGISTER Alice xyz');
    assert.throws(() => accounts.confirmLine('atheme', 'Alice', 'two words'), /code from the e-mail/);
    assert.equal(accounts.loginLine('Alice', 'secret12'), 'PRIVMSG NickServ :IDENTIFY Alice secret12');
});

test('service replies are turned into plain results', () =>
{
    const result = (text, command = 'NOTICE', params = []) => accounts.describe(command, params, text)?.result;

    // atheme
    assert.equal(result('\x02Alice\x02 is now registered to \x02alice@example.com\x02.'), 'registered');
    assert.equal(result('An email containing nickname activation instructions has been sent to \x02alice@example.com\x02.'), 'confirm');
    assert.equal(result('\x02Alice\x02 is already registered.'), 'exists');
    assert.equal(result('\x02alice\x02 is not a valid email address.'), 'email');
    assert.equal(result('Please try again with a more obscure password. Passwords should be at least five characters long.'), 'password');
    assert.equal(result('You must have been using this nick for at least 30 seconds to register.'), 'wait');
    assert.equal(result('\x02Alice\x02 has now been verified.'), 'verified');
    assert.equal(result('Verification failed. Invalid key for \x02Alice\x02.'), 'wrong-code');
    assert.equal(result('You are now identified for \x02Alice\x02.'), 'logged-in');
    assert.equal(result('Invalid password for \x02Alice\x02.'), 'wrong-password');
    assert.equal(result('\x02Bob\x02 is not registered.'), 'not-registered');

    // anope
    assert.equal(result('Nickname \x02Alice\x02 registered.'), 'registered');
    assert.equal(result('A passcode has been sent to alice@example.com, please type \x02/msg NickServ CONFIRM <passcode>\x02 to confirm your email address.'), 'confirm');
    assert.equal(result('Nickname \x02Alice\x02 is already registered!'), 'exists');
    assert.equal(result('Password accepted - you are now recognized.'), 'logged-in');
    assert.equal(result('Password incorrect.'), 'wrong-password');
    assert.equal(result('Invalid passcode.'), 'wrong-code');

    // ergo
    assert.equal(result('Account created'), 'registered');
    assert.equal(result('Account created, pending verification; verification code has been sent to alice@example.com'), 'confirm');
    assert.equal(result("You're now logged in as Alice"), 'logged-in');

    // ircv3 replies and a missing service
    assert.equal(result('Account successfully registered', 'REGISTER', ['SUCCESS', 'Alice', 'Account successfully registered']), 'registered');
    assert.equal(result('Check your e-mail', 'REGISTER', ['VERIFICATION_REQUIRED', 'Alice', 'Check your e-mail']), 'confirm');
    assert.equal(result('', 'FAIL', ['REGISTER', 'ACCOUNT_EXISTS', 'Alice', 'Account already exists']), 'exists');
    assert.equal(result('', 'FAIL', ['REGISTER', 'WEAK_PASSWORD', 'Alice', 'weak']), 'password');
    assert.equal(result('', 'FAIL', ['VERIFY', 'INVALID_CODE', 'Alice', 'bad']), 'wrong-code');
    assert.equal(result('', 'FAIL', ['REGISTER', 'NEED_NICK', '*', 'nick']), 'failed');
    assert.equal(result('No such nick/channel', '401', ['me', 'NickServ', 'No such nick/channel']), 'no-service');
    assert.equal(result('Some other text'), undefined);
});

test('saved identities are encrypted with the master password', {timeout: 30000}, async () =>
{
    await assert.rejects(identities.createVault('short'), /at least 8/);
    const {key, salt} = await identities.createVault('correct horse');
    const network = {host: 'IRC.Example', port: 6697, tls: true};
    const content = {profiles: [{network: 'irc.example:6697:true', nick: 'Alice', account: 'alice', selected: true}], passwords: {[identities.passwordKey(network, 'Alice')]: 'secret-1'}};
    const file = await identities.sealVault(key, salt, content);
    assert.equal(JSON.stringify(file).includes('secret-1'), false);
    assert.equal(JSON.stringify(file).includes('alice'), false);
    const second = await identities.sealVault(key, salt, content);
    assert.notEqual(second.iv, file.iv);
    const opened = await identities.openVault('correct horse', file);
    assert.deepEqual(opened.content, {...content, servers: []});
    assert.equal(opened.content.passwords['irc.example:6697:true alice'], 'secret-1');
    await assert.rejects(identities.openVault('wrong horse', file), /Wrong master password/);
    const changed = {...file, data: (file.data[0] === 'A' ? 'B' : 'A') + file.data.slice(1)};
    await assert.rejects(identities.openVault('correct horse', changed), /Wrong master password, or the file was changed/);
    await assert.rejects(identities.openVault('correct horse', {...file, version: 2}), /unknown format/);
    const resealed = await identities.sealVault(opened.key, opened.salt, {...content, passwords: {}});
    assert.deepEqual((await identities.openVault('correct horse', resealed)).content.passwords, {});
});

test('saved identities keep their channels for the next connection', () =>
{
    let value = '';
    const storage = {read: () => value, write: next => value = next};
    const network = {host: 'irc.example', port: 6697, tls: true};
    identities.remember(storage, network, 'Alice', 'alice');
    identities.rememberUser(storage, network, 'alice', 'alice', 'Alice Example');
    identities.rememberChannels(storage, network, 'alice', ['#one', '#two']);
    identities.remember(storage, network, 'AliceAgain', 'alice');
    const [profile] = identities.list(storage, network);
    assert.deepEqual([profile.nick, profile.username, profile.realname, profile.channels], ['AliceAgain', 'alice', 'Alice Example', ['#one', '#two']]);
    identities.rememberChannels(storage, network, 'alice', Array.from({length: 150}, (unused, index) => '#c' + index));
    assert.equal(identities.list(storage, network)[0].channels.length, 100);
    value = JSON.stringify([{network: 'irc.example:6697:true', nick: 'n', account: '', channels: ['#ok', 5, 'x'.repeat(201)]}]);
    assert.deepEqual(identities.list(storage, network)[0].channels, ['#ok']);
});
