document.addEventListener('DOMContentLoaded', () =>
{
    const byId = id => document.getElementById(id);
    const make = (tag, text, className) =>
    {
        const node = document.createElement(tag);
        node.textContent = text;
        if (className)
        {
            node.className = className;
        }
        return node;
    };
    const button = (text, action) =>
    {
        const node = make('button', text, 'button-1');
        node.type = 'button';
        node.onclick = action;
        return node;
    };
    let socket;
    let disconnectedByUser = false;
    let current = 'network';
    let scheduled = false;
    let typingTimer;
    let activityTimer;
    let connectionTimeTimer;
    let connectionTimeRequest = null;
    let nextConnectionTimeRequest = 0;
    let connectDrag = null;
    let connectFormRevision = 0;
    const messageRows = new WeakMap();
    const preferences = {avatars: true, flags: true, previews: true, site_previews: false, typing: true, channel_counts: true, roles: true, activity: true, joined_first: true};
    const soundOptions = [['connected', 'connected to server'], ['disconnected', 'disconnected from server'], ['connection_lost', 'connection lost'], ['channel_switched', 'joined a channel'], ['user_entered_your_channel', 'someone joined your channel'], ['user_left_your_channel', 'someone left your channel'], ['user_disconnected_from_your_channel', 'someone disconnected'], ['channel_edited', 'channel topic changed'], ['user_was_kicked_out_of_your_channel', 'someone was kicked'], ['incoming_channel', 'channel message received'], ['incoming_private', 'private message received'], ['message_sent', 'message sent'], ['error', 'action failed']];
    const soundPreferences = Object.fromEntries(soundOptions.map(([name]) => [name, utils__storage_get('sound_' + name) === null ? name !== 'message_sent' : utils__storage_get('sound_' + name) !== 'false']));
    let eventLocation = utils__storage_get('event_location') === 'log' ? 'log' : 'chat';
    let errorLocation = utils__storage_get('error_location') === 'log' ? 'log' : 'chat';
    const memberSortOptions = [['name-asc', 'name a–z'], ['name-desc', 'name z–a'], ['activity-desc', 'recently active'], ['role-desc', 'role'], ['connected-desc', 'online longest'], ['connected-asc', 'online shortest']];
    let memberSort = utils__storage_get('member_sort');
    if (!memberSortOptions.some(([value]) => value === memberSort))
    {
        memberSort = 'name-asc';
    }
    let lastChannel = null;
    const input = byId('chat-input-container-text-input');
    const logPanel = byId('textarea-log');
    const logButton = byId('show-hide-log-button');
    let selectedNetwork = '';
    let activeNetwork = '';
    let networkList = null;
    let networkCollapsed = false;
    let directoryOwner = null;
    let directoryRevision = -1;
    let sortedDirectory = [];
    const channelSortOptions = [['name-asc', 'name a–z'], ['name-desc', 'name z–a'], ['count-desc', 'most users'], ['count-asc', 'fewest users']];
    let channelSort = utils__storage_get('channel_sort');
    if (!channelSortOptions.some(([value]) => value === channelSort))
    {
        channelSort = 'name-asc';
    }
    const sessions = new Map();
    const identityStorage = {read: () => utils__storage_get('identities'), write: value => utils__storage_set('identities', value)};
    const sendLine = line =>
    {
        if (!socket || socket.readyState !== WebSocket.OPEN)
        {
            throw new Error('Not connected. Use Connect to try again.');
        }
        socket.send(line);
    };
    let client = new LemonIrc.Client(sendLine, schedule);
    window.ircClient = client;
    const conversationPicker = LemonIrc.createConversationPicker({make, choose: activate, current: () => current, conversations: () => client.conversations, newChat: nick => newPrivateChat(nick)});
    const treeView = new LemonIrc.Tree(byId('channel-list-container'), treeRow);
    let renderCount = 0;
    const columnCache = new Map();
    /**
     * @brief decides which indicator columns a channel's member rows reserve
     *
     * @param object channel -> channel whose members are listed
     *
     * @return object whether any member shows a role badge or a flag
     */
    function memberColumns(channel)
    {
        const stamp = renderCount + ':' + channel.members.size;
        const cached = columnCache.get(channel);
        if (cached?.stamp === stamp)
        {
            return cached;
        }
        let role = false;
        let flag = false;
        for (const member of channel.members.values())
        {
            role = role || [...client.prefixModes].some(mode => member.modes.includes(mode)) || member.user.fields.has('Operator');
            flag = flag || Boolean(member.user.country || member.user.serverCountry);
            if (role && flag)
            {
                break;
            }
        }
        const result = {stamp, role: role && preferences.roles, flag: flag && preferences.flags};
        columnCache.set(channel, result);
        return result;
    }
    let filterReturnFocus = null;
    let filterReturnScroll = 0;
    const channelFilter = make('div', '', 'irc-channel-filter');
    channelFilter.id = 'irc-channel-filter';
    channelFilter.hidden = true;
    const filterInput = document.createElement('input');
    filterInput.type = 'search';
    filterInput.className = 'text-input-pretty';
    filterInput.placeholder = 'Filter channels';
    filterInput.ariaLabel = 'Filter channels';
    const filterCount = make('output', '');
    filterCount.setAttribute('role', 'status');
    const closeFilter = button('×', () => hideChannelFilter());
    closeFilter.ariaLabel = 'Close channel filter';
    closeFilter.title = 'Close filter (Escape)';
    channelFilter.append(filterInput, closeFilter, filterCount);
    treeView.container.before(channelFilter);
    filterInput.oninput = () =>
    {
        treeView.container.scrollTop = 0;
        renderTree();
    };
    document.addEventListener('keydown', event =>
    {
        if (document.querySelector('dialog[open]') || byId('verification-system').style.display !== 'none' || getComputedStyle(byId('local-settings-container')).display !== 'none')
        {
            return;
        }
        if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'f')
        {
            event.preventDefault();
            if (channelFilter.hidden)
            {
                filterReturnFocus = document.activeElement;
                filterReturnScroll = treeView.container.scrollTop;
            }
            channelFilter.hidden = false;
            byId('space-devider1').classList.add('irc-filter-open');
            if (isMobileTheme())
            {
                g_is_chat_hidden = true;
                applyLayout();
            }
            networkCollapsed = false;
            renderTree();
            filterInput.focus();
            filterInput.select();
        }
        else if (event.key === 'Escape' && !channelFilter.hidden)
        {
            event.preventDefault();
            hideChannelFilter();
        }
    });

    function hideChannelFilter()
    {
        filterInput.value = '';
        channelFilter.hidden = true;
        byId('space-devider1').classList.remove('irc-filter-open');
        renderTree();
        treeView.container.scrollTop = filterReturnScroll;
        (filterReturnFocus?.isConnected ? filterReturnFocus : treeView.container).focus({preventScroll: true});
    }
    function schedule()
    {
        if (!scheduled)
        {
            scheduled = true;
            setTimeout(() =>
            {
                scheduled = false;
                render();
            }, client.listing ? 200 : 0);
        }
    }
    function report(error, record = true, audible = true)
    {
        if (audible)
        {
            playEventSound('error');
        }
        const message = error.message || String(error);
        if (record)
        {
            client.status(message, 'error');
        }
        if (current !== 'network' && errorLocation === 'chat')
        {
            client.message(current, client.conversation(current).name, '', message);
        }
        else if (client.connected && errorLocation === 'chat')
        {
            showLog(true);
        }
        byId('another-buttons-loading-container-p').textContent = message;
        schedule();
    }
    function guard(action)
    {
        try
        {
            action();
        }
        catch (error)
        {
            report(error);
        }
    }
    function activate(id)
    {
        if (current !== id && preferences.typing)
        {
            guard(() => client.sendTyping(current, false));
        }
        client.conversation(current).draft = input.value;
        current = id;
        if (id.startsWith('channel:'))
        {
            lastChannel = id;
        }
        if (isMobileTheme())
        {
            if (id !== 'network' && !channelFilter.hidden)
            {
                hideChannelFilter();
            }
            g_is_chat_hidden = id === 'network';
            applyLayout();
        }
        input.value = client.conversation(id).draft;
        render(isMobileTheme());
    }

    /**
     * @brief checks whether a supported mobile theme is selected
     *
     * @return boolean mobile layout active
     */
    function isMobileTheme()
    {
        return ['default-mobile', 'mobile-2'].includes(document.body.dataset.ircTheme);
    }

    /**
     * @brief applies the selected theme's desktop or mobile layout
     *
     * @return void
     */
    function applyLayout()
    {
        const mobile = isMobileTheme();
        const container = byId('communication-system-container');
        const toolbar = byId('communication-system-head-menu');
        if (mobile && g_layout.edit_active)
        {
            layout__layout_edit_toggle();
        }
        g_layout.grid_active = !mobile;
        document.body.classList.toggle('irc-mobile', mobile);
        document.body.dataset.ircCompact = String(mobile && innerWidth < 768 && !g_is_chat_hidden);
        byId('hide-chat-button').classList.toggle('chat-hidden', g_is_chat_hidden);
        byId('hide-chat-button').setAttribute('aria-pressed', String(g_is_chat_hidden));
        byId('layout-edit-button').style.display = mobile ? 'none' : '';
        treeView.heights.clear();
        if (!mobile)
        {
            container.style.setProperty('display', client.connected ? 'grid' : 'none', client.connected ? '' : 'important');
            layout__layout_apply();
            return;
        }

        // restore theme sizing
        if (toolbar.parentElement === container)
        {
            container.before(toolbar);
        }
        delete toolbar.dataset.layoutToolbar;
        for (const property of ['grid-template-areas', 'grid-template-columns', 'grid-template-rows'])
        {
            container.style.removeProperty(property);
        }
        for (const panel of Object.values(g_layout.panels))
        {
            for (const property of ['grid-area', 'width', 'min-width', 'height', 'left', 'padding-left', 'display'])
            {
                panel.style.removeProperty(property);
            }
        }
        container.style.setProperty('display', client.connected ? 'block' : 'none', client.connected ? '' : 'important');
        document.body.style.setProperty('--irc-toolbar-height', toolbar.offsetHeight + 'px');
        g_layout.panels.chat.style.display = g_is_chat_hidden ? 'none' : '';
        g_layout.panels.input.style.display = g_is_chat_hidden ? 'none' : '';
        if (g_is_chat_hidden)
        {
            g_layout.panels.channels.style.width = '100%';
        }
    }

    /**
     * @brief closes a conversation without leaving its channel
     *
     * @param string id -> conversation identifier
     *
     * @return void
     */
    function closeConversation(id)
    {
        if (id === 'network')
        {
            return;
        }
        if (current === id)
        {
            activate('network');
        }
        client.conversations.delete(id);
        render();
    }
    const sitePreviews = new Map();
    /**
     * @brief fills website preview placeholders in a message with the page's title, summary and picture
     *
     * @param object row -> rendered chat message
     *
     * @return void
     */
    function fillSitePreviews(row)
    {
        for (const holder of row.querySelectorAll('.irc-site-preview[data-preview-url]'))
        {
            const address = holder.dataset.previewUrl;
            delete holder.dataset.previewUrl;
            if (!sitePreviews.has(address))
            {
                sitePreviews.set(address, fetch('/preview?token=' + encodeURIComponent(accessToken()) + '&url=' + encodeURIComponent(address)).then(response => response.ok ? response.json() : {}).catch(() => ({})));
            }
            sitePreviews.get(address).then(preview =>
            {
                if (!preview.title && !preview.description)
                {
                    holder.remove();
                    return;
                }
                const context = holder.closest('.chat-context');
                const stick = context && context.scrollHeight - context.scrollTop - context.clientHeight < 60;
                const card = document.createElement('a');
                card.className = 'chat-link-preview';
                card.href = address;
                card.target = '_blank';
                card.rel = 'noopener noreferrer';
                if (preview.site)
                {
                    card.append(make('span', preview.site, 'chat-link-preview-site_name'));
                }
                if (preview.title)
                {
                    card.append(make('span', preview.title, 'chat-link-preview-title'));
                }
                if (preview.description)
                {
                    card.append(make('span', preview.description, 'chat-link-preview-description'));
                }
                const picture = preview.image && preferences.previews ? LemonIrc.Media.image(preview.image, preview.title || 'Page picture') : null;
                if (picture)
                {
                    card.append(picture);
                }
                holder.replaceChildren(card);
                // a card that arrives late keeps the chat at its end
                if (stick)
                {
                    context.scrollTop = context.scrollHeight;
                    byId('chat-context-container').scrollTop = byId('chat-context-container').scrollHeight;
                }
            });
        }
    }

    /**
     * @brief updates typing names and removes expired notices
     *
     * @return void
     */
    function renderTyping()
    {
        clearTimeout(typingTimer);
        const active = [];
        const now = Date.now();
        const conversation = client.conversations.get(current);
        for (const [id, entry] of conversation?.typing || [])
        {
            if (!client.connected || !client.enabled.has('message-tags') || entry.expires <= now)
            {
                conversation.typing.delete(id);
            }
            else
            {
                active.push(entry);
            }
        }
        const indicator = byId('typing-indicator-container');
        const names = active.map(entry => entry.user.nick);
        const text = names.length === 1 ? names[0] + ' is typing' : names.length === 2 ? names[0] + ' and ' + names[1] + ' are typing' : names.length > 2 ? names[0] + ', ' + names[1] + ' and ' + (names.length - 2) + (names.length === 3 ? ' other' : ' others') + ' are typing' : '';
        // the copied pill with three animated dots
        if (indicator.dataset.text !== text)
        {
            indicator.dataset.text = text;
            indicator.replaceChildren();
            if (text)
            {
                const line = make('div', '', 'typing-indicator-line');
                const dots = make('span', '', 'typing-indicator-dots');
                dots.append(make('span', '.'), make('span', '.'), make('span', '.'));
                line.append(make('span', text), dots);
                indicator.append(line);
            }
        }
        indicator.style.display = active.length ? 'block' : 'none';
        if (active.length)
        {
            typingTimer = setTimeout(renderTyping, Math.min(...active.map(entry => entry.expires)) - now + 20);
        }
    }

    /**
     * @brief collects profile fields supplied by the server
     *
     * @param object user -> known user
     *
     * @return Map profile labels and values
     */
    function userDetails(user)
    {
        const fields = new Map([['Nickname', user.nick], ...user.fields]);
        fields.set('Network', client.network);
        if (client.fold(user.nick) === client.fold(client.nick))
        {
            fields.set('Joined channels', [...client.channels.values()].filter(channel => channel.joined).map(channel => channel.name).join(', ') || 'None');
        }
        for (const [key, value] of user.metadata)
        {
            if (key !== 'avatar')
            {
                fields.set({'display-name': 'Display name', bot: 'Bot', status: 'Status', homepage: 'Website'}[key] || key, value);
            }
        }
        return fields;
    }

    /**
     * @brief names a channel membership mode
     *
     * @param string mode -> mode letter
     *
     * @return string role label
     */
    function roleName(mode)
    {
        return {q: 'Channel owner', a: 'Channel admin', o: 'Channel operator', h: 'Half operator', v: 'Voice (moderated text)'}[mode] || 'Channel mode ' + mode;
    }

    // role icons: Tabler Icons filled set, MIT licence, see vendor/tabler-icons/LICENSE
    const roleShapes =
    {
        owner: 'M19 19h-14c-.5 0 -.9 -.3 -1 -.8l-2 -10c0 -.4 .1 -.8 .5 -1.1c.4 -.2 .8 -.2 1.1 0l4.1 3.3l3.4 -5.1c.4 -.6 1.3 -.6 1.7 0l3.4 5.1l4.1 -3.3c.3 -.3 .8 -.3 1.1 0c.4 .2 .5 .6 .5 1.1l-2 10c0 .5 -.5 .8 -1 .8z',
        admin: 'M11.998 2l.118 .007l.059 .008l.061 .013l.111 .034a.993 .993 0 0 1 .217 .112l.104 .082l.255 .218a11 11 0 0 0 7.189 2.537l.342 -.01a1 1 0 0 1 1.005 .717a13 13 0 0 1 -9.208 16.25a1 1 0 0 1 -.502 0a13 13 0 0 1 -9.209 -16.25a1 1 0 0 1 1.005 -.717a11 11 0 0 0 7.531 -2.527l.263 -.225l.096 -.075a.993 .993 0 0 1 .217 -.112l.112 -.034a.97 .97 0 0 1 .119 -.021l.115 -.007zm3.71 7.293a1 1 0 0 0 -1.415 0l-3.293 3.292l-1.293 -1.292l-.094 -.083a1 1 0 0 0 -1.32 1.497l2 2l.094 .083a1 1 0 0 0 1.32 -.083l4 -4l.083 -.094a1 1 0 0 0 -.083 -1.32z',
        operator: 'M11.884 2.007l.114 -.007l.118 .007l.059 .008l.061 .013l.111 .034a.993 .993 0 0 1 .217 .112l.104 .082l.255 .218a11 11 0 0 0 7.189 2.537l.342 -.01a1 1 0 0 1 1.005 .717a13 13 0 0 1 -9.208 16.25a1 1 0 0 1 -.502 0a13 13 0 0 1 -9.209 -16.25a1 1 0 0 1 1.005 -.717a11 11 0 0 0 7.531 -2.527l.263 -.225l.096 -.075a.993 .993 0 0 1 .217 -.112l.112 -.034a.97 .97 0 0 1 .119 -.021z',
        halfop: 'M11.998 2l.032 .002l.086 .005a1 1 0 0 1 .342 .104l.105 .062l.097 .076l.016 .015l.247 .21a11 11 0 0 0 7.189 2.537l.342 -.01a1 1 0 0 1 1.005 .717a13 13 0 0 1 -9.208 16.25a1 1 0 0 1 -.502 0a13 13 0 0 1 -9.209 -16.25a1 1 0 0 1 1.005 -.717a11 11 0 0 0 7.791 -2.75l.046 -.036l.053 -.041a1 1 0 0 1 .217 -.112l.075 -.023l.036 -.01a1 1 0 0 1 .12 -.022l.086 -.005zm.002 2.296l-.176 .135a13 13 0 0 1 -7.288 2.572l-.264 .006l-.064 .31a11 11 0 0 0 1.064 7.175l.17 .314a11 11 0 0 0 6.49 5.136l.068 .019z',
        voice: 'M19 9a1 1 0 0 1 1 1a8 8 0 0 1 -6.999 7.938l-.001 2.062h3a1 1 0 0 1 0 2h-8a1 1 0 0 1 0 -2h3v-2.062a8 8 0 0 1 -7 -7.938a1 1 0 1 1 2 0a6 6 0 0 0 12 0a1 1 0 0 1 1 -1m-7 -8a4 4 0 0 1 4 4v5a4 4 0 1 1 -8 0v-5a4 4 0 0 1 4 -4',
        network: 'M13 2l.018 .001l.016 .001l.083 .005l.011 .002h.011l.038 .009l.052 .008l.016 .006l.011 .001l.029 .011l.052 .014l.019 .009l.015 .004l.028 .014l.04 .017l.021 .012l.022 .01l.023 .015l.031 .017l.034 .024l.018 .011l.013 .012l.024 .017l.038 .034l.022 .017l.008 .01l.014 .012l.036 .041l.026 .027l.006 .009c.12 .147 .196 .322 .218 .513l.001 .012l.002 .041l.004 .064v6h5a1 1 0 0 1 .868 1.497l-.06 .091l-8 11c-.568 .783 -1.808 .38 -1.808 -.588v-6h-5a1 1 0 0 1 -.868 -1.497l.06 -.091l8 -11l.01 -.013l.018 -.024l.033 -.038l.018 -.022l.009 -.008l.013 -.014l.04 -.036l.028 -.026l.008 -.006a1 1 0 0 1 .402 -.199l.011 -.001l.027 -.005l.074 -.013l.011 -.001l.041 -.002z'
    };

    /**
     * @brief creates the role icon for a member
     *
     * @param object member -> user and channel modes
     *
     * @return DocumentFragment role icon, empty without a role
     */
    function roleIcons(member)
    {
        const icons = document.createDocumentFragment();
        const modes = [...client.prefixModes].filter(mode => member.modes.includes(mode));
        const operator = member.user.fields.has('Operator');
        // the column holds one icon: the highest channel role, otherwise the network operator mark
        const mode = modes[0] || (operator ? 'network' : '');
        if (!mode)
        {
            return icons;
        }
        const kind = {q: 'owner', a: 'admin', o: 'operator', h: 'halfop', v: 'voice', network: 'network'}[mode] || 'operator';
        const labels = modes.map(entry => roleName(entry) + ' (' + client.prefixSymbols[client.prefixModes.indexOf(entry)] + ')');
        if (operator)
        {
            labels.push('IRC network operator');
        }
        const badge = make('span', '', 'single-group channel-group-icon irc-role irc-role-' + kind);
        badge.title = labels.join('\n');
        badge.setAttribute('role', 'img');
        badge.setAttribute('aria-label', labels.join(', '));
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('aria-hidden', 'true');
        const shape = document.createElementNS(svg.namespaceURI, 'path');
        shape.setAttribute('d', roleShapes[kind]);
        svg.append(shape);
        badge.append(svg);
        icons.append(badge);
        return icons;
    }

    /**
     * @brief opens a private chat and refreshes its profile
     *
     * @param object user -> selected user
     *
     * @return void
     */
    function showUser(user)
    {
        activate(client.private(user).id);
        if (client.connected && Date.now() - (user.queriedAt || 0) > 30000)
        {
            user.queriedAt = Date.now();
            guard(() => client.requestUserInfo(user.nick));
        }
    }
    /**
     * @brief omits the first hash from the displayed channel name
     *
     * @param string name -> full channel name
     *
     * @return string visible label
     */
    function channelLabel(name)
    {
        return name.startsWith('#') ? name.slice(1) : name;
    }
    /**
     * @brief shows or hides the original log panel
     *
     * @param boolean visible -> requested visibility
     *
     * @return void
     */
    function showLog(visible)
    {
        logPanel.style.display = visible ? 'block' : 'none';
        logButton.setAttribute('aria-expanded', String(visible));
        if (visible)
        {
            logButton.style.display = '';
            renderLog();
        }
    }
    /**
     * @brief updates log entries while preserving scroll position
     *
     * @return void
     */
    function renderLog()
    {
        if (logPanel.style.display === 'none')
        {
            return;
        }
        const atBottom = logPanel.scrollHeight - logPanel.scrollTop - logPanel.clientHeight < 32;
        const scrollTop = logPanel.scrollTop;
        const labels = {join: 'Join', leave: 'Leave', nickname: 'Nickname', topic: 'Topic', moderation: 'Moderation', connection: 'Connection', operator: 'Operator', warning: 'Warning', error: 'Error', notice: 'Notice', info: 'Info'};
        logPanel.replaceChildren(...client.conversation('network').messages.map(message =>
        {
            const kind = labels[message.kind] ? message.kind : 'info';
            const row = make('div', new Date(message.time).toLocaleTimeString() + ' [' + labels[kind] + '] ' + message.text, 'log-line irc-log-' + kind);
            return row;
        }));
        logPanel.scrollTop = atBottom ? logPanel.scrollHeight : scrollTop;
    }
    function selectTheme(name)
    {
        for (const sheet of document.querySelectorAll('.style-theme-html-element'))
        {
            sheet.setAttribute('media', '(max-width: 1px)');
        }
        byId('style-theme-' + name).removeAttribute('media');
        document.body.dataset.ircTheme = name;
        byId('choose-theme-button-list').style.display = 'none';
        if (isMobileTheme() && current === 'network')
        {
            g_is_chat_hidden = true;
        }
        applyLayout();
        fitToolbar();
        fitConnectionWindow(true);
        schedule();
        try
        {
            localStorage.setItem('lemon-irc-theme', name);
        }
        catch (error)
        {
            report(error);
        }
    }
    /**
     * @brief separates overlapping toolbar controls in the copied themes
     *
     * @return void
     */
    function fitToolbar()
    {
        const toolbar = byId('communication-system-head-menu');
        logPanel.style.top = document.body.dataset.ircTheme === 'termix' ? '' : Math.max(0, toolbar.getBoundingClientRect().bottom) + 'px';
        const optional = ['microphone-always-broadcasting-audio-button', 'hide-show-flags-button', 'sound-effects-button', 'irc-network-browser-button'];
        const buttons = [...toolbar.querySelectorAll(':scope > input[type="button"]')];
        const transitions = new Map(buttons.map(node => [node, node.style.transition]));
        for (const node of buttons)
        {
            node.style.transition = 'none';
        }
        for (const id of optional)
        {
            byId(id).style.right = '';
        }
        for (const id of optional)
        {
            const node = byId(id);
            if (getComputedStyle(node).position !== 'absolute')
            {
                continue;
            }
            const rect = node.getBoundingClientRect();
            const others = buttons.filter(other => other !== node).map(other => other.getBoundingClientRect()).filter(box => box.width > 0);
            if (others.some(box => box.left < rect.right && box.right > rect.left))
            {
                node.style.right = (toolbar.getBoundingClientRect().right - Math.min(...others.map(box => box.left)) + 3) + 'px';
            }
        }
        for (const [node, transition] of transitions)
        {
            node.getBoundingClientRect();
            node.style.transition = transition;
        }
    }
    function dialog(title)
    {
        const panel = document.createElement('dialog');
        panel.className = 'irc-dialog';
        const heading = make('div', '', 'irc-dialog-heading');
        // the themes' close button, the same one the connection window uses
        const close = make('div', '', 'close-button irc-dialog-close');
        close.setAttribute('role', 'button');
        close.setAttribute('aria-label', 'Close');
        close.title = 'close';
        close.tabIndex = 0;
        close.onclick = () => panel.close();
        close.onkeydown = event =>
        {
            if (event.key === 'Enter' || event.key === ' ')
            {
                event.preventDefault();
                panel.close();
            }
        };
        heading.append(make('p', title), close);
        panel.append(heading);
        panel.addEventListener('close', () => panel.remove());
        document.body.append(panel);
        panel.showModal();
        return panel;
    }
    /**
     * @brief reads the bridge access key from the page, or from an older #token address
     *
     * @return string access key
     */
    function accessToken()
    {
        return location.hash.slice(1) || document.querySelector('meta[name="lemon-irc-token"]')?.content || '';
    }
    async function loadNetworks(fresh = false)
    {
        if (networkList && !fresh)
        {
            return networkList;
        }
        try
        {
            const response = await fetch('/networks?token=' + encodeURIComponent(accessToken()));
            if (!response.ok)
            {
                throw new Error('server list request refused');
            }
            const catalog = await response.json();
            networkList = catalog.networks;
            if (!networkList.some(network => network.id === selectedNetwork))
            {
                selectedNetwork = '';
            }
            selectedNetwork = selectedNetwork || catalog.defaultId;
        }
        catch (error)
        {
            // the list built into the page still lets the user pick a server
            networkList = window.LemonIrcNetworks?.networks || [];
            selectedNetwork = selectedNetwork || networkList.find(network => network.id === 'libera')?.id || networkList[0]?.id;
        }
        return networkList;
    }
    /**
     * @brief shows the server list; choosing a server connects to it
     *
     * @return Promise<void> list shown
     */
    async function networkBrowser()
    {
        const panel = dialog('IRC servers');
        panel.id = 'irc-network-browser';
        const results = make('div', '', 'irc-network-results');
        panel.append(results);
        const networks = await loadNetworks(true);
        if (!panel.isConnected)
        {
            return;
        }
        for (const network of networks)
        {
            const row = document.createElement('button');
            row.type = 'button';
            row.className = 'irc-network-row' + (network.id === selectedNetwork ? ' irc-network-current' : '');
            row.setAttribute('aria-label', 'Choose ' + network.name);
            row.title = [network.description, network.sources?.length ? 'listed by ' + network.sources.join(', ') : ''].filter(Boolean).join('\n');
            const host = network.ready === false ? 'server found when chosen' : network.host + (network.tls ? '' : ' · unencrypted');
            const detail = make('span', (network.users ? network.users.toLocaleString() + ' users · ' : '') + host, 'irc-network-host');
            row.append(make('span', network.name, 'irc-network-name'), detail);
            row.onclick = async () =>
            {
                // networks from the public lists get a working server picked by the bridge first
                if (network.ready === false)
                {
                    if (row.disabled)
                    {
                        return;
                    }
                    row.disabled = true;
                    detail.textContent = 'testing servers…';
                    try
                    {
                        const found = await fetch('/resolve?token=' + encodeURIComponent(accessToken()) + '&id=' + encodeURIComponent(network.id)).then(response => response.json());
                        if (found.error)
                        {
                            throw new Error(found.error);
                        }
                        Object.assign(network, found);
                    }
                    catch (error)
                    {
                        detail.textContent = error.message || 'no server answered';
                        row.classList.add('irc-network-failed');
                        row.disabled = false;
                        return;
                    }
                }
                if (selectedNetwork !== network.id)
                {
                    byId('irc-account').value = '';
                    byId('irc-password').value = '';
                }
                selectedNetwork = network.id;
                panel.close();
                connect();
            };
            results.append(row);
        }
        results.querySelector('.irc-network-current, .irc-network-row')?.focus({preventScroll: false});
    }
    /**
     * @brief keeps the connection window inside the viewport
     *
     * @param boolean center -> center the window instead of keeping its position
     *
     * @return void
     */
    function fitConnectionWindow(center = false)
    {
        const box = byId('container-2');
        if (byId('verification-system').style.display === 'none' || !box.offsetWidth)
        {
            return;
        }
        const rect = box.getBoundingClientRect();
        const left = center ? (innerWidth - rect.width) / 2 : rect.left;
        const top = center ? (innerHeight - rect.height) / 2 : rect.top;
        box.style.left = Math.max(8, Math.min(left, innerWidth - rect.width - 8)) + 'px';
        box.style.top = Math.max(8, Math.min(top, innerHeight - rect.height - 8)) + 'px';
    }

    /**
     * @brief shows the chat only after irc registration succeeds
     *
     * @return void
     */
    function showConnectionState()
    {
        document.body.classList.toggle('irc-disconnected', !client.connected);
        byId('verification-system').style.visibility = 'visible';
        byId('verification-system').style.display = client.connected ? 'none' : 'block';
        byId('connect-window-close-button').style.display = '';
        if (client.connected)
        {
            connectFormRevision++;
        }
        else
        {
            document.title = 'Lemon IRC';
            showLog(false);
            clearTimeout(activityTimer);
        }
        applyLayout();
        fitToolbar();
        fitConnectionWindow(true);
    }

    /**
     * @brief starts moving the connection window by its title bar
     *
     * @param PointerEvent event -> pointer press
     *
     * @return void
     */
    function startConnectionDrag(event)
    {
        if (event.button !== 0 || event.target.closest('.close-button'))
        {
            return;
        }
        const rect = byId('container-2').getBoundingClientRect();
        connectDrag = {id: event.pointerId, x: event.clientX - rect.left, y: event.clientY - rect.top};
        event.currentTarget.setPointerCapture(event.pointerId);
        event.preventDefault();
    }

    /**
     * @brief moves the connection window with its captured pointer
     *
     * @param PointerEvent event -> pointer movement
     *
     * @return void
     */
    function moveConnectionDrag(event)
    {
        if (!connectDrag || event.pointerId !== connectDrag.id)
        {
            return;
        }
        const box = byId('container-2');
        box.style.left = event.clientX - connectDrag.x + 'px';
        box.style.top = event.clientY - connectDrag.y + 'px';
        fitConnectionWindow();
    }

    /**
     * @brief releases the connection window after dragging
     *
     * @param PointerEvent event -> pointer release or cancellation
     *
     * @return void
     */
    function stopConnectionDrag(event)
    {
        if (!connectDrag || event.pointerId !== connectDrag.id)
        {
            return;
        }
        connectDrag = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId))
        {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }
    }

    /**
     * @brief opens connection details and loads the selected server
     *
     * @return Promise<void> form ready or error shown
     */
    async function connect()
    {
        const revision = ++connectFormRevision;
        const panel = byId('verification-system');
        panel.style.display = 'block';
        panel.style.visibility = 'visible';
        byId('connect-button').disabled = true;
        byId('another-buttons-loading-container-p').textContent = 'Loading servers…';
        fitConnectionWindow(true);
        try
        {
            await loadNetworks();
        }
        catch (error)
        {
            if (revision === connectFormRevision)
            {
                report(error);
            }
            return;
        }
        if (revision !== connectFormRevision)
        {
            return;
        }
        byId('connect-button').disabled = false;
        const nickname = byId('irc-nickname');
        const account = byId('irc-account');
        const password = byId('irc-password');
        const network = networkList.find(entry => entry.id === selectedNetwork);
        byId('input-ip-address').value = network.host;
        byId('input-port-number').value = network.port;
        byId('connect-server-section').querySelector('legend').textContent = network.name;
        nickname.value = utils__storage_get('preferred_nickname') || 'Lemon' + Math.floor(Math.random() * 100000);
        const profiles = LemonIrc.Identities.list(identityStorage, network);
        identitySelector.replaceChildren();
        identitySelector.append(new Option('Guest · nickname only', ''));
        for (const profile of profiles.filter(profile => profile.account))
        {
            identitySelector.append(new Option(profile.nick + ' · ' + profile.account, profile.account));
        }
        identitySelector.append(new Option('Another account…', '*new*'));
        identitySelector.value = profiles.find(profile => profile.selected)?.account || '';
        const selectIdentity = () =>
        {
            const profile = profiles.find(entry => entry.account === identitySelector.value);
            account.value = profile?.account || '';
            password.value = '';
            if (profile)
            {
                nickname.value = profile.nick;
            }
            const registered = identitySelector.value !== '';
            byId('connect-show-advanced').checked = registered;
            credentials.hidden = !registered;
            forgetIdentity.disabled = !profile?.account;
        };
        identitySelector.onchange = selectIdentity;
        forgetIdentity.onclick = () =>
        {
            LemonIrc.Identities.forget(identityStorage, network, identitySelector.value);
            connect();
        };
        selectIdentity();
        const errorText = byId('another-buttons-loading-container-p');
        errorText.role = 'alert';
        errorText.textContent = 'Your preferred nickname is remembered. If it is taken, an available variation is used';
        byId('connect-button').onclick = () =>
        {
            const token = accessToken();
            if (!/^[a-f0-9]{64}$/.test(token))
            {
                errorText.textContent = 'Open the complete address printed by start.bat or start.sh, including the part after #.';
                playEventSound('error');
                return;
            }
            const check = new LemonIrc.Client(() =>
            {
            });
            try
            {
                check.register(nickname.value.trim(), account.value.trim(), password.value);
            }
            catch (error)
            {
                errorText.textContent = error.message;
                playEventSound('error');
                return;
            }
            const old = socket;
            socket = null;
            old?.close();
            client.connected = false;
            client.listing = false;
            client.pendingDirectory = null;
            client.password = '';
            client.conversation(current).draft = input.value;
            for (const channel of client.channels.values())
            {
                channel.joined = false;
                channel.members.clear();
                channel.names = null;
            }
            if (activeNetwork && activeNetwork !== network.id)
            {
                sessions.set(activeNetwork, client);
                client = sessions.get(network.id) || new LemonIrc.Client(sendLine, schedule);
                window.ircClient = client;
                current = 'network';
                input.value = client.conversation(current).draft;
            }
            activeNetwork = network.id;
            client.ignoredNicks = loadIgnored(network.id);
            renderIgnoredList();
            networkCollapsed = false;
            client.network = network.name;
            client.capabilities = [];
            client.listing = false;
            client.pendingDirectory = null;
            for (const channel of client.channels.values())
            {
                channel.joined = false;
                channel.members.clear();
                channel.names = null;
            }
            const loginNickname = nickname.value.trim();
            utils__storage_set('preferred_nickname', loginNickname);
            const loginAccount = account.value.trim();
            LemonIrc.Identities.remember(identityStorage, network, loginNickname, loginAccount);
            let loginPassword = password.value;
            let connectionError = '';
            password.value = '';
            const next = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/irc?token=' + token + '&network=' + encodeURIComponent(network.id), 'text.ircv3.net');
            socket = next;
            disconnectedByUser = false;
            next.onopen = () =>
            {
                if (socket === next)
                {
                    guard(() => client.register(loginNickname, loginAccount, loginPassword));
                }
                loginPassword = '';
            };
            next.onmessage = event =>
            {
                if (socket === next)
                {
                    try
                    {
                        receive(event.data);
                    }
                    catch (error)
                    {
                        if (!client.connected)
                        {
                            connectionError = error.message;
                            next.close();
                        }
                        report(error);
                    }
                }
            };
            next.onerror = () =>
            {
                if (socket === next)
                {
                    connectionError = 'The bridge connection failed. Check that it is running.';
                    report(new Error(connectionError));
                }
            };
            next.onclose = event =>
            {
                loginPassword = '';
                if (socket === next)
                {
                    client.connected = false;
                    client.listing = false;
                    client.pendingDirectory = null;
                    playEventSound(disconnectedByUser ? 'disconnected' : 'connection_lost');
                    client.password = '';
                    for (const channel of client.channels.values())
                    {
                        channel.joined = false;
                        channel.members.clear();
                        channel.names = null;
                        channel.membersUpdated = 0;
                    }
                    for (const dialog of document.querySelectorAll('dialog[open]'))
                    {
                        dialog.close();
                    }
                    showConnectionState();
                    report(new Error(connectionError || event.reason || (disconnectedByUser ? 'Disconnected. Choose Connect to reconnect.' : 'Connection lost. Choose Connect to reconnect.')), true, false);
                }
            };
            showConnectionState();
            errorText.textContent = 'Connecting to ' + network.name + '…';
            client.status(errorText.textContent);
            schedule();
        };
        nickname.focus();
        fitConnectionWindow(true);
    }
    /**
     * @brief handles server replies and plays the matching sound
     *
     * @param string line -> received irc line
     *
     * @return void
     */
    function receive(line)
    {
        client.eventLocation = eventLocation;
        const packet = LemonIrc.parse(line);
        const wasConnected = client.connected;
        const own = packet && client.fold(packet.nick) === client.fold(client.nick);
        const backgroundLookup = packet && client.userQueries.get(client.fold(packet.params[1] || ''))?.background;
        const sharedUser = packet && [...client.channels.values()].some(channel => [...channel.members.values()].some(member => client.fold(member.user.nick) === client.fold(packet.nick)));
        const nicknameRetried = client.receive(line) === true;
        if (!packet)
        {
            return;
        }
        if (['PRIVMSG', 'NOTICE', 'TAGMSG'].includes(packet.command) && packet.prefix.includes('!') && client.isIgnored(packet.nick))
        {
            return;
        }
        const listRefused = packet.command === '263' && (packet.params.length === 2 || packet.params[1]?.toUpperCase() === 'LIST');
        if (packet.command === '263')
        {
            nextConnectionTimeRequest = Date.now() + 60000;
        }
        const lookupMissing = packet.command === '401' && byId('irc-new-private-chat')?.open;
        if (lookupMissing && !backgroundLookup)
        {
            playEventSound('error');
        }
        if (!nicknameRetried && !lookupMissing && (/^[45]\d{2}$/.test(packet.command) || ['ERROR', 'FAIL', '696', '723'].includes(packet.command) || listRefused))
        {
            report(new Error((['ERROR', 'FAIL'].includes(packet.command) ? packet.params : packet.params.slice(1)).join(' ')), false, packet.command !== '422' && !backgroundLookup);
            const channel = client.channels.get(client.fold(packet.params[1] || ''));
            if (channel)
            {
                channel.names = null;
            }
            if (packet.command === '475')
            {
                const name = packet.params[1];
                textDialog('Channel password · ' + name, 'Password', '', key => join(name, key), 'password');
            }
        }
        if (!wasConnected && client.connected)
        {
            showConnectionState();
            playEventSound('connected');
            client.requestDirectory();
            return;
        }
        if (!client.connected)
        {
            return;
        }
        switch (packet.command)
        {
            case 'PRIVMSG':
            case 'NOTICE':
                if (!own && !packet.tags.batch && packet.prefix.includes('!') && (!packet.params[1]?.startsWith('\x01') || packet.params[1].startsWith('\x01ACTION ')))
                {
                    playEventSound(client.channelTypes.includes(packet.params[0][0]) ? 'incoming_channel' : 'incoming_private');
                }
                break;
            case 'JOIN':
                playEventSound(own ? 'channel_switched' : 'user_entered_your_channel');
                if (own)
                {
                    const joined = client.channel(packet.params[0]);
                    treeView.container.scrollTop = 0;
                    activate(joined.id);
                }
                break;
            case 'PART':
                if (!own)
                {
                    playEventSound('user_left_your_channel');
                }
                break;
            case 'QUIT':
                if (sharedUser && !own)
                {
                    playEventSound('user_disconnected_from_your_channel');
                }
                break;
            case 'TOPIC':
                playEventSound('channel_edited');
                break;
            case 'KICK':
                playEventSound('user_was_kicked_out_of_your_channel');
                break;
        }
    }
    function join(name, key = '')
    {
        if (name && !client.channelTypes.includes(name[0]))
        {
            name = '#' + name;
        }
        if (!name || !client.channelTypes.includes(name[0]) || /[\s,\x00-\x1f:]/.test(name) || new TextEncoder().encode(name).length > 200)
        {
            throw new Error('Enter a channel name such as #lemon-test.');
        }
        if (/\s|,|\0/.test(key))
        {
            throw new Error('The channel password cannot contain spaces or commas');
        }
        if (!client.connected)
        {
            throw new Error('Connect to a server first');
        }
        client.write('JOIN ' + name + (key ? ' ' + key : ''));
    }
    function openChannel(name)
    {
        const channel = client.channel(name);
        client.conversation(channel.id, channel.name);
        activate(channel.id);
    }

    function createChannel()
    {
        textDialog('Create channel', 'Channel name', '#', name => join(name));
    }
    function runCommand(text)
    {
        guard(() =>
        {
            if (!text)
            {
                return;
            }
            if (text.startsWith('/'))
            {
                const [command, ...args] = text.slice(1).split(' ');
                const rest = args.join(' ');
                switch (command.toLowerCase())
                {
                    case 'join': join(rest); break;
                    case 'list': client.requestDirectory(); break;
                    case 'part': client.write('PART ' + (args[0] || client.conversation(current).name)); break;
                    case 'nick': client.write('NICK ' + rest); break;
                    case 'whois': client.write('WHOIS ' + rest); break;
                    case 'me': client.say(current, rest, true); break;
                    case 'msg':
                    {
                        if (!args[0] || !args.slice(1).join(' '))
                        {
                            throw new Error('Use /msg nickname message');
                        }
                        const conversation = client.private(client.user(args[0]));
                        client.say(conversation.id, args.slice(1).join(' '));
                        activate(conversation.id);
                        break;
                    }
                    case 'query': activate(client.private(client.user(rest)).id); break;
                    case 'quote': client.write(rest); break;
                    case 'quit': client.write('QUIT :Leaving'); break;
                    default: throw new Error('Commands: /join /list /part /nick /msg /query /whois /me /quote /quit');
                }
            }
            else
            {
                client.write(text);
            }
            schedule();
        });
    }
    function send()
    {
        guard(() =>
        {
            const text = input.value.trim();
            if (!text)
            {
                return;
            }
            client.say(current, text);
            playEventSound('message_sent');
            input.value = '';
            client.conversation(current).draft = '';
            schedule();
        });
    }
    function textDialog(title, label, value, action, type = 'text')
    {
        const panel = dialog(title);
        const field = document.createElement('input');
        field.type = type;
        field.className = 'text-input-pretty';
        field.ariaLabel = label;
        field.value = value;
        const message = make('p', '');
        message.role = 'status';
        const submit = () =>
        {
            try
            {
                action(field.value.trim());
                panel.close();
            }
            catch (error)
            {
                message.textContent = error.message;
                playEventSound('error');
            }
        };
        const caption = make('label', label);
        caption.append(field);
        panel.append(caption, message, button('Confirm', submit), button('Cancel', () => panel.close()));
        field.onkeydown = event =>
        {
            if (event.key === 'Enter')
            {
                submit();
            }
        };
        field.focus();
        field.select();
    }
    function changeNickname()
    {
        textDialog('Set nickname', 'Nickname', client.nick, nickname =>
        {
            if (!/^[A-Za-z_\[\]\\^{}|`][A-Za-z0-9_\[\]\\^{}|`-]*$/.test(nickname))
            {
                throw new Error('Enter an IRC nickname without spaces');
            }
            client.write('NICK ' + nickname);
        });
    }
    function userInformation(nickname)
    {
        const owner = client;
        const info = owner.requestUserInfo(nickname);
        const panel = dialog('User information · ' + nickname);
        panel.id = 'irc-user-information';
        const details = make('dl', '', 'irc-user-details');
        const status = make('p', 'Loading user information…');
        status.role = 'status';
        panel.append(details, status);
        const started = Date.now();
        const update = () =>
        {
            details.replaceChildren();
            for (const [label, value] of userDetails(owner.user(nickname)))
            {
                details.append(make('dt', label), make('dd', value));
            }
            status.textContent = info.error || (info.complete ? 'Information provided by the server' : (!owner.connected ? 'Connection closed' : (Date.now() - started >= 30000 ? 'The server has not finished replying' : 'Loading user information…')));
        };
        const timer = setInterval(update, 250);
        panel.addEventListener('close', () => clearInterval(timer));
        update();
    }

    /**
     * @brief finds a nickname and opens its private conversation once the server confirms it
     *
     * @param string prefill -> nickname to look up immediately
     *
     * @return void
     */
    function newPrivateChat(prefill = '')
    {
        if (!client.connected)
        {
            connect();
            return;
        }
        const owner = client;
        const panel = dialog('New private chat');
        panel.id = 'irc-new-private-chat';
        const field = document.createElement('input');
        field.className = 'text-input-pretty';
        field.type = 'search';
        field.autocomplete = 'off';
        field.placeholder = 'Enter a nickname';
        const caption = make('label', 'Nickname');
        caption.append(field);
        const suggestions = make('div', '', 'irc-user-suggestions');
        const status = make('p', '');
        status.setAttribute('role', 'status');
        const details = make('dl', '', 'irc-user-details');
        let timer;
        const find = button('Open chat', () =>
        {
            clearInterval(timer);
            details.replaceChildren();
            const nick = field.value.trim();
            if (!nick || /[\s,:*?\x00-\x1f\x7f]/.test(nick) || owner.channelTypes.includes(nick[0]))
            {
                status.textContent = 'Enter one nickname, without spaces or a channel prefix';
                return;
            }
            if (owner.fold(nick) === owner.fold(owner.nick))
            {
                status.textContent = 'That is your nickname. Enter the person you want to chat with';
                return;
            }
            try
            {
                const info = owner.requestUserInfo(nick);
                find.disabled = true;
                status.textContent = 'Looking for ' + nick + ' on ' + owner.network + '…';
                const update = () =>
                {
                    if (owner !== client || !owner.connected)
                    {
                        status.textContent = 'Connection closed. Reconnect to look for this person';
                    }
                    else if (info.complete)
                    {
                        if (info.errorCode === '401')
                        {
                            status.textContent = 'No user named ' + nick + ' is online on ' + owner.network + '. Check the spelling or try again later';
                        }
                        else if (info.error || !info.found)
                        {
                            status.textContent = info.error || 'The server did not confirm this nickname. Try again';
                        }
                        else
                        {
                            // the server confirmed the nickname, so the chat opens directly
                            const found = owner.user(info.nick);
                            found.queriedAt = Date.now();
                            clearInterval(timer);
                            panel.close();
                            activate(owner.private(found).id);
                            return;
                        }
                    }
                    else if (Date.now() - info.started >= 30000)
                    {
                        status.textContent = 'The server has not replied. Try again';
                        playEventSound('error');
                    }
                    else
                    {
                        return;
                    }
                    clearInterval(timer);
                    find.disabled = false;
                };
                timer = setInterval(update, 250);
                update();
            }
            catch (error)
            {
                find.disabled = false;
                status.textContent = error.message;
                playEventSound('error');
            }
        });
        field.oninput = () =>
        {
            clearInterval(timer);
            find.disabled = false;
            details.replaceChildren();
            status.textContent = '';
            suggestions.replaceChildren();
            const query = owner.fold(field.value.trim());
            if (!query)
            {
                return;
            }
            const matches = [...owner.users.values()].filter(user => user.nick !== owner.nick && !user.ignored && owner.fold(user.nick).includes(query)).slice(0, 8);
            if (matches.length)
            {
                suggestions.append(make('p', 'Known nicknames'));
                for (const user of matches)
                {
                    suggestions.append(button(user.nick, () =>
                    {
                        field.value = user.nick;
                        suggestions.replaceChildren();
                        find.click();
                    }));
                }
            }
        };
        field.onkeydown = event =>
        {
            if (event.key === 'Enter')
            {
                event.preventDefault();
                find.click();
            }
        };
        panel.append(make('p', 'Enter an exact nickname on ' + owner.network + '. If that person is online, the private chat opens. You do not need to share a channel.'), caption, suggestions, details, status, find, button('Cancel', () => panel.close()));
        panel.addEventListener('close', () => clearInterval(timer));
        field.focus();
        if (prefill)
        {
            field.value = prefill;
            find.click();
        }
    }
    function commandPrompt()
    {
        const panel = dialog('IRC command window');
        panel.id = 'irc-command-window';
        const field = document.createElement('input');
        field.className = 'text-input-pretty';
        field.ariaLabel = 'IRC command';
        const output = make('pre', '', 'irc-command-output');
        const update = () => output.textContent = client.conversation('network').messages.slice(-30).map(message => message.text).join('\n');
        panel.append(make('p', 'Advanced commands. Normal messages belong in the chat box.'), output, field, button('Run', () =>
        {
            runCommand(field.value.trim());
            update();
        }));
        const timer = setInterval(update, 1000);
        panel.addEventListener('close', () => clearInterval(timer));
        update();
        field.focus();
    }

    /**
     * @brief uploads a file to the advertised host and adds its link to the draft
     *
     * @param File file -> selected attachment
     *
     * @return Promise<void> upload dialog opened
     */
    async function uploadFile(file)
    {
        const owner = client;
        const context = current;
        const destination = owner.conversations.get(context);
        const endpoint = owner.isupport.get('draft/FILEHOST') || owner.isupport.get('soju.im/FILEHOST');
        if (!file || !owner.connected || !destination || context === 'network')
        {
            throw new Error('Open a channel or private chat before attaching a file.');
        }
        if (context.startsWith('channel:') && !owner.channels.get(owner.fold(destination.name))?.joined)
        {
            throw new Error('Join this channel before attaching a file.');
        }
        const address = endpoint && LemonIrc.Media.url(endpoint, true);
        if (!address)
        {
            throw new Error('This network does not advertise a supported file host. You can paste an image or file link into your message.');
        }
        if (file.size > 20 * 1024 * 1024)
        {
            throw new Error('Choose a file smaller than 20 MB.');
        }
        const panel = dialog('Attach file');
        panel.append(make('p', file.name + ' · ' + Math.ceil(file.size / 1024) + ' KB'), make('p', 'Upload to ' + address.host));
        const status = make('p', '');
        status.role = 'status';
        const credentials = make('div', '');
        credentials.hidden = true;
        const account = document.createElement('input');
        account.className = 'text-input-pretty';
        account.placeholder = 'Upload account';
        account.ariaLabel = 'Upload account';
        account.autocomplete = 'username';
        const password = document.createElement('input');
        password.type = 'password';
        password.className = 'text-input-pretty';
        password.placeholder = 'Upload password';
        password.ariaLabel = 'Upload password';
        password.autocomplete = 'current-password';
        credentials.append(make('p', 'This file host requires an account. These credentials go only to ' + address.host), account, password);
        let controller;
        const upload = button('Upload', async () =>
        {
            upload.disabled = true;
            status.textContent = 'Uploading…';
            controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 120000);
            try
            {
                const headers = {'Content-Type': file.type || 'application/octet-stream', 'Content-Disposition': "attachment; filename*=UTF-8''" + encodeURIComponent(file.name)};
                if (!credentials.hidden)
                {
                    const bytes = new TextEncoder().encode(account.value + ':' + password.value);
                    headers.Authorization = 'Basic ' + btoa(Array.from(bytes, value => String.fromCharCode(value)).join(''));
                }
                password.value = '';
                const response = await fetch(address.href, {method: 'POST', headers, body: file, credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error', signal: controller.signal});
                if (response.status === 401)
                {
                    credentials.hidden = false;
                    status.textContent = 'Enter the account for this file host, then try again.';
                    return;
                }
                if (response.status !== 201)
                {
                    throw new Error('The file host rejected the upload (HTTP ' + response.status + ').');
                }
                const location = response.headers.get('Location');
                const link = location && LemonIrc.Media.url(new URL(location, address).href, true);
                if (!link)
                {
                    throw new Error('The upload did not return a usable file link.');
                }
                if (owner.conversations.get(context) !== destination)
                {
                    status.textContent = 'Uploaded: ' + link.href;
                    return;
                }
                const visible = client === owner && current === context;
                const draft = visible ? input.value : destination.draft;
                destination.draft = draft + (draft ? '\n' : '') + link.href;
                if (visible)
                {
                    input.value = destination.draft;
                }
                panel.close();
            }
            catch (error)
            {
                status.textContent = error.name === 'AbortError' ? 'Upload cancelled or timed out.' : error.message + ' The file host must allow browser uploads.';
                if (panel.open)
                {
                    playEventSound('error');
                }
            }
            finally
            {
                clearTimeout(timeout);
                upload.disabled = false;
            }
        });
        panel.append(credentials, status, upload, button('Cancel', () => panel.close()));
        panel.addEventListener('close', () =>
        {
            controller?.abort();
            password.value = '';
        });
    }
    /**
     * @brief shows the information already received for a channel
     *
     * @param string name -> channel name
     *
     * @return void
     */
    function channelInformation(name)
    {
        const channel = client.channels.get(client.fold(name));
        const listed = client.directory.get(client.fold(name));
        const panel = dialog('Channel information · ' + name);
        panel.append(make('p', 'Network: ' + client.network), make('p', 'Topic: ' + (channel?.topic || listed?.topic || 'No topic received')));
        const count = channel?.joined ? channel.members.size : listed?.count;
        panel.append(make('p', 'People: ' + (count ?? 'Unknown')), make('p', channel?.joined ? 'Membership updates arrive while you are joined' : 'The count comes from the last channel list. The server may hide members until you join'));
    }

    /**
     * @brief toggles local message filtering for one user
     *
     * @param object user -> selected user
     *
     * @return void
     */
    function toggleIgnore(user)
    {
        setIgnored(user.nick, !user.ignored);
    }

    /**
     * @brief reads the saved ignore list of one network
     *
     * @param string networkId -> network identifier
     *
     * @return object set of nicknames
     */
    function loadIgnored(networkId)
    {
        try
        {
            const saved = JSON.parse(localStorage.getItem('lemon-irc-ignored') || '{}')[networkId];
            return new Set(Array.isArray(saved) ? saved.filter(nick => typeof nick === 'string' && nick.length <= 64) : []);
        }
        catch (error)
        {
            return new Set();
        }
    }

    /**
     * @brief stores the current network's ignore list
     *
     * @return void
     */
    function saveIgnored()
    {
        try
        {
            const all = JSON.parse(localStorage.getItem('lemon-irc-ignored') || '{}');
            all[activeNetwork || 'default'] = [...client.ignoredNicks];
            localStorage.setItem('lemon-irc-ignored', JSON.stringify(all));
        }
        catch (error)
        {
            report(error);
        }
    }

    /**
     * @brief ignores or stops ignoring a nickname and remembers the choice for this network
     *
     * @param string nick -> nickname
     * @param bool ignored -> whether messages from the nickname are hidden
     *
     * @return void
     */
    function setIgnored(nick, ignored)
    {
        const user = client.users.get(client.fold(nick));
        if (user)
        {
            user.ignored = ignored;
            if (ignored)
            {
                for (const conversation of client.conversations.values())
                {
                    conversation.typing.delete(user.id);
                }
            }
        }
        for (const saved of [...client.ignoredNicks])
        {
            if (client.fold(saved) === client.fold(nick))
            {
                client.ignoredNicks.delete(saved);
            }
        }
        if (ignored)
        {
            client.ignoredNicks.add(user?.nick || nick);
        }
        saveIgnored();
        renderIgnoredList();
        client.status(ignored ? 'Ignoring ' + nick + '. Their messages are hidden. Settings → Chat lists ignored users' : 'Stopped ignoring ' + nick);
        render();
    }

    /**
     * @brief opens the theme's context menu for one chat message and its author
     *
     * @param object event -> context menu or click event
     * @param object message -> rendered chat message
     *
     * @return void
     */
    function messageMenu(event, message)
    {
        const nick = message.author;
        const actions = [];
        if (!message.own)
        {
            actions.push(['message', () => showUser(client.user(nick)), '7']);
            actions.push(['info', () => userInformation(nick), '7']);
        }
        actions.push(['copy', () => navigator.clipboard.writeText((message.action ? '* ' + nick + ' ' : '') + message.text), '2']);
        if (!message.own)
        {
            const ignored = client.isIgnored(nick);
            actions.push([ignored ? 'unignore' : 'ignore', () => setIgnored(nick, !ignored), '4']);
        }
        contextMenu(event, actions, true);
    }

    /**
     * @brief invites a user to a joined channel
     *
     * @param object user -> selected user
     *
     * @return void
     */
    function inviteUser(user)
    {
        const panel = dialog('Invite ' + user.nick);
        const select = document.createElement('select');
        select.className = 'text-input-pretty';
        select.ariaLabel = 'Channel';
        for (const channel of client.channels.values())
        {
            if (channel.joined)
            {
                select.append(new Option(channel.name, channel.name));
            }
        }
        const label = make('label', 'Channel');
        label.append(select);
        panel.append(label, button('Invite', () => guard(() =>
        {
            client.write('INVITE ' + user.nick + ' ' + select.value);
            panel.close();
        })), button('Cancel', () => panel.close()));
    }

    /**
     * @brief confirms a channel ban mask before sending it
     *
     * @param object user -> selected user
     * @param object channel -> selected channel
     *
     * @return void
     */
    function banUser(user, channel)
    {
        const host = user.fields.get('Host');
        const mask = host ? '*!*@' + host : user.nick + '!*@*';
        textDialog('Ban from ' + channel.name, 'Ban mask', mask, value =>
        {
            if (!value || /[\s,:\0]/.test(value))
            {
                throw new Error('Enter a ban mask without spaces or commas');
            }
            client.write('MODE ' + channel.name + ' +b ' + value);
        });
    }

    /**
     * @brief opens the copied context menu with its theme icons
     *
     * @param MouseEvent event -> menu position
     * @param array actions -> labels, callbacks or submenus, icons, disabled reasons and checked states
     * @param bool compact -> smaller text without icons, for the chat
     *
     * @return void
     */
    function contextMenu(event, actions, compact = false)
    {
        event.preventDefault();
        event.stopPropagation();
        const container = byId('contextmenus-container');
        const origin = event.currentTarget;
        container.replaceChildren();
        const buildMenu = (entries, parent = null) =>
        {
            const menu = make('div', '', 'channel-list-context-menu' + (compact ? ' irc-compact-menu' : ''));
            const items = make('div', '', 'channel-list-context-menu-items');
            menu.append(make('div', '', 'channel-list-context-menu-background'), items);
            menu.setAttribute('role', 'menu');
            menu.style.position = 'fixed';
            let child = null;
            let childOwner = null;
            const closeChild = () =>
            {
                child?.remove();
                childOwner?.setAttribute('aria-expanded', 'false');
                child = null;
                childOwner = null;
            };
            for (const [label, action, icon, reason, checked] of entries)
            {
                const item = make('p', label, 'context-menu-item');
                const submenu = Array.isArray(action);
                item.dataset.action = icon || '7';
                const openChild = focus =>
                {
                    if (childOwner !== item || !child?.isConnected)
                    {
                        closeChild();
                        child = buildMenu(action, item);
                        child.classList.add('irc-sort-menu');
                        childOwner = item;
                        container.append(child);
                        const bounds = item.getBoundingClientRect();
                        const menuBounds = menu.getBoundingClientRect();
                        const left = menuBounds.right + child.offsetWidth <= innerWidth - 8 ? menuBounds.right : menuBounds.left - child.offsetWidth;
                        child.style.left = Math.max(8, left) + 'px';
                        child.style.top = Math.max(8, Math.min(bounds.top, innerHeight - child.offsetHeight - 8)) + 'px';
                        item.setAttribute('aria-expanded', 'true');
                    }
                    if (focus)
                    {
                        child.querySelector('.context-menu-item')?.focus({preventScroll: true});
                    }
                };
                clickable(item, () =>
                {
                    if (submenu)
                    {
                        openChild(true);
                    }
                    else if (action)
                    {
                        container.replaceChildren();
                        guard(action);
                    }
                });
                item.setAttribute('role', checked === undefined ? 'menuitem' : 'menuitemradio');
                if (checked !== undefined)
                {
                    item.setAttribute('aria-checked', String(checked));
                }
                if (submenu || checked)
                {
                    const mark = make('span', submenu ? '›' : '✓', 'irc-menu-mark');
                    mark.setAttribute('aria-hidden', 'true');
                    item.append(mark);
                }
                if (submenu)
                {
                    item.setAttribute('aria-haspopup', 'menu');
                    item.setAttribute('aria-expanded', 'false');
                    item.addEventListener('keydown', key =>
                    {
                        if (key.key === 'ArrowRight')
                        {
                            key.preventDefault();
                            openChild(true);
                        }
                    });
                }
                if (!action)
                {
                    item.setAttribute('aria-disabled', 'true');
                    item.title = reason;
                }
                item.onpointerenter = () =>
                {
                    if (submenu)
                    {
                        openChild(false);
                    }
                    else
                    {
                        closeChild();
                    }
                };
                items.append(item);
            }
            menu.onkeydown = key =>
            {
                const choices = [...items.children];
                const index = choices.indexOf(document.activeElement);
                const next = {ArrowDown: (index + 1) % choices.length, ArrowUp: (index + choices.length - 1) % choices.length, Home: 0, End: choices.length - 1};
                if (key.key in next)
                {
                    key.preventDefault();
                    choices[next[key.key]].focus({preventScroll: true});
                }
                else if (key.key === 'Escape' || (key.key === 'ArrowLeft' && parent))
                {
                    key.preventDefault();
                    if (parent)
                    {
                        parent.setAttribute('aria-expanded', 'false');
                        menu.remove();
                        parent.focus({preventScroll: true});
                    }
                    else
                    {
                        container.replaceChildren();
                        origin?.focus({preventScroll: true});
                    }
                }
            };
            return menu;
        };
        const menu = buildMenu(actions);
        container.append(menu);
        menu.style.left = Math.max(8, Math.min(event.clientX, innerWidth - menu.offsetWidth - 8)) + 'px';
        menu.style.top = Math.max(8, Math.min(event.clientY, innerHeight - menu.offsetHeight - 8)) + 'px';
        menu.querySelector('.context-menu-item')?.focus({preventScroll: true});
    }
    /**
     * @brief lets a copied control respond to clicks and keyboard activation
     *
     * @param HTMLElement node -> control element
     * @param function action -> activation handler
     *
     * @return void
     */
    function clickable(node, action)
    {
        node.tabIndex = 0;
        node.setAttribute('role', 'button');
        node.onclick = action;
        node.onkeydown = event =>
        {
            if (event.target === node && (event.key === 'Enter' || event.key === ' '))
            {
                event.preventDefault();
                action();
            }
        };
    }
    function channelRow(id, name, indent, collapsed, toggle)
    {
        const row = make('div', '', 'single-channel');
        row.dataset.channelId = id;
        row.dataset.channelParentId = id === 'network' ? '-1' : 'network';
        const padding = make('div', '', 'padding-div');
        padding.style.paddingLeft = indent + 'px';
        const collapse = make('div', '', 'single-channel-collapse-button');
        collapse.classList.toggle('single-channel-expand-button', !!collapsed);
        if (toggle)
        {
            clickable(collapse, () => toggle());
            collapse.onclick = event =>
            {
                event.stopPropagation();
                toggle();
            };
            collapse.setAttribute('aria-label', 'Toggle members of ' + name);
            collapse.setAttribute('aria-expanded', String(!collapsed));
        }
        const label = make('p', id === 'network' ? name : channelLabel(name), 'single-channel-name-p');
        label.dataset.channelNameId = id;
        const icon = make('div', '', 'single-channel-icon');
        icon.dataset.channelIconFor = id;
        row.append(padding, collapse, label, icon);
        clickable(row, () =>
        {
            if (id === 'network')
            {
                activate('network');
            }
            else
            {
                guard(() => isMobileTheme() && !channel?.joined ? join(name) : openChannel(name));
            }
        });
        row.setAttribute('aria-label', name);
        const channel = client.channels.get(client.fold(name));
        row.classList.toggle('irc-joined-channel', Boolean(channel?.joined));
        const count = channel?.joined ? channel.members.size : client.directory.get(client.fold(name))?.count;
        if (id !== 'network' && Number.isSafeInteger(count) && count >= 0)
        {
            const people = make('span', '', 'single-channel-people');
            people.setAttribute('aria-label', count + (count === 1 ? ' person' : ' people'));
            people.append(make('span', String(count), 'single-channel-people-count'));
            row.append(people);
        }
        if (id === 'network' && client.listing)
        {
            // spinner while the public channel list arrives
            const loading = make('span', '', 'irc-channel-loading');
            loading.setAttribute('role', 'status');
            loading.setAttribute('aria-label', 'Loading channels');
            loading.append(make('span', '', 'irc-spinner'));
            row.append(loading);
        }
        row.title = id === 'network' ? (client.listing ? 'Loading channels…' : client.directory.size + ' public channels. Type a channel name to find it') : (count == null ? '' : count + ' people. ') + 'Double click to join. Expand to see available members';
        row.oncontextmenu = event => contextMenu(event, id === 'network' ?
        [
            ['new channel', createChannel, '0'],
            ['new chat', newPrivateChat, '7'],
            ['refresh', () => client.requestDirectory(), '3'],
            ['sort', channelSortOptions.map(([value, label]) => [label, () => setChannelSort(value), '2', '', value === channelSort]), '2'],
            ['commands', commandPrompt, '2']
        ] :
        [
            ['join', () => join(name), '3'],
            ['open', () => openChannel(name), '7'],
            ['new channel', createChannel, '0'],
            ['topic', channel?.joined ? () => textDialog('Edit topic · ' + name, 'Topic', channel.topic, topic => client.write('TOPIC ' + name + ' :' + topic)) : null, '2', 'Join this channel first. The server decides whether you can change its topic'],
            ['info', () => channelInformation(name), 'server-info'],
            ['settings', channel?.joined ? () => openManagement(name) : null, '2', 'Join this channel first'],
            ['sort users', memberSortOptions.map(([value, label]) => [label, () => setMemberSort(value), '2', '', value === memberSort]), '2'],
            ['leave', channel?.joined ? () => client.write('PART ' + name) : null, '12', 'You have not joined this channel']
        ]);
        if (id === 'network')
        {
            row.ondblclick = toggle;
        }
        else
        {
            row.ondblclick = event =>
            {
                if (!event.target.closest('.single-channel-collapse-button'))
                {
                    guard(() => channel?.joined ? openChannel(name) : join(name));
                }
            };
        }
        return row;
    }

    function treeRow(entry)
    {
        if (entry.type === 'root')
        {
            return channelRow('network', client.network, 0, networkCollapsed, () =>
            {
                networkCollapsed = !networkCollapsed;
                renderTree();
            });
        }
        if (entry.type === 'member')
        {
            return memberRow(entry.member, entry.channel);
        }
        const channel = client.channels.get(client.fold(entry.label));
        return channelRow(entry.id, entry.label, 20, channel?.collapsed !== false, () => guard(() =>
        {
            const expanded = client.channel(entry.label);
            expanded.collapsed = !expanded.collapsed;
            if (!expanded.collapsed)
            {
                client.requestMembers(expanded.name);
            }
            renderTree();
        }));
    }

    /**
     * @brief saves the channel order and redraws the tree
     *
     * @param string value -> selected sort option
     *
     * @return void
     */
    function setChannelSort(value)
    {
        channelSort = value;
        utils__storage_set('channel_sort', value);
        directoryRevision = -1;
        treeView.container.scrollTop = 0;
        renderTree();
    }

    /**
     * @brief compares channel names or known member counts
     *
     * @param object first -> first channel
     * @param object second -> second channel
     *
     * @return number position of the first channel relative to the second
     */
    function compareChannels(first, second)
    {
        if (channelSort.startsWith('count-'))
        {
            const firstCount = first.joined ? first.members.size : first.count || 0;
            const secondCount = second.joined ? second.members.size : second.count || 0;
            const difference = channelSort === 'count-asc' ? firstCount - secondCount : secondCount - firstCount;
            if (difference)
            {
                return difference;
            }
        }
        const names = first.name.localeCompare(second.name);
        return channelSort === 'name-desc' ? -names : names;
    }

    /**
     * @brief saves the member order and redraws the tree
     *
     * @param string value -> selected sort option
     *
     * @return void
     */
    function setMemberSort(value)
    {
        memberSort = value;
        utils__storage_set('member_sort', value);
        render();
    }

    /**
     * @brief compares members by the selected order with unknown times last
     *
     * @param object first -> first membership
     * @param object second -> second membership
     *
     * @return number position of the first member relative to the second
     */
    function compareMembers(first, second)
    {
        const a = first.user;
        const b = second.user;
        if (memberSort.startsWith('role-'))
        {
            const rank = member =>
            {
                const index = [...client.prefixModes].findIndex(mode => member.modes.includes(mode));
                return index < 0 ? client.prefixModes.length : index;
            };
            const difference = rank(first) - rank(second);
            if (difference)
            {
                return memberSort === 'role-desc' ? difference : -difference;
            }
        }
        if (memberSort.startsWith('activity-') || memberSort.startsWith('connected-'))
        {
            const connected = memberSort.startsWith('connected-');
            const firstTime = connected ? a.connectedAt : a.lastActiveAt;
            const secondTime = connected ? b.connectedAt : b.lastActiveAt;
            if (!firstTime !== !secondTime)
            {
                return firstTime ? -1 : 1;
            }
            const oldestFirst = connected ? memberSort === 'connected-desc' : memberSort === 'activity-asc';
            const difference = oldestFirst ? firstTime - secondTime : secondTime - firstTime;
            if (difference)
            {
                return difference;
            }
        }
        const names = a.nick.localeCompare(b.nick);
        return memberSort === 'name-desc' ? -names : names;
    }

    /**
     * @brief schedules connection time lookups for visible members
     *
     * @return void
     */
    function scheduleConnectionTimes()
    {
        if (!memberSort.startsWith('connected-') || !client.connected || document.hidden)
        {
            clearTimeout(connectionTimeTimer);
            connectionTimeTimer = null;
            return;
        }
        if (!connectionTimeTimer)
        {
            connectionTimeTimer = setTimeout(() =>
            {
                connectionTimeTimer = null;
                loadVisibleConnectionTime();
            }, Math.max(250, nextConnectionTimeRequest - Date.now()));
        }
    }

    /**
     * @brief loads one visible user's connection time without querying the whole channel
     *
     * @return void
     */
    function loadVisibleConnectionTime()
    {
        if (!memberSort.startsWith('connected-') || !client.connected || document.hidden)
        {
            return;
        }
        if (Date.now() < nextConnectionTimeRequest)
        {
            scheduleConnectionTimes();
            return;
        }
        if (connectionTimeRequest?.owner === client && client.userQueries.get(client.fold(connectionTimeRequest.query.nick)) === connectionTimeRequest.query && !connectionTimeRequest.query.complete && Date.now() - connectionTimeRequest.query.started < 30000)
        {
            nextConnectionTimeRequest = Date.now() + 2500;
            scheduleConnectionTimes();
            return;
        }
        const users = new Map([...client.users.values()].map(user => [String(user.id), user]));
        for (const container of [treeView.container, byId('member-list-body')])
        {
            const bounds = container.getBoundingClientRect();
            if (!bounds.width || !bounds.height)
            {
                continue;
            }
            for (const row of container.querySelectorAll('[data-irc-user]'))
            {
                const user = users.get(row.dataset.ircUser);
                if (!user || user.connectedAt || user.connectionTimeChecked)
                {
                    continue;
                }
                const rect = row.getBoundingClientRect();
                if (rect.bottom <= Math.max(0, bounds.top) || rect.top >= Math.min(innerHeight, bounds.bottom) || rect.right <= Math.max(0, bounds.left) || rect.left >= Math.min(innerWidth, bounds.right))
                {
                    continue;
                }
                try
                {
                    const query = client.requestUserInfo(user.nick, true);
                    connectionTimeRequest = {owner: client, query};
                }
                catch (error)
                {
                    client.status(error.message, 'warning');
                }
                nextConnectionTimeRequest = Date.now() + 2500;
                scheduleConnectionTimes();
                return;
            }
        }
    }

    function renderTree()
    {
        if (document.body.dataset.ircCompact === 'true')
        {
            const channel = [...client.channels.values()].find(entry => entry.id === current) || [...client.channels.values()].find(entry => entry.id === lastChannel);
            const entries = channel ? [...channel.members.values()].sort(compareMembers).map(member => ({type: 'member', label: member.user.nick, member, channel})) : [];
            treeView.setEntries(entries);
            return;
        }
        if (directoryOwner !== client || directoryRevision !== client.directoryRevision)
        {
            directoryOwner = client;
            directoryRevision = client.directoryRevision;
            sortedDirectory = [...client.directory.values()].sort(compareChannels);
        }
        const entries = [{type: 'root', label: client.network}];
        const query = client.fold(filterInput.value.trim());
        let matches = 0;
        const append = listed =>
        {
            if (query && !client.fold(listed.name).includes(query))
            {
                return;
            }
            matches++;
            const channel = client.channels.get(client.fold(listed.name));
            entries.push({type: 'channel', id: listed.id, label: listed.name});
            if (channel && !channel.collapsed)
            {
                for (const member of [...channel.members.values()].sort(compareMembers))
                {
                    entries.push({type: 'member', label: member.user.nick, member, channel});
                }
            }
        };
        if (!networkCollapsed)
        {
            const joined = [...client.channels.values()].filter(channel => channel.joined).sort(compareChannels);
            let joinedIndex = 0;
            if (preferences.joined_first)
            {
                for (const channel of joined)
                {
                    append(channel);
                }
                joinedIndex = joined.length;
            }
            for (const listed of sortedDirectory)
            {
                if (!client.channels.get(client.fold(listed.name))?.joined)
                {
                    while (joinedIndex < joined.length && compareChannels(joined[joinedIndex], listed) <= 0)
                    {
                        append(joined[joinedIndex++]);
                    }
                    append(listed);
                }
            }
            while (joinedIndex < joined.length)
            {
                append(joined[joinedIndex++]);
            }
        }
        treeView.setEntries(entries);
        filterCount.textContent = matches === 0 ? 'No matching channels' : matches + (matches === 1 ? ' channel' : ' channels');
    }
    /**
     * @brief describes activity observed by this client
     *
     * @param object user -> user with the last observed action time
     *
     * @return object dot color and explanation
     */
    function activityState(user)
    {
        if (!user.lastActiveAt)
        {
            return {color: 'transparent', label: 'No activity observed in this session'};
        }
        const minutes = Math.max(0, (Date.now() - user.lastActiveAt) / 60000);
        const strength = 1 - Math.min(1, Math.max(0, minutes - 1) / 119);
        const elapsed = minutes < 1 ? 'within the last minute' : (minutes < 60 ? Math.floor(minutes) + ' minutes ago' : Math.floor(minutes / 60) + ' hours ago');
        return {color: 'rgb(0, ' + Math.round(190 * strength) + ', ' + Math.round(70 * strength) + ')', label: 'Last observed activity ' + elapsed};
    }

    /**
     * @brief updates existing activity dots without rebuilding the tree
     *
     * @return void
     */
    function refreshActivity()
    {
        clearTimeout(activityTimer);
        if (!client.connected || !preferences.activity || document.hidden)
        {
            return;
        }
        const users = new Map([...client.users.values()].map(user => [String(user.id), user]));
        for (const dot of document.querySelectorAll('.irc-activity'))
        {
            const user = users.get(dot.dataset.userId);
            if (user)
            {
                const state = activityState(user);
                dot.style.backgroundColor = state.color;
                dot.title = state.label;
                dot.setAttribute('aria-label', state.label);
            }
        }
        activityTimer = setTimeout(refreshActivity, 30000);
    }

    function memberRow(member, channel)
    {
        const local = client.fold(member.user.nick) === client.fold(client.nick);
        const country = member.user.country || member.user.serverCountry;
        const template = document.createElement('template');
        template.innerHTML = channel_tree__generate_html_for_single_client(
        {
            client_id: member.user.id,
            channel_id: channel.id,
            username: member.user.nick,
            country_iso_code: preferences.flags ? country : '',
            is_idle: false,
            is_ignored_by_local_client: member.user.ignored,
            audio_state: 4,
            unread_count: client.conversations.get('user:' + member.user.id)?.unread || 0
        }, false);
        const row = template.content.firstElementChild;
        row.classList.toggle('connected-local-client', local);
        row.classList.toggle('irc-away', Boolean(member.user.away));
        row.title = member.user.away ? 'Away: ' + member.user.away : '';
        if (memberSort.startsWith('connected-'))
        {
            const pending = client.userQueries.has(client.fold(member.user.nick));
            const connection = member.user.connectedAt ? 'Connected since ' + new Date(member.user.connectedAt).toLocaleString() : (pending ? 'Loading connection time…' : (member.user.connectionTimeChecked ? 'Connection time unavailable' : 'Connection time not loaded yet'));
            row.title = [row.title, connection].filter(Boolean).join('\n');
        }
        row.querySelectorAll('[id]').forEach(node => node.removeAttribute('id'));
        row.removeAttribute('draggable');
        row.dataset.ircUser = member.user.id;
        row.dataset.ircChannel = channel.name;
        row.querySelector('.client-audio-state').title = 'IRC does not provide voice audio';
        row.querySelector('.client-audio-state').dataset.initials = member.user.nick.slice(0, 2).toUpperCase();
        const groups = row.querySelector('.client-groups');
        groups.append(roleIcons(member));
        groups.title = 'IRC channel modes: ' + (member.modes || 'none');
        if (preferences.avatars && member.user.metadata.get('avatar'))
        {
            const avatar = LemonIrc.Media.image(member.user.metadata.get('avatar'), member.user.nick);
            if (avatar)
            {
                avatar.className = 'irc-avatar';
                row.querySelector('.client-audio-state').append(avatar);
            }
        }
        const flag = row.querySelector('.connected-client-country-flag');
        // a column exists when any member of the channel needs it, and then every row keeps its place
        const columns = memberColumns(channel);
        row.classList.toggle('irc-role-column', columns.role);
        flag.hidden = !columns.flag;
        flag.style.visibility = country ? '' : 'hidden';
        flag.title = member.user.country ? 'User country: ' + (member.user.fields.get('Country') || country) : 'Server location: ' + (member.user.fields.get('Server') || country);
        if (preferences.activity)
        {
            const state = activityState(member.user);
            const dot = make('span', '', 'irc-activity');
            dot.dataset.userId = member.user.id;
            dot.style.backgroundColor = state.color;
            dot.title = state.label;
            dot.setAttribute('role', 'img');
            dot.setAttribute('aria-label', state.label);
            row.append(dot);
        }
        clickable(row, () => showUser(member.user));
        const actions = local ? [['nickname', changeNickname, '9'], ['my info', () => userInformation(member.user.nick), '7']] :
        [
            ['message', () => showUser(member.user), '7'],
            ['info', () => userInformation(member.user.nick), '7'],
            [member.user.ignored ? 'unignore' : 'ignore', () => toggleIgnore(member.user), '4'],
            ['notice', () => textDialog('Send notice · ' + member.user.nick, 'Message', '', text => client.write('NOTICE ' + member.user.nick + ' :' + text)), '8'],
            ['invite', [...client.channels.values()].some(entry => entry.joined) ? () => inviteUser(member.user) : null, '3', 'Join a channel before inviting someone']
        ];
        const self = [...channel.members.values()].find(entry => client.fold(entry.user.nick) === client.fold(client.nick));
        const canModerate = channel.joined && self && /[qaoh]/.test(self.modes);
        const reason = channel.joined ? 'A channel operator role is required. The server decides whether the action is permitted' : 'Join this channel before moderating it';
        if (!local)
        {
            actions.push(['kick', canModerate ? () => textDialog('Kick ' + member.user.nick + ' from ' + channel.name, 'Reason', '', reason => client.write('KICK ' + channel.name + ' ' + member.user.nick + ' :' + (reason || 'Removed from channel'))) : null, '12', reason]);
            actions.push(['ban', canModerate ? () => banUser(member.user, channel) : null, '13', reason]);
        }
        if (channel.joined)
        {
            for (const mode of client.prefixModes)
            {
                const remove = member.modes.includes(mode);
                const name = {q: 'owner', a: 'admin', o: 'op', h: 'halfop', v: 'voice'}[mode] || mode;
                actions.push([(remove ? 'take ' : 'give ') + name, canModerate ? () => client.write('MODE ' + channel.name + ' ' + (remove ? '-' : '+') + mode + ' ' + member.user.nick) : null, '6', reason]);
            }
        }
        row.oncontextmenu = event => contextMenu(event, actions);
        return row;
    }
    function render(updateTree = true)
    {
        renderCount++;
        // attachments only appear when the network advertises an HTTP file host
        const fileHost = client.isupport.get('draft/FILEHOST') || client.isupport.get('soju.im/FILEHOST');
        const canUpload = client.connected && Boolean(fileHost && LemonIrc.Media.url(fileHost, true));
        for (const id of ['custom-file-upload-button-image', 'custom-file-upload-button-file'])
        {
            byId(id).classList.toggle('irc-upload-unavailable', !canUpload);
        }
        byId('hide-show-flags-button').title = preferences.flags ? 'Hide country flags' : 'Show country flags';
        byId('hide-show-flags-button').setAttribute('aria-pressed', String(preferences.flags));
        document.body.classList.toggle('show-channel-people-in-channel-list', preferences.channel_counts);
        document.body.classList.toggle('hide-channel-group-icons-in-channel-list', !preferences.roles);
        renderLog();
        renderTyping();
        if (updateTree)
        {
            renderTree();
        }
        const tabs = byId('chat-context-selectors-container');
        const previousTab = tabs.querySelector('[aria-selected="true"]')?.dataset.chatContextSelectorId;
        const tabScroll = tabs.scrollLeft;
        tabs.replaceChildren();
        for (const conversation of client.conversations.values())
        {
            if (conversation.id === 'network')
            {
                continue;
            }
            const tab = make('div', '', 'chat-context-selector');
            const label = make('div', '', 'p-container');
            const name = conversation.id.startsWith('channel:') ? channelLabel(conversation.name) : conversation.name;
            label.append(make('p', name + (conversation.unread && conversation.id !== current ? ' (' + conversation.unread + ')' : '')));
            tab.append(label);
            tab.dataset.chatContextSelectorType = conversation.id.startsWith('user:') ? 'pm' : 'channel';
            tab.dataset.chatContextSelectorId = conversation.id;
            tab.style.backgroundColor = conversation.id === current ? 'rgb(54, 57, 63)' : '';
            clickable(tab, () => activate(conversation.id));
            tab.setAttribute('aria-selected', String(conversation.id === current));
            if (conversation.id !== 'network')
            {
                const close = make('div', '', 'remove-chat-context-selector');
                close.dataset.chatContextRemoveSelectorType = tab.dataset.chatContextSelectorType;
                close.dataset.chatContextRemoveSelectorId = conversation.id;
                close.setAttribute('aria-label', 'Close ' + conversation.name);
                clickable(close, () => closeConversation(conversation.id));
                close.addEventListener('click', event => event.stopPropagation());
                tab.append(close);
            }
            tabs.append(tab);
        }
        tabs.scrollLeft = tabScroll;
        if (previousTab !== current)
        {
            const selected = tabs.querySelector('[aria-selected="true"]');
            if (selected && tabs.clientWidth)
            {
                const strip = tabs.getBoundingClientRect();
                const rect = selected.getBoundingClientRect();
                if (rect.right > strip.right)
                {
                    tabs.scrollLeft += rect.right - strip.right;
                }
                else if (rect.left < strip.left)
                {
                    tabs.scrollLeft -= strip.left - rect.left;
                }
            }
        }
        const selector = byId('chat-context-select');
        const choices = [...tabs.children].map(tab => [tab.dataset.chatContextSelectorId, tab.querySelector('.p-container').textContent]);
        if (!choices.length || current === 'network')
        {
            choices.unshift(['network', 'Choose a conversation']);
        }
        if (JSON.stringify(choices) !== selector.dataset.choices)
        {
            selector.replaceChildren(...choices.map(([id, label]) => new Option(label, id)));
            selector.dataset.choices = JSON.stringify(choices);
        }
        selector.value = current;
        byId('chat-context-select-close').disabled = current === 'network';
        const conversation = client.conversation(current);
        conversation.unread = 0;
        conversationPicker.render();
        const history = byId('chat-context-container');
        const previousContext = history.firstElementChild;
        // the container or the conversation can be the scrolling element, depending on the theme
        const nearEnd = node => !node || node.scrollHeight - node.scrollTop - node.clientHeight < 60;
        const atBottom = !previousContext || previousContext.dataset.conversation !== current || (nearEnd(previousContext) && nearEnd(history));
        const scrollTop = previousContext?.scrollTop || 0;
        const historyScrollTop = history.scrollTop;
        const context = previousContext?.dataset.conversation === current ? previousContext : make('div', '', 'chat-context');
        context.dataset.conversation = current;
        context.style.display = 'block';
        const rows = [];
        for (const message of current === 'network' ? [] : conversation.messages)
        {
            // earlier messages from ignored people disappear too, and return when the ignore is lifted
            if (message.author && !message.own && client.isIgnored(message.author))
            {
                continue;
            }
            const saved = messageRows.get(message);
            if (saved && saved.previews === preferences.previews + ':' + preferences.site_previews)
            {
                rows.push(saved.row);
                continue;
            }
            const row = make('div', '', message.author ? 'single-chat-message' : 'single-server-message');
            row.classList.toggle('irc-own-message', Boolean(message.own));
            if (message.author)
            {
                const content = make('div', '', 'single-message-content');
                const sender = make('div', '', 'single-chat-message-sender-username-container');
                const author = make('p', message.author, 'single-chat-message-sender-username');
                sender.append(author);
                row.oncontextmenu = event => messageMenu(event, message);
                if (!message.own)
                {
                    author.classList.add('irc-message-author');
                    author.title = 'Actions for ' + message.author;
                    author.onclick = event => messageMenu(event, message);
                }
                const time = make('div', '', 'single-chat-message-sender-time');
                time.append(make('p', new Date(message.time).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})));
                const body = make('div', '', 'single-chat-message-content');
                const text = make('p', (message.action ? '* ' : '') + message.text, 'single-chat-message-content-p' + (message.own ? ' local-single-chat-message-content-p' : ''));
                text.replaceChildren(LemonIrc.Media.render((message.action ? '* ' : '') + message.text, preferences.previews, preferences.site_previews));
                body.append(text);
                content.append(sender, time, body);
                row.append(content);
            }
            else
            {
                row.textContent = message.text;
            }
            messageRows.set(message, {row, previews: preferences.previews + ':' + preferences.site_previews});
            fillSitePreviews(row);
            rows.push(row);
        }
        const retained = new Set(rows);
        for (const child of [...context.children])
        {
            if (!retained.has(child))
            {
                child.remove();
            }
        }
        for (const row of rows)
        {
            if (row.parentElement !== context)
            {
                context.append(row);
            }
        }
        if (context !== previousContext)
        {
            history.replaceChildren(context);
        }
        // a new message jumps to the end when the preference is on, even after scrolling up
        const newest = conversation.messages[conversation.messages.length - 1];
        const arrived = Boolean(newest) && context.ircNewest !== undefined && newest !== context.ircNewest;
        context.ircNewest = newest || null;
        if (atBottom || (arrived && preferences.autoscroll))
        {
            context.scrollTop = context.scrollHeight;
            history.scrollTop = history.scrollHeight;
        }
        else
        {
            context.scrollTop = scrollTop;
            history.scrollTop = historyScrollTop;
        }
        const channel = [...client.channels.values()].find(item => item.id === current);
        const description = byId('current-channel-description');
        const profile = byId('current-client-description');
        description.style.display = conversation.user ? 'none' : '';
        profile.style.display = conversation.user ? 'block' : 'none';
        if (conversation.user)
        {
            const user = conversation.user;
            byId('current-client-description-client-name').textContent = user.nick;
            byId('current-client-description-meta').textContent = user.away ? 'Away · ' + user.away : (user.metadata.get('status') || '');
            const avatar = preferences.avatars && user.metadata.get('avatar') ? LemonIrc.Media.image(user.metadata.get('avatar'), user.nick) : null;
            byId('current-client-avatar').replaceChildren(...(avatar ? [avatar] : []));
            const details = profile.querySelector('.client-status-details');
            details.replaceChildren();
            for (const [label, value] of userDetails(user))
            {
                const row = make('div', '');
                row.append(make('dt', label), make('dd', value));
                details.append(row);
            }
            const groups = byId('current-client-description-groups');
            groups.replaceChildren();
            for (const membership of client.channels.values())
            {
                const member = membership.members.get(user.id);
                if (member)
                {
                    // roles as words, since the small badges are hard to read here
                    const roles = [...client.prefixModes].filter(mode => member.modes.includes(mode)).map(mode => ({q: 'owner', a: 'admin', o: 'op', h: 'halfop', v: 'voice'}[mode] || mode));
                    const row = make('div', channelLabel(membership.name), 'irc-profile-channel');
                    if (roles.length)
                    {
                        row.append(make('span', ' · ' + roles.join(', '), 'irc-profile-role'));
                    }
                    groups.append(row);
                }
            }
        }
        description.replaceChildren(make('strong', channel ? channelLabel(channel.name) : (current === 'network' ? client.network : conversation.name)), make('p', channel ? channel.topic : (client.connected ? client.nick + ' · ' + client.network : 'Not connected')));
        if (channel && !channel.joined)
        {
            description.append(make('p', 'Double click this channel to join. The server may hide some members until you join'));
        }
        if (current === 'network' && client.connected)
        {
            description.append(make('p', client.listing ? 'Loading public channels…' : client.directory.size + ' public channels'));
        }
        byId('member-list-body').replaceChildren();
        byId('member-list-header').textContent = channel ? (channel.joined ? 'Members — ' : 'Visible members — ') + channel.members.size : '';
        if (channel)
        {
            for (const entry of [...channel.members.values()].sort(compareMembers))
            {
                const row = memberRow(entry, channel);
                row.classList.add('member-list-client', 'in-current-channel');
                row.querySelectorAll('[id]').forEach(node => node.removeAttribute('id'));
                byId('member-list-body').append(row);
            }
        }
        if (client.connected)
        {
            document.title = client.nick + ' · ' + client.network + ' — Lemon IRC';
        }
        refreshActivity();
        scheduleConnectionTimes();
    }
    // original controls
    input.maxLength = 900;
    input.oninput = () =>
    {
        if (preferences.typing)
        {
            guard(() => client.sendTyping(current, input.value.length > 0));
        }
    };
    input.onkeydown = event =>
    {
        if (event.key === 'Enter' && !event.shiftKey && !event.isComposing)
        {
            event.preventDefault();
            send();
        }
    };
    byId('chat-input-container-send-chat-input').onclick = send;
    logButton.setAttribute('aria-controls', 'textarea-log');
    logButton.setAttribute('aria-expanded', 'false');
    logButton.title = 'Show or hide the IRC log';
    logButton.onclick = () => showLog(logPanel.style.display === 'none');
    byId('communication-system-container').style.display = 'grid';
    g_layout.panels =
    {
        channels: byId('space-devider1'),
        chat: byId('space-devider2'),
        info: byId('space-devider-42'),
        input: byId('space-devider4'),
        toolbar: byId('communication-system-head-menu')
    };
    layout__layout_load_saved_state();
    byId('layout-edit-button').onclick = layout__layout_edit_toggle;
    for (const name of ['channels', 'chat', 'info'])
    {
        byId('drag-resize-' + name).addEventListener('mousedown', event => layout__layout_column_drag_start(event, name));
    }
    byId('communication-system-container').addEventListener('mousedown', layout__layout_edit_mousedown, true);
    document.addEventListener('mousemove', layout__layout_edit_mousemove);
    document.addEventListener('mouseup', layout__layout_edit_mouseup);
    byId('hide-chat-button').onclick = () =>
    {
        g_is_chat_hidden = !g_is_chat_hidden;
        if (!g_is_chat_hidden && !channelFilter.hidden)
        {
            hideChannelFilter();
        }
        applyLayout();
        renderTree();
    };
    byId('chat-context-select').onchange = event => activate(event.target.value);
    byId('chat-context-select-close').onclick = () => closeConversation(current);
    window.addEventListener('resize', () =>
    {
        applyLayout();
        fitToolbar();
        fitConnectionWindow();
        schedule();
    });
    byId('hide-chat-button').title = 'Show or hide chat';
    byId('clear-chat-button').title = 'Clear this chat';
    byId('clear-chat-button').onclick = () =>
    {
        client.conversation(current).messages.length = 0;
        render();
    };
    byId('connections-menu-button').onclick = () =>
    {
        const list = byId('connections-menu-list');
        list.style.display = list.style.display === 'none' ? 'block' : 'none';
    };
    byId('connections-menu-connect').onclick = () =>
    {
        byId('connections-menu-list').style.display = 'none';
        connect();
    };
    byId('connections-menu-disconnect').onclick = () =>
    {
        byId('connections-menu-list').style.display = 'none';
        disconnectedByUser = true;
        socket?.close();
    };
    byId('groups-menu').remove();
    byId('choose-theme-button').onclick = () =>
    {
        const list = byId('choose-theme-button-list');
        list.style.display = getComputedStyle(list).display === 'none' ? 'block' : 'none';
    };
    for (const choice of document.querySelectorAll('.choose-theme-item'))
    {
        choice.onclick = () => selectTheme(choice.dataset.name);
    }
    document.addEventListener('click', event =>
    {
        if (!event.target.closest('#contextmenus-container'))
        {
            byId('contextmenus-container').replaceChildren();
        }
        if (!event.target.closest('#connections-menu'))
        {
            byId('connections-menu-list').style.display = 'none';
        }
        if (!event.target.closest('#choose-theme-button, #choose-theme-button-list'))
        {
            byId('choose-theme-button-list').style.display = 'none';
        }
    });

    // account fields
    /**
     * @brief creates a label for one row of a connection form grid
     *
     * @param string text -> visible label
     * @param string target -> labelled control identifier
     *
     * @return object label element
     */
    function gridLabel(text, target)
    {
        const label = make('label', text, 'connect-window-label');
        label.htmlFor = target;
        return label;
    }
    /**
     * @brief wraps controls in one connection form grid cell
     *
     * @param array controls -> elements placed side by side
     *
     * @return object cell element
     */
    function gridField(...controls)
    {
        const field = make('div', '', 'connect-window-field');
        field.append(...controls);
        return field;
    }
    const identity = byId('connect-identity-section');
    identity.title = 'The nickname shown to other IRC users';
    identity.replaceChildren(make('legend', 'identity'));
    const nickname = document.createElement('input');
    nickname.id = 'irc-nickname';
    nickname.className = 'text-input-pretty';
    nickname.autocomplete = 'nickname';
    nickname.maxLength = 30;
    nickname.placeholder = 'Your nickname';
    nickname.setAttribute('aria-label', 'Nickname');
    const identitySelector = document.createElement('select');
    identitySelector.id = 'irc-identity';
    identitySelector.ariaLabel = 'Saved identity';
    identitySelector.className = 'text-input-pretty';
    const forgetIdentity = button('Forget', null);
    forgetIdentity.ariaLabel = 'Forget saved identity';
    const identityChoice = gridField(identitySelector, forgetIdentity);
    identityChoice.classList.add('irc-identity-choice');
    const identityGrid = make('div', '', 'irc-connect-grid');
    identityGrid.append(gridLabel('saved', 'irc-identity'), identityChoice, gridLabel('nickname', 'irc-nickname'), gridField(nickname));
    identity.append(identityGrid);
    byId('input-ip-address').readOnly = true;
    byId('input-port-number').readOnly = true;
    byId('connect-form-grid').style.visibility = 'visible';
    byId('connect-form-grid').classList.add('irc-connect-grid');
    byId('input-ip-address').parentElement.append(button('Choose server', networkBrowser));
    const credentials = byId('connect-keys-section');
    credentials.title = 'Optional IRC account login through SASL';
    credentials.replaceChildren(make('legend', 'registered account'));
    const credentialGrid = make('div', '', 'irc-connect-grid');
    for (const field of ['account', 'password'])
    {
        const control = document.createElement('input');
        control.id = 'irc-' + field;
        control.type = field === 'password' ? 'password' : 'text';
        control.className = 'text-input-pretty';
        control.autocomplete = field === 'password' ? 'current-password' : 'username';
        credentialGrid.append(gridLabel(field, control.id), gridField(control));
    }
    credentials.append(credentialGrid, make('p', 'Account names are remembered. Passwords are not saved. Use TLS for account login.', 'connect-section-text'));
    // the advanced switch only reveals the account login
    const advancedLabel = byId('connect-show-advanced').parentElement;
    advancedLabel.lastChild.textContent = ' Log in with a registered account';
    // status sits beside the connect button
    byId('another-buttons-sub-container').insertBefore(byId('connect-status-section'), byId('connect-button'));
    byId('connect-show-advanced').onchange = event =>
    {
        credentials.hidden = !event.target.checked;
        fitConnectionWindow();
    };
    byId('connect-window-close-button').onclick = () =>
    {
        connectFormRevision++;
        byId('verification-system').style.display = 'none';
        byId('irc-password').value = '';
    };
    const connectTitle = byId('container-2').querySelector('[id="menu-bar-container"]');
    connectTitle.addEventListener('pointerdown', startConnectionDrag);
    connectTitle.addEventListener('pointermove', moveConnectionDrag);
    connectTitle.addEventListener('pointerup', stopConnectionDrag);
    connectTitle.addEventListener('pointercancel', stopConnectionDrag);
    connectTitle.addEventListener('lostpointercapture', stopConnectionDrag);
    byId('another-buttons-sub-container').style.display = 'block';
    byId('connect-button').style.visibility = 'visible';
    byId('another-buttons-loading-container').style.display = 'none';
    byId('verification-system').style.display = 'none';
    byId('server-bookmarks-container').style.display = 'none';

    // unavailable features
    const unavailable =
    {
        'bookmarks-menu-button': 'Use the globe to choose an IRC server. Saved bookmarks are not implemented yet',
        'show-secret-identity-string': 'Use the IRC account fields in connection details',
        'microphone-always-broadcasting-audio-button': 'IRC does not provide voice audio',
        'custom-file-upload-button-song': 'IRC does not provide music streaming',
        'stop-song': 'IRC does not provide music streaming',
        'color-picker-selector-div': 'Message colour formatting is not implemented'
    };
    for (const [id, reason] of Object.entries(unavailable))
    {
        const control = byId(id);
        control.title = reason;
        control.setAttribute('aria-disabled', 'true');
        control.addEventListener('click', event =>
        {
            event.preventDefault();
            client.status(reason);
            showLog(true);
        }, true);
        control.querySelectorAll('input').forEach(node => node.disabled = true);
    }
    function openManagement(channelName = '')
    {
        if (!client.connected)
        {
            connect();
            return;
        }
        const owner = client;
        LemonIrc.openManagement({client: owner, make, button, dialog, isCurrent: () => client === owner, onError: () => playEventSound('error'), channelName});
    }
    for (const id of ['enter-server-settings', 'show-admin-password-entry'])
    {
        byId(id).title = 'IRC management';
        byId(id).onclick = () => openManagement();
    }
    for (const id of ['choose_image_input', 'choose-file-input'])
    {
        byId(id).disabled = false;
        byId(id).onchange = () => uploadFile(byId(id).files[0]).catch(report);
    }
    byId('custom-file-upload-button-image').title = 'Attach an image through the network file host';
    byId('custom-file-upload-button-file').title = 'Attach a file through the network file host';
    const flagsButton = byId('hide-show-flags-button');
    const networkButton = flagsButton.cloneNode(false);
    networkButton.id = 'irc-network-browser-button';
    networkButton.title = 'Browse IRC servers';
    networkButton.setAttribute('aria-label', 'Browse IRC servers');
    networkButton.onclick = networkBrowser;
    flagsButton.before(networkButton);
    flagsButton.setAttribute('aria-label', 'Show country flags');
    flagsButton.onclick = () =>
    {
        preferenceControls.flags.checked = !preferences.flags;
        preferenceControls.flags.onchange();
        utils__storage_set('flags', String(preferences.flags));
    };
    /**
     * @brief plays an enabled event sound
     *
     * @param string name -> event preference
     *
     * @return HTMLAudioElement|null sound instance when enabled
     */
    function playEventSound(name)
    {
        return soundPreferences[name] ? sounds__play(name.startsWith('incoming_') ? 'message_received' : name) : null;
    }

    function applySounds(enabled, persist)
    {
        g_are_sound_effects_enabled = enabled;
        sounds__apply_sound_effects_muted();
        byId('local-settings-sound-effects').checked = enabled;
        byId('sound-effects-button').title = enabled ? 'Mute sound effects' : 'Enable sound effects';
        byId('sound-effects-button').classList.toggle('sfx-on', enabled);
        byId('sound-effects-button').setAttribute('aria-pressed', String(enabled));
        if (persist)
        {
            utils__storage_set('sounds', String(enabled));
        }
    }
    byId('sound-effects-button').onclick = () => applySounds(!g_are_sound_effects_enabled, true);
    byId('show-hide-member-list-button').onclick = () =>
    {
        const list = byId('member-list-container');
        const toggle = byId('show-hide-member-list-button');
        if (isMobileTheme())
        {
            list.hidden = false;
            toggle.classList.toggle('member-list-shown');
            toggle.setAttribute('aria-expanded', String(toggle.classList.contains('member-list-shown')));
        }
        else
        {
            list.hidden = !list.hidden;
        }
    };
    byId('communication-system-container').addEventListener('click', event =>
    {
        if (event.target === event.currentTarget)
        {
            byId('show-hide-member-list-button').classList.remove('member-list-shown');
        }
    });
    const fontSize = byId('chat-input-font-size-range');
    fontSize.value = utils__storage_get('font_size') || '14';
    fontSize.oninput = () =>
    {
        document.body.style.setProperty('--irc-font-size', fontSize.value + 'px');
        utils__storage_set('font_size', fontSize.value);
    };
    fontSize.oninput();

    // supported preferences
    const settings = byId('local-settings-container');
    for (const control of settings.querySelectorAll('input, select, .local-settings-row button'))
    {
        control.disabled = true;
        control.title = 'This preference is not implemented in the IRC client';
    }
    /**
     * @brief adds a checkbox to the existing chat settings
     *
     * @param string id -> control identifier
     * @param string label -> setting name
     * @param string hint -> setting explanation
     * @param string section -> settings page name
     *
     * @return HTMLInputElement checkbox
     */
    function addPreference(id, label, hint, section = 'chat')
    {
        const row = make('label', '', 'local-settings-row');
        const text = make('span', '', 'local-settings-text');
        text.append(make('span', label, 'local-settings-label'), make('span', hint, 'local-settings-hint'));
        const control = document.createElement('input');
        control.type = 'checkbox';
        control.id = id;
        row.append(text, control);
        byId('local-settings-page-' + section).append(row);
        return control;
    }
    // ignored users, editable from the chat settings
    const ignoredSection = make('div', '', 'irc-ignored-users');
    const ignoredHeading = make('span', '', 'local-settings-text');
    ignoredHeading.append(make('span', 'ignored users', 'local-settings-label'), make('span', 'messages from these nicknames are hidden on the current network. Changes apply immediately', 'local-settings-hint'));
    const ignoredList = make('div', '', 'irc-ignored-list');
    const ignoreField = document.createElement('input');
    ignoreField.className = 'text-input-pretty';
    ignoreField.placeholder = 'nickname';
    ignoreField.ariaLabel = 'Nickname to ignore';
    ignoreField.maxLength = 64;
    const ignoreAdd = button('Ignore', () =>
    {
        const nick = ignoreField.value.trim();
        if (nick && !/[\s,]/.test(nick) && !client.channelTypes.includes(nick[0]))
        {
            setIgnored(nick, true);
            ignoreField.value = '';
        }
    });
    ignoreField.onkeydown = event =>
    {
        if (event.key === 'Enter')
        {
            event.preventDefault();
            ignoreAdd.click();
        }
    };
    const ignoreAddRow = make('div', '', 'irc-ignored-add');
    ignoreAddRow.append(ignoreField, ignoreAdd);
    ignoredSection.append(ignoredHeading, ignoredList, ignoreAddRow);
    /**
     * @brief lists ignored nicknames with a button to stop ignoring each one
     *
     * @return void
     */
    function renderIgnoredList()
    {
        const nicks = [...client.ignoredNicks].sort((a, b) => a.localeCompare(b));
        ignoredList.replaceChildren();
        if (!nicks.length)
        {
            ignoredList.append(make('p', 'Nobody is ignored on ' + client.network + '.', 'irc-ignored-empty'));
        }
        for (const nick of nicks)
        {
            const row = make('div', '', 'irc-ignored-row');
            row.append(make('span', nick, 'irc-ignored-nick'), button('Stop ignoring', () => setIgnored(nick, false)));
            ignoredList.append(row);
        }
    }
    renderIgnoredList();
    const preferenceControls =
    {
        avatars: byId('local-settings-show-avatars'),
        flags: byId('local-settings-country-flags'),
        channel_counts: byId('local-settings-show-channel-people'),
        roles: byId('local-settings-hide-server-group-icons'),
        activity: addPreference('irc-settings-activity', 'show activity indicators', 'green within a minute, fading to black after two hours. An empty circle means no activity observed here', 'appearance'),
        joined_first: addPreference('irc-settings-joined-first', 'keep joined channels at the top', 'keeps joined channels above other channels, regardless of the selected sort order', 'appearance'),
        previews: addPreference('irc-settings-previews', 'show image and media previews', 'loads linked images from their websites and shows audio or video players'),
        site_previews: addPreference('irc-settings-site-previews', 'show website previews', 'loads each linked page to show its title, summary and picture. When off, links are never requested'),
        typing: addPreference('irc-settings-typing', 'tell others when you are typing', 'only used when the network supports typing notifications'),
        autoscroll: addPreference('irc-settings-autoscroll', 'always scroll to new messages', 'jumps to the end of the chat when a message arrives, even after scrolling up')
    };
    const soundControls = new Map();
    for (const [name, label] of soundOptions)
    {
        const control = addPreference('irc-sound-' + name, label, '', 'audio');
        control.checked = soundPreferences[name];
        control.onchange = () =>
        {
            soundPreferences[name] = control.checked;
            if (!control.checked)
            {
                sounds__stop(name.startsWith('incoming_') ? 'message_received' : name);
            }
        };
        soundControls.set(name, control);
    }
    const testSound = button('play test sound', () =>
    {
        if (!g_are_sound_effects_enabled)
        {
            testSound.title = 'Enable sound effects first';
            return;
        }
        sounds__play('message_received');
    });
    /**
     * @brief adds a slider to the local settings that applies and saves its value immediately
     *
     * @param string id -> control identifier and storage key
     * @param string label -> setting name
     * @param string hint -> setting explanation
     * @param array range -> minimum, maximum, step and default value
     * @param string unit -> unit shown after the value
     * @param function apply -> receives the chosen number
     *
     * @return object range input
     */
    function addRange(id, label, hint, [min, max, step, fallback], unit, apply)
    {
        const row = make('label', '', 'local-settings-row irc-settings-range');
        const text = make('span', '', 'local-settings-text');
        text.append(make('span', label, 'local-settings-label'), make('span', hint, 'local-settings-hint'));
        const control = document.createElement('input');
        control.type = 'range';
        control.id = id;
        control.min = String(min);
        control.max = String(max);
        control.step = String(step);
        const saved = Number(utils__storage_get(id));
        control.value = String(Number.isFinite(saved) && saved >= min && saved <= max ? saved : fallback);
        const value = make('output', '', 'irc-settings-range-value');
        const update = () =>
        {
            value.textContent = control.value + unit;
            apply(Number(control.value));
            utils__storage_set(id, control.value);
        };
        control.oninput = update;
        row.append(text, control, value);
        byId('local-settings-page-appearance').append(row);
        update();
        return control;
    }
    addRange('irc-message-width', 'chat message width', 'how much of the chat width a message may use', [30, 100, 5, 100], '%', percent => document.body.style.setProperty('--irc-message-width', percent + '%'));
    addRange('irc-picker-height', 'conversation list height', 'height of the list that opens from the conversation selector', [150, 800, 10, 420], ' px', pixels => document.body.style.setProperty('--irc-picker-height', pixels + 'px'));
    // its own row, so the button keeps its size and clicking it does not toggle a checkbox
    const testRow = make('div', '', 'irc-settings-actions');
    testRow.append(testSound);
    byId('local-settings-page-audio').append(testRow);
    const eventControls = new Map();
    for (const [key, label] of [['event_location', 'channel events'], ['error_location', 'server errors']])
    {
        const placeholder = addPreference('irc-' + key, label, key === 'event_location' ? 'where join, leave and nickname events appear' : 'where server refusals and connection errors appear');
        const choice = document.createElement('select');
        choice.id = placeholder.id;
        choice.className = 'text-input-pretty';
        choice.append(new Option('In chat', 'chat'), new Option('In log', 'log'));
        choice.value = key === 'event_location' ? eventLocation : errorLocation;
        placeholder.replaceWith(choice);
        choice.onchange = () =>
        {
            if (key === 'event_location')
            {
                eventLocation = choice.value;
            }
            else
            {
                errorLocation = choice.value;
            }
        };
        eventControls.set(key, choice);
    }
    // the ignore list sits below the other chat settings
    byId('local-settings-page-chat').append(ignoredSection);
    for (const [key, control] of Object.entries(preferenceControls))
    {
        control.disabled = false;
        control.title = '';
        // website previews stay off until the user turns them on
        control.checked = key === 'site_previews' ? utils__storage_get(key) === 'true' : utils__storage_get(key) !== 'false';
        preferences[key] = control.checked;
        control.onchange = () =>
        {
            preferences[key] = control.checked;
            if (key === 'typing' && !control.checked)
            {
                guard(() => client.sendTyping(current, false));
            }
            render();
        };
    }
    preferenceControls.avatars.closest('label').querySelector('.local-settings-hint').textContent = 'loads avatars shared by users through the network';
    preferenceControls.flags.closest('label').querySelector('.local-settings-hint').textContent = 'shows a reported user country, or their server location when available. Hover the flag to see which';
    preferenceControls.channel_counts.closest('label').querySelector('.local-settings-hint').textContent = 'shows the server count beside each channel name and updates it while you are joined';
    preferenceControls.roles.closest('label').querySelector('.local-settings-label').textContent = 'show IRC role icons in the channel list';
    preferenceControls.roles.closest('label').querySelector('.local-settings-hint').textContent = 'shows channel owners, admins, operators and voiced members beside their names';
    const colorControls = [];
    /**
     * @brief previews enabled colors and updates their controls
     *
     * @return void
     */
    function applyColors()
    {
        for (const choice of colorControls)
        {
            const property = '--irc-' + choice.key + '-color';
            if (/^#[0-9a-f]{6}$/i.test(choice.value))
            {
                document.body.style.setProperty(property, choice.value);
            }
            else
            {
                document.body.style.removeProperty(property);
            }
            document.body.classList.toggle('irc-color-' + choice.key, choice.enabled.checked);
            choice.input.value = choice.value || getComputedStyle(document.body).getPropertyValue('--irc-' + choice.key + '-default').trim();
            choice.input.disabled = !choice.enabled.checked;
        }
    }
    /**
     * @brief restores saved colors and their enabled state
     *
     * @return void
     */
    function restoreColors()
    {
        for (const choice of colorControls)
        {
            const value = utils__storage_get(choice.key + '_color') || '';
            choice.value = /^#[0-9a-f]{6}$/i.test(value) ? value : '';
            const enabled = utils__storage_get(choice.key + '_color_enabled');
            choice.enabled.checked = enabled === null ? choice.key === 'joined' : enabled === 'true';
        }
        applyColors();
    }
    for (const [key, label, hint] of [['joined', 'color joined channels', 'turn off to use the ordinary channel color'], ['client', 'custom color for other users', 'overrides nickname colors in the channel tree, member list and chat'], ['self', 'custom color for your name', 'overrides your nickname color in the channel tree, member list and chat']])
    {
        const row = make('div', '', 'local-settings-row');
        const text = make('label', '', 'local-settings-text');
        const enabled = document.createElement('input');
        enabled.type = 'checkbox';
        enabled.id = 'irc-settings-' + key + '-color-enabled';
        text.htmlFor = enabled.id;
        text.append(make('span', label, 'local-settings-label'), make('span', hint, 'local-settings-hint'));
        const input = document.createElement('input');
        input.type = 'color';
        input.id = 'irc-settings-' + key + '-color';
        input.setAttribute('aria-label', label + ' value');
        const choice = {key, enabled, input, value: ''};
        colorControls.push(choice);
        enabled.onchange = applyColors;
        input.oninput = () =>
        {
            choice.value = input.value;
            applyColors();
        };
        const reset = button('Reset', () =>
        {
            choice.value = '';
            enabled.checked = key === 'joined';
            applyColors();
        });
        reset.setAttribute('aria-label', 'Reset ' + label);
        const controls = make('div', '', 'irc-color-controls');
        controls.append(enabled, input, reset);
        row.append(text, controls);
        byId('local-settings-page-appearance').append(row);
    }
    restoreColors();
    const scale = byId('local-settings-chat-scale');
    const soundSetting = byId('local-settings-sound-effects');
    const logSetting = byId('local-settings-show-log');
    logSetting.disabled = false;
    logSetting.title = '';
    logSetting.closest('label').querySelector('.local-settings-hint').textContent = 'shows the log button at the bottom of the window';
    const applyLogSetting = () =>
    {
        logButton.style.display = logSetting.checked ? '' : 'none';
        if (!logSetting.checked)
        {
            showLog(false);
        }
    };
    logSetting.checked = utils__storage_get('show_log') !== 'false';
    logSetting.onchange = applyLogSetting;
    applyLogSetting();
    soundSetting.disabled = false;
    soundSetting.title = '';
    soundSetting.onchange = () => applySounds(soundSetting.checked, false);
    applySounds(g_are_sound_effects_enabled, false);
    scale.disabled = false;
    scale.title = '';
    scale.value = utils__storage_get('chat_scale') || '100';
    const applyScale = () =>
    {
        document.body.style.setProperty('--chat-scale', Number(scale.value) / 100);
        byId('local-settings-chat-scale-value').value = scale.value + '%';
    };
    scale.oninput = applyScale;
    applyScale();
    const resetScale = byId('local-settings-chat-scale-reset');
    resetScale.disabled = false;
    resetScale.title = 'Reset chat size to 100%';
    resetScale.onclick = () =>
    {
        scale.value = '100';
        applyScale();
    };
    const save = byId('local-settings-close-button');
    save.disabled = false;
    save.title = 'Save local preferences';
    save.onclick = () =>
    {
        for (const [name, control] of soundControls)
        {
            utils__storage_set('sound_' + name, String(control.checked));
        }
        for (const [key, choice] of eventControls)
        {
            utils__storage_set(key, choice.value);
        }
        for (const [key, control] of Object.entries(preferenceControls))
        {
            utils__storage_set(key, String(control.checked));
        }
        utils__storage_set('chat_scale', scale.value);
        utils__storage_set('show_log', String(logSetting.checked));
        for (const choice of colorControls)
        {
            utils__storage_set(choice.key + '_color', choice.value);
            utils__storage_set(choice.key + '_color_enabled', String(choice.enabled.checked));
        }
        applySounds(soundSetting.checked, true);
        settings.style.display = 'none';
    };
    byId('local-settings-x-button').onclick = () =>
    {
        for (const [name, control] of soundControls)
        {
            control.checked = utils__storage_get('sound_' + name) === null ? name !== 'message_sent' : utils__storage_get('sound_' + name) !== 'false';
            soundPreferences[name] = control.checked;
        }
        for (const [key, choice] of eventControls)
        {
            choice.value = utils__storage_get(key) === 'log' ? 'log' : 'chat';
            choice.onchange();
        }
        for (const [key, control] of Object.entries(preferenceControls))
        {
            // website previews stay off until the user turns them on
        control.checked = key === 'site_previews' ? utils__storage_get(key) === 'true' : utils__storage_get(key) !== 'false';
            preferences[key] = control.checked;
        }
        render();
        restoreColors();
        scale.value = utils__storage_get('chat_scale') || '100';
        applyScale();
        applySounds(utils__storage_get('sounds') !== 'false', false);
        logSetting.checked = utils__storage_get('show_log') !== 'false';
        applyLogSetting();
        settings.style.display = 'none';
    };
    byId('local-settings-button').onclick = () =>
    {
        applyColors();
        settings.style.display = isMobileTheme() ? 'flex' : 'block';
        settings.style.position = 'fixed';
        settings.style.transform = 'none';
        settings.style.left = Math.max(8, (innerWidth - settings.offsetWidth) / 2) + 'px';
        settings.style.top = Math.max(8, (innerHeight - settings.offsetHeight) / 2) + 'px';
    };
    for (const tab of settings.querySelectorAll('.local-settings-tab'))
    {
        tab.onclick = () =>
        {
            byId('local-settings-section-select').value = tab.id;
            for (const choice of settings.querySelectorAll('.local-settings-tab'))
            {
                choice.setAttribute('aria-selected', String(choice === tab));
                byId(choice.getAttribute('aria-controls')).hidden = choice !== tab;
            }
        };
    }
    byId('local-settings-section-select').disabled = false;
    byId('local-settings-section-select').title = '';
    byId('local-settings-section-select').onchange = event => byId(event.target.value).click();
    for (const row of settings.querySelectorAll('.local-settings-row'))
    {
        row.hidden = ![...row.querySelectorAll('input, select, button')].some(control => !control.disabled);
    }
    byId('local-settings-webrtc-note').hidden = true;
    for (const tab of settings.querySelectorAll('.local-settings-tab'))
    {
        const page = byId(tab.getAttribute('aria-controls'));
        if (![...page.querySelectorAll('.local-settings-row')].some(row => !row.hidden))
        {
            tab.hidden = true;
            byId('local-settings-section-select').querySelector('option[value="' + tab.id + '"]').remove();
        }
    }
    let theme = matchMedia('(pointer: coarse)').matches ? 'default-mobile' : 'default';
    try
    {
        const saved = localStorage.getItem('lemon-irc-theme');
        if (['default', 'hybrid', 'hybrid-v2', 'aero', 'termix', 'ozone', 'default-mobile', 'mobile-2'].includes(saved))
        {
            theme = saved;
        }
    }
    catch (error)
    {
        console.warn('Could not read theme preference', error.message);
    }
    selectTheme(theme);
    showConnectionState();
    connect();
    render();
    document.addEventListener('visibilitychange', () =>
    {
        refreshActivity();
        scheduleConnectionTimes();
    });
    treeView.container.addEventListener('scroll', scheduleConnectionTimes);
    byId('member-list-body').addEventListener('scroll', scheduleConnectionTimes);
});
