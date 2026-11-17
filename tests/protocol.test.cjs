const test = require('node:test');
const assert = require('node:assert/strict');
const {Client, parse} = require('../client-source-code/client-development/browser/main/scripts/irc/protocol');

test('nickname conflicts use a fallback without replacing the preference', () =>
{
    const sent = [];
    const client = new Client(line => sent.push(line));
    client.register('PreferredName');
    assert.equal(client.receive(':s 433 * PreferredName :Already in use'), true);
    const fallback = client.nick;
    assert.match(fallback, /^Prefe\d{4}$/);
    assert.equal(sent.at(-1), 'NICK ' + fallback);
    assert.equal(client.preferredNick, 'PreferredName');
    client.receive(':s 001 ' + fallback + ' :Welcome');
    assert.equal(client.nick, fallback);
    client.receive(':s 433 ' + fallback + ' Someone :Already in use');
    assert.equal(client.nick, fallback);
});

test('public channel discovery and visible member previews do not join channels', () =>
{
    const sent = [];
    const client = new Client(line => sent.push(line));
    client.connected = true;
    client.requestDirectory();
    client.requestDirectory();
    assert.deepEqual(sent, ['LIST']);
    client.receive(':s 322 me #Public 30 :Public topic');
    client.receive(':s 322 me #PUBLIC 31 :Updated topic');
    client.receive(':s 323 me :End');
    assert.equal(client.directory.size, 1);
    assert.equal(client.directory.get('#public').count, 31);
    assert.equal(client.channels.size, 0);
    assert.equal(client.listing, false);
    client.requestMembers('#Public');
    client.requestMembers('#Public');
    assert.deepEqual(sent, ['LIST', 'NAMES #Public']);
    client.receive(':s 353 me = #Public :@Alice');
    client.receive(':s 366 me #Public :End');
    const channel = client.channel('#Public');
    assert.equal(channel.topic, 'Updated topic');
    assert.equal(channel.joined, false);
    assert.equal(channel.collapsed, true);
    assert.equal(channel.members.size, 1);
    client.requestMembers('#Hidden');
    client.receive(':s 366 me #Hidden :End');
    assert.equal(client.channel('#Hidden').members.size, 0);
    channel.membersUpdated = 0;
    channel.joined = true;
    client.requestMembers('#Public');
    assert.deepEqual(sent, ['LIST', 'NAMES #Public', 'NAMES #Hidden']);
});

test('refreshing channels preserves the last list until the replacement is complete', () =>
{
    const client = new Client(() =>
    {
    });
    client.connected = true;
    client.requestDirectory();
    client.receive(':s 322 me #old 3 :Old channel');
    client.receive(':s 323 me :End');
    client.requestDirectory();
    assert.equal(client.directory.has('#old'), true);
    client.receive(':s 263 me LIST :Please wait');
    assert.equal(client.listing, false);
    assert.equal(client.pendingDirectory, null);
    assert.equal(client.directory.has('#old'), true);
    client.requestDirectory();
    client.receive(':s 322 me #new 4 :New channel');
    assert.equal(client.directory.has('#old'), true);
    assert.equal(client.directory.has('#new'), false);
    client.receive(':s 323 me :End');
    assert.equal(client.directory.has('#old'), false);
    assert.equal(client.directory.has('#new'), true);
    assert.equal(client.listing, false);
});

test('server notices stay in Network while user and channel notices keep their context', () =>
{
    const client = new Client(() =>
    {
    });
    client.nick = 'me';
    client.receive(':irc.example NOTICE * :Looking up your hostname');
    client.receive(':irc.example NOTICE me :Welcome to the network');
    client.receive('NOTICE me :Maintenance tonight');
    assert.equal(client.users.size, 0);
    assert.equal(client.conversations.size, 1);
    assert.equal(client.conversation('network').messages.at(-1).text, 'Maintenance tonight');
    client.receive(':Alice!user@host NOTICE me :Private notice');
    assert.equal(client.private(client.user('Alice')).messages.at(-1).text, 'Private notice');
    client.receive(':irc.example NOTICE #general :Channel notice');
    assert.equal(client.conversation('channel:#general').messages.at(-1).text, 'Channel notice');
    client.receive('ERROR :Closing Link: connection timed out');
    assert.equal(client.conversation('network').messages.at(-1).text, 'ERROR Closing Link: connection timed out');
});

