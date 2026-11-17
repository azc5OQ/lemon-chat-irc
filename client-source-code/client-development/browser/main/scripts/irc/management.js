/**
 * @brief opens channel settings and irc operator controls
 *
 * @param object context -> current client and shared dialog helpers
 *
 * @return void
 */
LemonIrc.openManagement = function(context)
{
    const {client, make, button, dialog, isCurrent} = context;
    const panel = dialog('IRC management');
    panel.id = 'irc-management';
    const section = document.createElement('select');
    section.className = 'text-input-pretty';
    section.ariaLabel = 'Manage';
    for (const [value, label] of [['network', 'Network information'], ['channel', 'Channel settings'], ['operator', 'IRC operator']])
    {
        const option = make('option', label);
        option.value = value;
        section.append(option);
    }
    const pages = new Map();
    for (const name of ['network', 'channel', 'operator'])
    {
        const page = make('div', '', 'irc-management-section');
        page.dataset.section = name;
        pages.set(name, page);
    }
    const status = make('p', '');
    status.setAttribute('role', 'status');
    const replies = make('pre', '', 'irc-management-replies');
    replies.ariaLabel = 'Server replies';
    const heading = make('div', '', 'irc-management-heading');
    const navigation = make('div', '', 'irc-management-navigation');
    navigation.append(section);
    heading.append(panel.firstElementChild, navigation);
    panel.append(heading, ...pages.values(), status, make('p', 'Recent server replies'), replies);
    const available = () => client.connected && isCurrent();
    const run = action =>
    {
        try
        {
            if (!available())
            {
                throw new Error('Connection closed. Reconnect before changing settings');
            }
            action();
            status.textContent = 'Request sent. Check the server replies below';
        }
        catch (error)
        {
            status.textContent = error.message;
            context.onError?.(error);
        }
    };
    const field = (parent, label, type = 'text') =>
    {
        const row = make('label', label, 'irc-management-field');
        const input = document.createElement('input');
        input.type = type;
        input.className = 'text-input-pretty';
        row.append(input);
        parent.append(row);
        return input;
    };
    const token = (value, label) =>
    {
        value = value.trim();
        if (!value || /[\s,:\x00-\x1f\x7f]/.test(value))
        {
            throw new Error('Enter ' + label + ' without spaces or commas');
        }
        return value;
    };
    const confirm = (title, explanation, action) =>
    {
        const question = dialog(title);
        question.append(make('p', explanation), button('Confirm', () =>
        {
            question.close();
            run(action);
        }), button('Cancel', () => question.close()));
    };

    // network details
    const network = pages.get('network');
    const description = make('dl', '', 'irc-user-details');
    for (const [label, value] of [['Network', client.network], ['Connected server', client.serverName || 'Not reported'], ['Server software', client.serverVersion || 'Not reported'], ['Your nickname', client.nick]])
    {
        description.append(make('dt', label), make('dd', value));
    }
    network.append(description, make('p', 'Channel operators manage individual channels. IRC operators have a separate account configured by the network administrator.'), button('Request server information', () => run(() =>
    {
        client.write('VERSION');
        client.write('ADMIN');
        client.write('LUSERS');
    })));

    // channel settings
    const channelPage = pages.get('channel');
    const channelChoice = document.createElement('select');
    channelChoice.className = 'text-input-pretty';
    channelChoice.ariaLabel = 'Channel';
    for (const channel of client.channels.values())
    {
        if (channel.joined)
        {
            const option = make('option', channel.name);
            option.value = channel.name;
            channelChoice.append(option);
        }
    }
    if (context.channelName && [...channelChoice.options].some(option => option.value === context.channelName))
    {
        channelChoice.value = context.channelName;
    }
    const selected = () => client.channels.get(client.fold(channelChoice.value));
    const mayManage = () =>
    {
        const channel = selected();
        const member = channel?.members.get(client.user(client.nick).id);
        return available() && channel?.joined && /[qaoh]/.test(member?.modes || '');
    };
    const channelHint = make('p', '');
    const refresh = () => run(() => client.requestChannelSettings(channelChoice.value));
    channelPage.append(channelChoice, button('Refresh channel', refresh), channelHint);
    const topic = field(channelPage, 'Topic');
    let topicChannel = null;
    let topicEdited = false;
    topic.oninput = () => topicEdited = true;
    const topicButton = button('Set topic', () => run(() =>
    {
        client.write('TOPIC ' + channelChoice.value + ' :' + topic.value);
        topicEdited = false;
    }));
    channelPage.append(topicButton);
    const modes = new Map();
    for (const [mode, label] of [['i', 'Invite only'], ['m', 'Moderated chat'], ['n', 'Only members may send messages'], ['t', 'Only channel operators may change the topic'], ['s', 'Hide channel from public lists']])
    {
        if (!client.channelModes.join('').includes(mode))
        {
            continue;
        }
        const row = make('label', '', 'irc-management-toggle');
        const control = document.createElement('input');
        control.type = 'checkbox';
        row.append(control, document.createTextNode(label + ' (+' + mode + ')'));
        channelPage.append(row);
        modes.set(mode, control);
        control.onchange = () => run(() => client.write('MODE ' + channelChoice.value + ' ' + (control.checked ? '+' : '-') + mode));
    }
    const controls = [];
    if (client.channelModes.join('').includes('k'))
    {
        const password = field(channelPage, 'Channel password', 'password');
        password.autocomplete = 'new-password';
        const set = button('Set password', () => run(() =>
        {
            if (selected().modes.has('k'))
            {
                throw new Error('Remove the existing password before setting a new one');
            }
            client.write('MODE ' + channelChoice.value + ' +k ' + token(password.value, 'a channel password'));
            password.value = '';
        }));
        const remove = button('Remove password', () => run(() =>
        {
            const key = password.value || selected().modes.get('k');
            if (!key || key === '*')
            {
                throw new Error('Enter the current channel password to remove it');
            }
            client.write('MODE ' + channelChoice.value + ' -k ' + token(key, 'the current channel password'));
            password.value = '';
        }));
        channelPage.append(set, remove);
        controls.push(password, set, remove);
    }
    if (client.channelModes.join('').includes('l'))
    {
        const limit = field(channelPage, 'Member limit', 'number');
        limit.min = '1';
        const set = button('Set limit', () => run(() =>
        {
            const count = Number(limit.value);
            if (!Number.isSafeInteger(count) || count < 1 || count > 2147483647)
            {
                throw new Error('Enter a positive whole number for the member limit');
            }
            client.write('MODE ' + channelChoice.value + ' +l ' + count);
        }));
        const remove = button('Remove limit', () => run(() => client.write('MODE ' + channelChoice.value + ' -l')));
        channelPage.append(set, remove);
        controls.push(limit, set, remove);
    }
    const currentModes = make('p', '');
    channelPage.append(currentModes, make('h3', 'Bans'));
    const banList = make('div', '', 'irc-management-bans');
    channelPage.append(banList);
    const mask = field(channelPage, 'Ban mask');
    mask.placeholder = 'nickname!user@host';
    const addBan = button('Add ban', () => run(() => client.write('MODE ' + channelChoice.value + ' +b ' + token(mask.value, 'a ban mask'))));
    channelPage.append(addBan, make('p', 'A ban prevents matching users from joining. Use Kick in a member’s context menu to remove someone already here.'));
    controls.push(mask, addBan);

    // channel roles
    channelPage.append(make('h3', 'Member roles'));
    const memberChoice = document.createElement('select');
    memberChoice.ariaLabel = 'Member';
    memberChoice.className = 'text-input-pretty';
    const roleChoice = document.createElement('select');
    roleChoice.ariaLabel = 'Role';
    roleChoice.className = 'text-input-pretty';
    for (const mode of client.prefixModes)
    {
        const option = make('option', ({q: 'Owner', a: 'Admin', o: 'Operator', h: 'Half operator', v: 'Voice in moderated chat'}[mode] || 'Mode ' + mode) + ' (+' + mode + ')');
        option.value = mode;
        roleChoice.append(option);
    }
    const changeRole = add => run(() => client.write('MODE ' + channelChoice.value + ' ' + (add ? '+' : '-') + roleChoice.value + ' ' + token(memberChoice.value, 'a nickname')));
    const grant = button('Grant role', () => changeRole(true));
    const revoke = button('Remove role', () => changeRole(false));
    channelPage.append(memberChoice, roleChoice, grant, revoke);
    controls.push(memberChoice, roleChoice, grant, revoke);

    // operator tools
    const operator = pages.get('operator');
    operator.append(make('p', 'Use an IRC operator account supplied by this server’s administrator. Your NickServ account and channel operator status do not grant these privileges.'));
    const operatorState = make('p', '');
    operator.append(operatorState);
    const account = field(operator, 'Operator account');
    account.autocomplete = 'off';
    const secret = field(operator, 'Operator password', 'password');
    secret.autocomplete = 'off';
    const login = button('Log in as IRC operator', () => run(() =>
    {
        const name = token(account.value, 'an operator account');
        if (!secret.value || /[\r\n\0]/.test(secret.value))
        {
            throw new Error('Enter the operator password');
        }
        const password = secret.value;
        secret.value = '';
        client.write('OPER ' + name + ' :' + password);
    }));
    const logout = button('Drop operator privileges', () => run(() => client.write('MODE ' + client.nick + ' -o')));
    operator.append(login, logout, make('h3', 'Disconnect a user'));
    const target = field(operator, 'Nickname to disconnect');
    const reason = field(operator, 'Reason');
    const kill = button('Disconnect user (KILL)', () => run(() =>
    {
        const nick = token(target.value, 'one nickname');
        if (/[*?]/.test(nick) || client.channelTypes.includes(nick[0]) || !reason.value.trim())
        {
            throw new Error('Enter one nickname and a reason');
        }
        const explanation = reason.value.trim();
        confirm('Disconnect ' + nick + '?', 'This disconnects ' + nick + ' from the network. It does not ban them from reconnecting.', () =>
        {
            if (!client.operator)
            {
                throw new Error('IRC operator privileges are required');
            }
            client.write('KILL ' + nick + ' :' + explanation);
        });
    }));
    operator.append(kill, make('h3', 'Reload server configuration'), make('p', 'After changing configuration files on the server, REHASH asks the connected server to reload them. This window cannot edit those files.'));
    const rehash = button('Reload configuration (REHASH)', () => confirm('Reload server configuration?', 'Ask ' + (client.serverName || 'the connected server') + ' to reload its configuration files?', () =>
    {
        if (!client.operator)
        {
            throw new Error('IRC operator privileges are required');
        }
        client.write('REHASH');
    }));
    operator.append(rehash, make('p', 'Each network decides which operator commands your account may use. Permission failures appear in the server replies. Network bans and services such as ChanServ and OperServ use server-specific rules and are not configured here.'));

    let banSignature = '';
    let memberSignature = '';
    const update = () =>
    {
        for (const [name, page] of pages)
        {
            page.hidden = section.value !== name;
        }
        const channel = selected();
        const manage = mayManage() && channel.modesKnown;
        channelHint.textContent = !channel ? 'Join a channel to manage it here' : (!channel.joined ? 'You have left this channel' : (!channel.modesKnown ? 'Waiting for channel settings. Refresh if the server does not reply' : (mayManage() ? 'Your channel role permits moderation. The server checks each change' : 'You are not a channel operator. Settings are shown for reference')));
        for (const [mode, control] of modes)
        {
            control.checked = Boolean(channel?.modes.has(mode));
            control.disabled = !manage;
        }
        for (const control of controls)
        {
            control.disabled = !manage;
        }
        topicButton.disabled = !available() || !channel?.joined || !channel.modesKnown || (channel.modes.has('t') && !mayManage());
        if (channel && (topicChannel !== channel || !topicEdited))
        {
            topic.value = channel.topic;
            topicChannel = channel;
        }
        currentModes.textContent = !channel?.modesKnown ? '' : 'Server modes: +' + [...channel.modes.keys()].join('') + (channel.modes.has('k') ? ' · password enabled' : '') + (channel.modes.has('l') ? ' · member limit ' + channel.modes.get('l') : '');
        const bans = JSON.stringify([channel?.name, channel?.bansKnown, manage, [...(channel?.bans || [])]]);
        if (bans !== banSignature)
        {
            banSignature = bans;
            banList.replaceChildren();
            if (!channel?.bansKnown)
            {
                banList.append(make('p', 'Ban list not received. The server may restrict access'));
            }
            else if (!channel.bans.size)
            {
                banList.append(make('p', 'No bans'));
            }
            else
            {
                for (const ban of channel.bans.values())
                {
                    const row = make('div', '', 'irc-management-ban');
                    const remove = button('Remove', () => run(() => client.write('MODE ' + channel.name + ' -b ' + token(ban.mask, 'a ban mask'))));
                    remove.disabled = !manage;
                    row.append(make('span', ban.mask + (ban.setter ? ' · ' + ban.setter : '')), remove);
                    banList.append(row);
                }
            }
        }
        const members = [...(channel?.members.values() || [])].map(member => [member.user.nick, member.modes]);
        const signature = JSON.stringify(members);
        if (signature !== memberSignature)
        {
            memberSignature = signature;
            const previous = memberChoice.value;
            memberChoice.replaceChildren();
            for (const [name, roles] of members)
            {
                const option = make('option', name + (roles ? ' (+' + roles + ')' : ''));
                option.value = name;
                memberChoice.append(option);
            }
            if ([...memberChoice.options].some(option => option.value === previous))
            {
                memberChoice.value = previous;
            }
        }
        operatorState.textContent = !available() ? 'Not connected' : (client.operator ? 'IRC operator privileges confirmed by the server' : 'You are not logged in as an IRC operator');
        login.disabled = !available() || client.operator;
        for (const control of [logout, target, reason, kill, rehash])
        {
            control.disabled = !available() || !client.operator;
        }
        const text = client.conversation('network').messages.slice(-25).map(message => message.text).join('\n');
        if (replies.textContent !== text)
        {
            replies.textContent = text;
            replies.scrollTop = replies.scrollHeight;
        }
    };
    channelChoice.onchange = () =>
    {
        topicChannel = null;
        topicEdited = false;
        for (const control of controls)
        {
            if (control.tagName === 'INPUT')
            {
                control.value = '';
            }
        }
        refresh();
        update();
    };
    section.onchange = () =>
    {
        if (section.value === 'channel' && selected())
        {
            refresh();
        }
        update();
    };
    if (context.channelName)
    {
        section.value = 'channel';
        section.onchange();
    }
    const timer = setInterval(update, 250);
    panel.addEventListener('close', () =>
    {
        clearInterval(timer);
        secret.value = '';
    });
    update();
};
