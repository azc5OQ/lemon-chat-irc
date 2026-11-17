// shared user state
(function(root)
{
    /**
     * @brief splits an irc line into tags, sender, command and parameters
     *
     * @param string line -> received line without line endings
     *
     * @return object|null parsed message or invalid line
     */
    function parse(line)
    {
        if (typeof line !== 'string' || /[\r\n\0]/.test(line))
        {
            return null;
        }
        const tags = Object.create(null);
        line = line.replace(/^ +/, '');
        if (line.startsWith('@'))
        {
            const end = line.indexOf(' ');
            if (end < 0)
            {
                return null;
            }
            for (const item of line.slice(1, end).split(';'))
            {
                const split = item.indexOf('=');
                const key = split < 0 ? item : item.slice(0, split);
                if (key)
                {
                    tags[key] = split < 0 ? '' : item.slice(split + 1).replace(/\\(.|$)/g, (_, character) => ({':': ';', s: ' ', r: '\r', n: '\n', '\\': '\\'}[character] ?? character));
                }
            }
            line = line.slice(end + 1).replace(/^ +/, '');
        }
        let prefix = '';
        if (line.startsWith(':'))
        {
            const end = line.indexOf(' ');
            if (end <= 1)
            {
                return null;
            }
            prefix = line.slice(1, end);
            line = line.slice(end + 1).replace(/^ +/, '');
        }
        const trailing = line.indexOf(' :');
        const params = (trailing < 0 ? line : line.slice(0, trailing)).replace(/ +$/, '').split(/ +/);
        if (trailing >= 0)
        {
            params.push(line.slice(trailing + 2));
        }
        const command = params.shift().toUpperCase();
        return /^[A-Z]+$|^\d{3}$/.test(command) ? {tags, prefix, command, params, nick: prefix.split('!')[0]} : null;
    }

    class Client
    {
        constructor(send, changed = () =>
        {
        })
        {
            this.send = send;
            this.changed = changed;
            this.nick = '';
            this.connected = false;
            this.operator = false;
            this.eventLocation = 'chat';
            this.serverName = '';
            this.serverVersion = '';
            this.network = 'IRC network';
            this.caseMapping = 'rfc1459';
            this.prefixModes = 'ov';
            this.prefixSymbols = '@+';
            this.channelModes = ['b', 'k', 'l', 'imnst'];
            this.channelTypes = '#&';
            this.users = new Map();
            // saved nicknames whose messages are dropped, including people not seen yet
            this.ignoredNicks = new Set();
            this.channels = new Map();
            this.conversations = new Map();
            this.directory = new Map();
            this.directoryRevision = 0;
            this.listing = false;
            this.pendingDirectory = null;
            this.directoryTruncated = false;
            this.capabilities = [];
            this.enabled = new Set();
            this.pendingCaps = new Set();
            this.isupport = new Map();
            this.saslStarted = false;
            this.saslComplete = false;
            this.capEnded = false;
            this.metadataSubscribed = false;
            this.userQueries = new Map();
            this.nextId = 1;
            this.status('Choose a nickname and connect.');
        }

        fold(value)
        {
            let result = value.toLowerCase();
            if (this.caseMapping !== 'ascii')
            {
                result = result.replace(/[\[\]\\]/g, c => ({'[': '{', ']': '}', '\\': '|'}[c]));
                if (this.caseMapping !== 'strict-rfc1459')
                {
                    result = result.replace(/\^/g, '~');
                }
            }
            return result;
        }

        user(nick)
        {
            const key = this.fold(nick);
            if (!this.users.has(key))
            {
                if (this.users.size >= 20000)
                {
                    throw new Error('User list limit reached. Reconnect to clear old entries.');
                }
                this.users.set(key, {id: this.nextId++, nick, fields: new Map(), metadata: new Map(), away: '', account: null, country: '', serverCountry: '', lastActiveAt: 0, connectedAt: 0, connectionTimeChecked: false, ignored: this.savedIgnore(nick)});
            }
            return this.users.get(key);
        }

        /**
         * @brief checks the saved ignore list for a nickname
         *
         * @param string nick -> nickname to check
         *
         * @return bool whether the nickname is saved as ignored
         */
        savedIgnore(nick)
        {
            const key = this.fold(nick);
            return [...this.ignoredNicks].some(saved => this.fold(saved) === key);
        }

        /**
         * @brief checks whether messages from a nickname are dropped
         *
         * @param string nick -> nickname to check
         *
         * @return bool whether the nickname is ignored
         */
        isIgnored(nick)
        {
            const user = this.users.get(this.fold(nick));
            return user ? user.ignored : this.savedIgnore(nick);
        }

        channel(name)
        {
            const key = this.fold(name);
            if (!this.channels.has(key))
            {
                if (this.channels.size >= 1000)
                {
                    throw new Error('Channel limit reached.');
                }
                const listed = this.directory.get(key);
                this.channels.set(key, {id: 'channel:' + key, name, topic: listed?.topic || '', joined: false, collapsed: true, members: new Map(), metadata: new Map(), names: null, membersUpdated: 0, modes: new Map(), modesKnown: false, bans: new Map(), pendingBans: null, bansKnown: false});
            }
            return this.channels.get(key);
        }

        conversation(id, name = id)
        {
            if (!this.conversations.has(id))
            {
                if (this.conversations.size >= 250)
                {
                    throw new Error('Close a conversation before opening another.');
                }
                this.conversations.set(id, {id, name, messages: [], unread: 0, draft: '', typing: new Map()});
            }
            return this.conversations.get(id);
        }

        private(user)
        {
            const conversation = this.conversation('user:' + user.id, user.nick);
            conversation.user = user;
            return conversation;
        }

        message(id, name, author, text, tags = {}, action = false, kind = 'info')
        {
            const conversation = this.conversation(id, name);
            const sender = this.users.get(this.fold(author));
            if (sender)
            {
                conversation.typing.delete(sender.id);
            }
            conversation.messages.push({author, text, time: Number.isFinite(Date.parse(tags.time)) ? tags.time : new Date().toISOString(), own: this.fold(author) === this.fold(this.nick), action, kind});
            if (conversation.messages.length > 500)
            {
                conversation.messages.shift();
            }
            if (author && this.fold(author) !== this.fold(this.nick))
            {
                conversation.unread++;
            }
        }

        /**
         * @brief puts a channel event in the selected destination
         *
         * @param object channel -> affected channel
         * @param string text -> event description
         * @param string kind -> event category
         *
         * @return void
         */
        channelEvent(channel, text, kind = 'info')
        {
            if (this.eventLocation === 'log')
            {
                this.status(channel.name + ': ' + text, kind);
            }
            else
            {
                this.message(channel.id, channel.name, '', text, {}, false, kind);
            }
        }

        status(text, kind = 'info')
        {
            this.message('network', 'Network', '', text, {}, false, kind);
        }

        write(line)
        {
            if (/[\r\n\0]/.test(line) || new TextEncoder().encode(line).length > 510)
            {
                throw new Error('This IRC line is too long or contains a line break.');
            }
            this.send(line);
        }

        register(nick, account = '', password = '')
        {
            if (!/^[A-Za-z_\[\]\\`^{}|][A-Za-z0-9_\[\]\\`^{}|\-]{0,29}$/.test(nick))
            {
                throw new Error('Choose a nickname with letters and numbers, without spaces.');
            }
            this.nick = nick;
            this.operator = false;
            this.capabilities = [];
            this.enabled.clear();
            this.pendingCaps.clear();
            this.isupport.clear();
            this.saslStarted = false;
            this.saslComplete = false;
            this.capEnded = false;
            this.metadataSubscribed = false;
            this.userQueries.clear();
            for (const user of this.users.values())
            {
                user.connectedAt = 0;
                user.connectionTimeChecked = false;
                user.fields.delete('Connected since');
            }
            this.preferredNick = nick;
            this.nicknameAttempts = 0;
            this.account = account;
            this.password = password;
            if (Boolean(account) !== Boolean(password) || /\0/.test(account + password) || account.length > 100 || password.length > 1024)
            {
                throw new Error('Enter both an account name and password, or leave both empty.');
            }
            this.write('CAP LS 302');
            this.write('NICK ' + nick);
            this.write('USER lemonirc 0 * :Lemon IRC');
        }

        /**
         * @brief requests public channels while keeping the previous list
         *
         * @return void
         */
        requestDirectory()
        {
            if (!this.connected || this.listing)
            {
                return;
            }
            this.pendingDirectory = new Map();
            if (this.directory.size === 0)
            {
                this.directory = this.pendingDirectory;
                this.directoryRevision++;
            }
            this.listing = true;
            this.directoryTruncated = false;
            this.write('LIST');
            this.changed();
        }

        /**
         * @brief records observed user actions without treating history as new activity
         *
         * @param object packet -> parsed irc message
         *
         * @return void
         */
        recordActivity(packet)
        {
            if (!packet.prefix.includes('!') || packet.tags.batch || !['PRIVMSG', 'NOTICE', 'JOIN', 'PART', 'NICK', 'TOPIC', 'MODE', 'KICK', 'AWAY'].includes(packet.command))
            {
                return;
            }
            const text = packet.params[1] || '';
            if (['PRIVMSG', 'NOTICE'].includes(packet.command) && text.startsWith('\x01') && !text.startsWith('\x01ACTION '))
            {
                return;
            }
            const now = Date.now();
            const reported = this.enabled.has('server-time') ? Date.parse(packet.tags.time) : NaN;
            const time = Number.isFinite(reported) ? Math.min(reported, now) : now;
            const user = this.user(packet.nick);
            user.lastActiveAt = Math.max(user.lastActiveAt, time);
        }

        /**
         * @brief requests visible members of an unjoined channel
         *
         * @param string name -> channel name
         *
         * @return void
         */
        requestMembers(name)
        {
            const channel = this.channel(name);
            if (!this.connected || channel.joined || channel.names || Date.now() - channel.membersUpdated < 15000)
            {
                return;
            }
            channel.names = new Map();
            channel.membersUpdated = Date.now();
            this.write('NAMES ' + channel.name);
        }

        /**
         * @brief requests user information and tracks replies by nickname
         *
         * @param string nick -> requested nickname
         * @param boolean connectionTime -> ask the user's own server for connection time
         *
         * @return object pending profile request
         */
        requestUserInfo(nick, connectionTime = false)
        {
            if (!this.connected || !nick || /[\s,:\0]/.test(nick))
            {
                throw new Error('Connect and choose a nickname first');
            }
            const key = this.fold(nick);
            const existing = this.userQueries.get(key);
            if (existing && Date.now() - existing.started < 30000)
            {
                if (!connectionTime)
                {
                    existing.background = false;
                }
                return existing;
            }
            for (const [target, pending] of this.userQueries)
            {
                if (Date.now() - pending.started >= 30000)
                {
                    this.userQueries.delete(target);
                }
            }
            if (this.userQueries.size >= 32)
            {
                throw new Error('Wait for the pending user information requests to finish.');
            }
            const user = this.user(nick);
            const info = {nick, user, fields: user.fields, background: connectionTime, complete: false, found: false, error: '', errorCode: '', started: Date.now(), channelsReceived: false};
            this.write('WHOIS ' + (connectionTime ? nick + ' ' : '') + nick);
            if (connectionTime)
            {
                user.connectionTimeChecked = true;
            }
            this.userInfo = info;
            this.userQueries.set(key, info);
            return info;
        }

        /**
         * @brief requests the selected channel's settings and ban list
         *
         * @param string name -> joined channel name
         *
         * @return void
         */
        requestChannelSettings(name)
        {
            const channel = this.channels.get(this.fold(name));
            if (!this.connected || !channel?.joined)
            {
                throw new Error('Join the channel before managing it');
            }
            channel.modesKnown = false;
            channel.bansKnown = false;
            channel.pendingBans = new Map();
            this.write('MODE ' + channel.name);
            this.write('TOPIC ' + channel.name);
            this.write('MODE ' + channel.name + ' b');
        }

        /**
         * @brief applies server channel modes and member roles
         *
         * @param object channel -> channel state
         * @param string modes -> mode changes
         * @param array values -> mode parameters
         * @param boolean replace -> whether this is a complete mode reply
         *
         * @return void
         */
        applyChannelModes(channel, modes, values, replace = false)
        {
            if (replace)
            {
                channel.modes.clear();
                channel.modesKnown = true;
            }
            let add = true;
            let argument = 0;
            for (const mode of modes)
            {
                if (mode === '+' || mode === '-')
                {
                    add = mode === '+';
                    continue;
                }
                const membership = this.prefixModes.includes(mode);
                const list = this.channelModes[0]?.includes(mode);
                const takesValue = membership || list || this.channelModes[1]?.includes(mode) || (add && this.channelModes[2]?.includes(mode));
                const value = takesValue ? values[argument++] : true;
                if (membership && value)
                {
                    const user = this.users.get(this.fold(value));
                    for (const map of [channel.members, channel.names])
                    {
                        const entry = user && map?.get(user.id);
                        if (entry)
                        {
                            entry.modes = entry.modes.replaceAll(mode, '') + (add ? mode : '');
                        }
                    }
                }
                else if (mode === 'b' && value)
                {
                    for (const bans of [channel.bans, channel.pendingBans])
                    {
                        if (bans)
                        {
                            if (add)
                            {
                                bans.set(value, {mask: value, setter: '', time: ''});
                            }
                            else
                            {
                                bans.delete(value);
                            }
                        }
                    }
                }
                else if (!membership && !list)
                {
                    if (add && value !== undefined)
                    {
                        channel.modes.set(mode, value);
                    }
                    else
                    {
                        channel.modes.delete(mode);
                    }
                }
            }
        }

        /**
         * @brief tracks offered and accepted server capabilities
         *
         * @param array params -> cap reply parameters
         *
         * @return void
         */
        receiveCapabilities(params)
        {
            const action = params[1];
            const tokens = (params.at(-1) || '').split(' ').filter(Boolean);
            if (action === 'LS' || action === 'NEW')
            {
                for (const token of tokens)
                {
                    const name = token.split('=')[0];
                    this.capabilities = this.capabilities.filter(cap => cap.split('=')[0] !== name);
                    this.capabilities.push(token);
                }
                if (action === 'LS' && params[2] === '*')
                {
                    return;
                }
                const available = new Set(this.capabilities.map(cap => cap.split('=')[0]));
                const supported = ['server-time', 'multi-prefix', 'message-tags', 'account-tag', 'account-notify', 'away-notify', 'extended-join', 'userhost-in-names', 'chghost', 'setname', 'batch'];
                if (available.has('batch'))
                {
                    supported.push('draft/metadata-2');
                }
                if (this.account && !this.connected)
                {
                    const sasl = this.capabilities.find(cap => cap === 'sasl' || cap.startsWith('sasl='));
                    if (!sasl || (sasl.includes('=') && !sasl.slice(5).split(',').includes('PLAIN')))
                    {
                        this.password = '';
                        this.write('QUIT :SASL PLAIN unavailable');
                        throw new Error('This server does not offer SASL PLAIN. Account login was stopped.');
                    }
                    supported.push('sasl');
                }
                const wanted = supported.filter(cap => available.has(cap) && !this.enabled.has(cap) && !this.pendingCaps.has(cap));
                if (wanted.length)
                {
                    wanted.forEach(cap => this.pendingCaps.add(cap));
                    this.write('CAP REQ :' + wanted.join(' '));
                }
            }
            else if (action === 'ACK' || action === 'NAK' || action === 'DEL')
            {
                for (const token of tokens)
                {
                    const name = token.replace(/^-/, '').split('=')[0];
                    this.pendingCaps.delete(name);
                    if (action === 'ACK' && !token.startsWith('-'))
                    {
                        this.enabled.add(name);
                    }
                    else
                    {
                        this.enabled.delete(name);
                    }
                    if (action === 'DEL')
                    {
                        this.capabilities = this.capabilities.filter(cap => cap.split('=')[0] !== name);
                    }
                    if (name === 'sasl' && action === 'NAK' && this.account && !this.connected)
                    {
                        this.password = '';
                        this.write('QUIT :SASL negotiation rejected');
                        throw new Error('Account login was rejected during capability negotiation.');
                    }
                }
                if (!this.enabled.has('batch') && !this.pendingCaps.has('batch'))
                {
                    this.enabled.delete('draft/metadata-2');
                }
                if (!this.enabled.has('draft/metadata-2'))
                {
                    this.metadataSubscribed = false;
                }
            }
            this.finishCapabilities();
            this.changed();
        }

        /**
         * @brief advances login and subscribes to supported profile metadata
         *
         * @return void
         */
        finishCapabilities()
        {
            if (this.pendingCaps.size)
            {
                return;
            }
            if (!this.connected && !this.capEnded)
            {
                if (this.account && !this.saslComplete)
                {
                    if (!this.saslStarted && this.enabled.has('sasl'))
                    {
                        this.saslStarted = true;
                        this.write('AUTHENTICATE PLAIN');
                    }
                    return;
                }
                this.capEnded = true;
                this.write('CAP END');
            }
            if (this.connected && this.enabled.has('draft/metadata-2') && !this.metadataSubscribed)
            {
                const advertised = this.capabilities.find(cap => cap.startsWith('draft/metadata-2=')) || '';
                const limit = /(?:=|,)max-subs=(\d+)/.exec(advertised);
                const keys = ['avatar', 'display-name', 'bot', 'status', 'homepage'].slice(0, limit ? Number(limit[1]) : 5);
                if (keys.length)
                {
                    this.write('METADATA * SUB ' + keys.join(' '));
                }
                this.metadataSubscribed = true;
            }
        }

        /**
         * @brief sends typing state within the server and rate limits
         *
         * @param string id -> conversation identifier
         * @param boolean active -> whether typing continues
         * @param number now -> current time in milliseconds
         *
         * @return void
         */
        sendTyping(id, active, now = Date.now())
        {
            if (!this.connected || !this.enabled.has('message-tags'))
            {
                return;
            }
            let denied = false;
            for (const rule of (this.isupport.get('CLIENTTAGDENY') || '').split(','))
            {
                if (rule === '*' || rule === 'typing')
                {
                    denied = true;
                }
                else if (rule === '-typing')
                {
                    denied = false;
                }
            }
            const conversation = this.conversations.get(id);
            const target = conversation?.user?.nick || (id.startsWith('channel:') ? conversation?.name : null);
            if (denied || !target || (id.startsWith('channel:') && !this.channels.get(this.fold(target))?.joined) || now - (conversation.typingSentAt ?? -Infinity) < 3000)
            {
                return;
            }
            this.write('@+typing=' + (active ? 'active' : 'done') + ' TAGMSG ' + target);
            conversation.typingSentAt = now;
        }

        /**
         * @brief handles profile updates, typing and version requests
         *
         * @param object packet -> parsed message
         *
         * @return boolean whether the message was handled
         */
        receiveFeatures(packet)
        {
            const {command, params: p, tags, prefix, nick} = packet;
            if (command === 'PRIVMSG' && p[1] === '\x01VERSION\x01' && prefix.includes('!') && this.fold(p[0]) === this.fold(this.nick))
            {
                if (this.connected && Date.now() - (this.lastVersionReply || 0) >= 10000)
                {
                    this.lastVersionReply = Date.now();
                    this.write('NOTICE ' + nick + ' :\x01VERSION Lemon IRC 0.1.0\x01');
                }
                return true;
            }
            if (command === 'TAGMSG')
            {
                const state = tags['+typing'] || tags['+draft/typing'];
                const user = this.users.get(this.fold(nick));
                if (!this.enabled.has('message-tags') || !user || user.ignored || this.fold(nick) === this.fold(this.nick) || !['active', 'paused', 'done'].includes(state))
                {
                    return true;
                }
                const channel = this.channels.get(this.fold(p[0] || ''));
                const id = channel ? channel.id : 'user:' + user.id;
                const conversation = this.conversations.get(id);
                if (!conversation || (channel ? !channel.joined || !channel.members.has(user.id) : this.fold(p[0] || '') !== this.fold(this.nick)))
                {
                    return true;
                }
                if (state === 'done')
                {
                    conversation.typing.delete(user.id);
                }
                else
                {
                    conversation.typing.set(user.id, {user, state, expires: Date.now() + (state === 'paused' ? 30000 : 6000)});
                    if (state === 'active' && !tags.batch)
                    {
                        user.lastActiveAt = Date.now();
                    }
                }
                return true;
            }
            if (command === 'BATCH')
            {
                return true;
            }
            if (command === 'METADATA' || command === '761')
            {
                if (!this.enabled.has('draft/metadata-2') || prefix.includes('!'))
                {
                    return true;
                }
                const [target, key, visibility, value] = command === '761' ? p.slice(1) : p;
                if (!target || !key || key.length > 64 || (value && value.length > 4096))
                {
                    return true;
                }
                const owner = this.channelTypes.includes(target[0]) ? this.channels.get(this.fold(target)) : this.users.get(this.fold(target));
                if (owner && (owner.metadata.size < 32 || owner.metadata.has(key)))
                {
                    if (value === undefined)
                    {
                        owner.metadata.delete(key);
                    }
                    else
                    {
                        owner.metadata.set(key, value);
                    }
                }
                return true;
            }
            if (prefix.includes('!') && ['JOIN', 'PRIVMSG', 'NOTICE', 'ACCOUNT', 'AWAY', 'CHGHOST', 'SETNAME'].includes(command))
            {
                const user = this.user(nick);
                const mask = /^([^!]+)!([^@]*)@(.*)$/.exec(prefix);
                if (mask)
                {
                    user.fields.set('Username', mask[2]);
                    user.fields.set('Host', mask[3]);
                }
                if (tags.account !== undefined && this.enabled.has('account-tag'))
                {
                    user.account = tags.account === '*' ? '' : tags.account;
                }
                if (command === 'JOIN' && p.length >= 3 && this.enabled.has('extended-join'))
                {
                    user.account = p[1] === '*' ? '' : p[1];
                    user.fields.set('Real name', p[2]);
                }
                if (command === 'ACCOUNT')
                {
                    user.account = p[0] === '*' ? '' : p[0] || '';
                }
                if (command === 'AWAY')
                {
                    user.away = p[0] || '';
                    user.fields.set('Away', user.away || 'No');
                }
                if (command === 'CHGHOST' && p.length >= 2)
                {
                    user.fields.set('Username', p[0]);
                    user.fields.set('Host', p[1]);
                }
                if (command === 'SETNAME' && p.length)
                {
                    user.fields.set('Real name', p[0]);
                }
                if (user.account !== null)
                {
                    user.fields.set('Account', user.account || 'Not logged in');
                }
                return ['ACCOUNT', 'AWAY', 'CHGHOST', 'SETNAME'].includes(command);
            }
            return false;
        }

        receive(line)
        {
            const packet = parse(line);
            if (!packet)
            {
                return;
            }
            const {command, params: p, nick, tags} = packet;
            this.recordActivity(packet);
            if (['PRIVMSG', 'NOTICE', 'TAGMSG'].includes(command) && packet.prefix.includes('!') && this.isIgnored(nick))
            {
                return;
            }
            if (command === '421' && p[1]?.toUpperCase() === 'CAP' && !this.connected)
            {
                this.pendingCaps.clear();
                this.capEnded = true;
                if (this.account)
                {
                    this.password = '';
                    this.write('QUIT :Account authentication unavailable');
                    throw new Error('This server does not support the requested account login.');
                }
                return;
            }
            if (this.listing && ((command === '263' && p.length === 2) || (['263', '421', '461'].includes(command) && p[1]?.toUpperCase() === 'LIST')))
            {
                this.listing = false;
                this.pendingDirectory = null;
            }
            if (!this.connected && ['432', '433', '436', '437'].includes(command) && this.fold(p[1] || '') === this.fold(this.nick) && this.nicknameAttempts < 20)
            {
                this.nicknameAttempts++;
                const random = new Uint32Array(1);
                crypto.getRandomValues(random);
                this.nick = this.preferredNick.slice(0, 5) + String(1000 + random[0] % 9000);
                this.write('NICK ' + this.nick);
                this.status('Preferred nickname is unavailable. Trying ' + this.nick);
                this.changed();
                return true;
            }
            if (command === 'PING')
            {
                this.write('PONG :' + p[0]);
                return;
            }
            if (command === 'CAP')
            {
                this.receiveCapabilities(p);
                return;
            }
            if (this.receiveFeatures(packet))
            {
                this.changed();
                return;
            }
            if (command === 'AUTHENTICATE' && p[0] === '+' && this.account && this.password)
            {
                const bytes = new TextEncoder().encode('\0' + this.account + '\0' + this.password);
                const encoded = btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(''));
                this.password = '';
                for (let offset = 0; offset < encoded.length; offset += 400)
                {
                    this.write('AUTHENTICATE ' + encoded.slice(offset, offset + 400));
                }
                if (encoded.length % 400 === 0)
                {
                    this.write('AUTHENTICATE +');
                }
                return;
            }
            if (command === '903')
            {
                this.saslComplete = true;
                this.finishCapabilities();
            }
            if (['904', '905', '906', '907'].includes(command))
            {
                this.password = '';
                this.write('QUIT :Account login failed');
                throw new Error('Account login failed. Check your IRC account credentials.');
            }
            if (command === '001')
            {
                if (this.account && !this.saslComplete)
                {
                    this.password = '';
                    this.write('QUIT :Account authentication was not confirmed');
                    throw new Error('The server did not confirm your account login.');
                }
                this.nick = p[0];
                this.serverName = packet.prefix;
                this.connected = true;
                this.user(this.nick);
                this.finishCapabilities();
            }
            if (command === '004')
            {
                this.serverName = p[1] || this.serverName;
                this.serverVersion = p[2] || '';
            }
            else if (command === '381')
            {
                this.operator = true;
                this.status(command + ' ' + p.slice(1).join(' '), 'operator');
            }
            else if (command === '221')
            {
                this.operator = (p[1] || '').includes('o');
            }
            else if (command === '005')
            {
                for (const token of p.slice(1, -1))
                {
                    const separator = token.indexOf('=');
                    const key = separator < 0 ? token : token.slice(0, separator);
                    const value = separator < 0 ? '' : token.slice(separator + 1).replace(/\\x([\da-f]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
                    if (key.startsWith('-'))
                    {
                        this.isupport.delete(key.slice(1));
                    }
                    else
                    {
                        this.isupport.set(key, value);
                    }
                    if (key === 'NETWORK')
                    {
                        this.network = value;
                    }
                    if (key === 'CASEMAPPING' && ['ascii', 'rfc1459', 'strict-rfc1459'].includes(value))
                    {
                        this.caseMapping = value;
                    }
                    if (key === 'CHANTYPES')
                    {
                        this.channelTypes = value;
                    }
                    if (key === 'CHANMODES')
                    {
                        this.channelModes = value.split(',');
                    }
                    const prefix = key === 'PREFIX' && /^\(([^)]+)\)(.+)$/.exec(value);
                    if (prefix)
                    {
                        this.prefixModes = prefix[1];
                        this.prefixSymbols = prefix[2];
                    }
                }
            }
            else if (command === 'JOIN')
            {
                const channel = this.channel(p[0]);
                const user = this.user(nick);
                if (this.fold(nick) === this.fold(this.nick))
                {
                    channel.members.clear();
                    channel.names = null;
                    channel.collapsed = false;
                }
                channel.members.set(user.id, {user, modes: ''});
                channel.names?.set(user.id, {user, modes: ''});
                if (this.fold(nick) === this.fold(this.nick))
                {
                    channel.joined = true;
                    this.conversation(channel.id, channel.name);
                }
                this.channelEvent(channel, nick + ' joined', 'join');
            }
            else if (command === '353')
            {
                const channel = this.channel(p[2]);
                channel.names ??= new Map();
                for (let name of p[3].split(' '))
                {
                    let modes = '';
                    while (name && this.prefixSymbols.includes(name[0]))
                    {
                        modes += this.prefixModes[this.prefixSymbols.indexOf(name[0])];
                        name = name.slice(1);
                    }
                    if (name)
                    {
                        const user = this.user(name.split('!')[0]);
                        const mask = /^[^!]+!([^@]*)@(.*)$/.exec(name);
                        if (mask)
                        {
                            user.fields.set('Username', mask[1]);
                            user.fields.set('Host', mask[2]);
                        }
                        channel.names.set(user.id, {user, modes});
                    }
                }
            }
            else if (command === '366')
            {
                const channel = this.channel(p[1]);
                if (channel.names)
                {
                    channel.members = channel.names;
                    channel.names = null;
                }
                channel.membersUpdated = Date.now();
            }
            else if (command === 'PART' || command === 'KICK' || command === 'QUIT')
            {
                const departing = command === 'KICK' ? p[1] : nick;
                const user = this.users.get(this.fold(departing));
                if (command === 'QUIT' && user)
                {
                    user.connectedAt = 0;
                    user.connectionTimeChecked = false;
                    user.fields.delete('Connected since');
                    const query = this.userQueries.get(this.fold(departing));
                    if (query)
                    {
                        query.complete = true;
                        query.error = 'This user disconnected';
                        this.userQueries.delete(this.fold(departing));
                    }
                }
                const channels = command === 'QUIT' ? [...this.channels.values()] : [this.channel(p[0])];
                for (const channel of channels)
                {
                    if (user && channel.members.has(user.id))
                    {
                        this.channelEvent(channel, departing + (command === 'KICK' ? ' was kicked by ' + nick : (command === 'QUIT' ? ' disconnected' : ' left')), command === 'KICK' ? 'moderation' : 'leave');
                    }
                    if (user)
                    {
                        channel.members.delete(user.id);
                        channel.names?.delete(user.id);
                        this.conversations.get(channel.id)?.typing.delete(user.id);
                        if (command === 'QUIT')
                        {
                            this.conversations.get('user:' + user.id)?.typing.clear();
                        }
                    }
                    if (this.fold(departing) === this.fold(this.nick))
                    {
                        channel.joined = false;
                        channel.members.clear();
                        channel.names = null;
                        this.conversations.get(channel.id)?.typing.clear();
                    }
                }
            }
            else if (command === 'NICK')
            {
                const user = this.user(nick);
                for (const channel of this.channels.values())
                {
                    if (channel.joined && channel.members.has(user.id))
                    {
                        this.channelEvent(channel, nick + ' is now known as ' + p[0], 'nickname');
                    }
                }
                this.users.delete(this.fold(nick));
                user.nick = p[0];
                this.users.set(this.fold(p[0]), user);
                const conversation = this.conversations.get('user:' + user.id);
                if (conversation)
                {
                    conversation.name = p[0];
                }
                if (this.fold(nick) === this.fold(this.nick))
                {
                    this.nick = p[0];
                }
            }
            else if (this.userQueries.has(this.fold(p[1] || '')) && ['301', '307', '311', '312', '313', '317', '318', '319', '320', '330', '335', '338', '344', '378', '379', '401', '671'].includes(command))
            {
                const info = this.userQueries.get(this.fold(p[1]));
                switch (command)
                {
                    case '311':
                        info.found = true;
                        info.fields.set('Nickname', p[1]);
                        info.fields.set('Username', p[2]);
                        info.fields.set('Host', p[3]);
                        info.fields.set('Real name', p[5]);
                        break;
                    case '312':
                        info.fields.set('Server', p[2] + ' · ' + p[3]);
                        this.user(p[1]).serverCountry = /,\s*([A-Z]{2})\s*$/.exec(p[3] || '')?.[1] || '';
                        break;
                    case '319':
                        info.fields.set('Visible channels', [info.channelsReceived ? info.fields.get('Visible channels') : '', p[2]].filter(Boolean).join(' '));
                        info.channelsReceived = true;
                        break;
                    case '330':
                        info.fields.set('Account', p[2]);
                        this.user(p[1]).account = p[2];
                        break;
                    case '344':
                        if (/^[A-Za-z]{2}$/.test(p[2]))
                        {
                            this.user(p[1]).country = p[2].toUpperCase();
                            info.fields.set('Country', p[2].toUpperCase() + ' · ' + p.slice(3).join(' '));
                        }
                        break;
                    case '320':
                    case '335':
                        info.fields.set(command === '335' ? 'Bot' : 'Information', p.slice(2).join(' '));
                        break;
                    case '317':
                        info.fields.set('Idle', p[2] + ' seconds');
                        if (/^\d+$/.test(p[3] || '') && Number.isSafeInteger(Number(p[3])) && Number(p[3]) > 0 && Number(p[3]) <= Date.now() / 1000 + 300)
                        {
                            info.user.connectedAt = Number(p[3]) * 1000;
                            info.user.connectionTimeChecked = true;
                            info.fields.set('Connected since', new Date(info.user.connectedAt).toLocaleString());
                        }
                        break;
                    case '301':
                        info.fields.set('Away', p[2]);
                        this.user(p[1]).away = p[2];
                        break;
                    case '318':
                        info.complete = true;
                        this.userQueries.delete(this.fold(p[1]));
                        break;
                    case '401':
                        info.errorCode = command;
                        info.error = p.at(-1);
                        info.complete = true;
                        this.userQueries.delete(this.fold(p[1]));
                        break;
                    default:
                        info.fields.set({'307': 'Registered', '313': 'Operator', '338': 'Host details', '378': 'Host details', '379': 'Modes', '671': 'Secure connection'}[command], p.slice(2).join(' '));
                        break;
                }
                this.status(command + ' ' + p.slice(1).join(' '), command === '401' ? 'error' : 'info');
            }
            else if (command === 'TOPIC' || command === '332' || command === '331')
            {
                const channel = this.channel(p[command === 'TOPIC' ? 0 : 1]);
                channel.topic = command === '331' ? '' : p.at(-1);
                if (command === 'TOPIC')
                {
                    this.channelEvent(channel, nick + ' changed the topic: ' + channel.topic, 'topic');
                }
            }
            else if (command === '324')
            {
                this.applyChannelModes(this.channel(p[1]), p[2] || '', p.slice(3), true);
            }
            else if (command === '367' || command === '368')
            {
                const channel = this.channel(p[1]);
                if (command === '367')
                {
                    (channel.pendingBans || channel.bans).set(p[2], {mask: p[2], setter: p[3] || '', time: p[4] || ''});
                }
                else
                {
                    if (channel.pendingBans)
                    {
                        channel.bans = channel.pendingBans;
                        channel.pendingBans = null;
                    }
                    channel.bansKnown = true;
                }
            }
            else if (command === 'MODE' && this.channelTypes.includes(p[0]?.[0]))
            {
                this.applyChannelModes(this.channel(p[0]), p[1] || '', p.slice(2));
                this.status(p[0] + ' modes changed: ' + p[1], 'moderation');
            }
            else if (command === 'MODE' && this.fold(p[0] || '') === this.fold(this.nick))
            {
                let add = true;
                for (const mode of p[1] || '')
                {
                    if (mode === '+' || mode === '-')
                    {
                        add = mode === '+';
                    }
                    else if (mode === 'o')
                    {
                        this.operator = add;
                    }
                }
            }
            else if (command === 'PRIVMSG' || command === 'NOTICE')
            {
                const channel = this.channelTypes.includes(p[0][0]);
                if (command === 'NOTICE' && !channel && (!packet.prefix.includes('!') || p[0] === '*'))
                {
                    this.status((nick ? nick + ': ' : '') + p[1], 'notice');
                }
                else
                {
                    const conversation = channel ? this.conversation(this.channel(p[0]).id, p[0]) : this.private(this.user(nick));
                    const action = /^\x01ACTION (.*)\x01$/.exec(p[1]);
                    this.message(conversation.id, conversation.name, nick, action ? action[1] : p[1].replaceAll('\x01', ''), tags, Boolean(action));
                }
            }
            else if (command === '322')
            {
                const key = this.fold(p[1]);
                const directory = this.pendingDirectory || this.directory;
                if (directory.size < 100000 || directory.has(key))
                {
                    directory.set(key, {id: 'channel:' + key, name: p[1], count: Number(p[2]) || 0, topic: p[3] || ''});
                    if (directory === this.directory)
                    {
                        this.directoryRevision++;
                    }
                }
                else if (!this.directoryTruncated)
                {
                    this.directoryTruncated = true;
                    this.status('This network has more than 100000 listed channels. The channel tree shows the first 100000');
                }
            }
            else if (command === '323')
            {
                if (this.pendingDirectory)
                {
                    this.directory = this.pendingDirectory;
                    this.pendingDirectory = null;
                    this.directoryRevision++;
                }
                this.listing = false;
            }
            else if (!['353', '366', '005'].includes(command))
            {
                this.status(command + ' ' + (/^\d{3}$/.test(command) ? p.slice(1) : p).join(' '), /^[45]\d{2}$/.test(command) || ['ERROR', 'FAIL', '696', '723'].includes(command) ? 'error' : (command === '263' ? 'warning' : (command === '001' ? 'connection' : 'info')));
            }
            this.changed();
        }

        say(id, text, action = false)
        {
            const conversation = this.conversations.get(id);
            const target = conversation?.user?.nick || conversation?.name;
            if (!this.connected || id === 'network' || !target)
            {
                throw new Error('Join a channel or open a private conversation first.');
            }
            if (id.startsWith('channel:') && !this.channels.get(this.fold(target))?.joined)
            {
                throw new Error('You have left this channel. Join it before sending.');
            }
            const body = action ? '\x01ACTION ' + text + '\x01' : text;
            this.write('PRIVMSG ' + target + ' :' + body);
            this.user(this.nick).lastActiveAt = Date.now();
            this.message(id, conversation.name, this.nick, text, {}, action);
            this.changed();
        }
    }
    root.LemonIrc = {Client, parse};
    if (typeof module !== 'undefined')
    {
        module.exports = root.LemonIrc;
    }
})(globalThis);