test('user information collects only the requested nickname and reports missing users', () =>
{
    const sent = [];
    const client = new Client(line => sent.push(line));
    client.connected = true;
    const info = client.requestUserInfo('Alice');
    assert.deepEqual(sent, ['WHOIS Alice']);
    client.receive(':s 311 me other user host * :Someone else');
    assert.equal(info.fields.size, 0);
    client.receive(':s 311 me ALICE alice cloak.example * :Alice Example');
    client.receive(':s 312 me Alice irc.example :Example network');
    client.receive(':s 319 me Alice :@#one +#two');
    client.receive(':s 319 me Alice :#three');
    client.receive(':s 330 me Alice alice-account :is logged in as');
    client.receive(':s 318 me Alice :End of WHOIS');
    assert.equal(info.fields.get('Real name'), 'Alice Example');
    assert.equal(info.fields.get('Visible channels'), '@#one +#two #three');
    assert.equal(info.fields.get('Account'), 'alice-account');
    assert.equal(info.complete, true);
    const missing = client.requestUserInfo('Missing');
    client.receive(':s 401 me Missing :No such nick');
    assert.equal(missing.error, 'No such nick');
    assert.equal(missing.complete, true);
    assert.equal(info.error, '');
    assert.throws(() => client.requestUserInfo('Alice\r\nQUIT'), /nickname/);
});

test('one identity has different memberships and one private conversation', () =>
{
    const client = new Client(() => {});
    client.nick = 'me';
    client.receive(':me!u@h JOIN #a');
    client.receive(':me!u@h JOIN #b');
    client.receive(':s 353 me = #a :@Alice me');
    client.receive(':s 366 me #a :end');
    client.receive(':s 353 me = #b :+Alice me');
    client.receive(':s 366 me #b :end');
    const alice = client.user('ALICE');
    assert.equal(client.channel('#a').members.get(alice.id).modes, 'o');
    assert.equal(client.channel('#b').members.get(alice.id).modes, 'v');
    const pm = client.private(alice);
    client.receive(':Alice!u@h NICK Alicia');
    assert.equal(client.private(client.user('Alicia')), pm);
    assert.equal(pm.name, 'Alicia');
    client.receive(':Alicia!u@h PART #a');
    assert.equal(client.channel('#a').members.has(alice.id), false);
    assert.equal(client.channel('#b').members.has(alice.id), true);
    client.receive(':Alicia!u@h QUIT :bye');
    assert.equal(client.channel('#b').members.has(alice.id), false);
});

test('capability continuation, tags, ping, roles and UTF8 limits', () =>
{
    const sent = [];
    const client = new Client(line => sent.push(line));
    client.register('LemonTest');
    client.receive(':s CAP * LS * :multi-prefix');
    assert.equal(sent.length, 3);
    client.receive(':s CAP * LS :server-time');
    assert.equal(sent.at(-1), 'CAP REQ :server-time multi-prefix');
    client.receive(':s CAP * ACK :server-time multi-prefix');
    assert.equal(sent.at(-1), 'CAP END');
    client.receive('PING :hello');
    assert.equal(sent.at(-1), 'PONG :hello');
    assert.equal(parse('@label=a\\sb\\:c :a!u@h PRIVMSG #a :hello there').tags.label, 'a b;c');
    assert.throws(() => client.write('PRIVMSG #a :hello\r\nOPER admin'));
    assert.throws(() => client.write('PRIVMSG #a :' + 'é'.repeat(300)));
    client.receive(':s 005 LemonTest PREFIX=(qaohv)~&@%+ CHANMODES=b,k,l,imnst :supported');
    client.receive(':Alice!u@h JOIN #a');
    client.receive(':s MODE #a +klov secret 15 Alice Alice');
    assert.equal(client.channel('#a').members.get(client.user('Alice').id).modes, 'ov');
    client.receive(':s MODE #a -o Alice');
    assert.equal(client.channel('#a').members.get(client.user('Alice').id).modes, 'v');
});

test('part during names does not resurrect a member and history is bounded', () =>
{
    const client = new Client(() => {});
    client.receive(':s 353 me = #a :Alice Bob');
    client.receive(':Alice!u@h PART #a');
    client.receive(':s 366 me #a :end');
    assert.equal(client.channel('#a').members.has(client.user('Alice').id), false);
    for (let i = 0; i < 520; i++)
    {
        client.status('message ' + i);
    }
    assert.equal(client.conversation('network').messages.length, 500);
});

test('SASL waits for success and fails closed when unavailable', () =>
{
    const lines = [];
    const client = new Client(line => lines.push(line));
    client.register('Example', 'account', 'password');
    client.receive(':s CAP * LS :sasl=PLAIN,EXTERNAL');
    assert.equal(lines.at(-1), 'CAP REQ :sasl');
    client.receive(':s CAP * ACK :sasl');
    assert.equal(lines.at(-1), 'AUTHENTICATE PLAIN');
    client.receive('AUTHENTICATE +');
    assert.equal(Buffer.from(lines.at(-1).slice(13), 'base64').toString(), '\0account\0password');
    assert.equal(client.password, '');
    client.receive(':s 903 Example :success');
    assert.equal(lines.at(-1), 'CAP END');
    client.register('Example', 'account', 'password');
    client.capabilities = [];
    assert.throws(() => client.receive(':s CAP * LS :server-time'), /does not offer/);
    assert.equal(lines.at(-1), 'QUIT :SASL PLAIN unavailable');
});
