/**
 * @brief creates a conversation dropdown with separate unread badges
 *
 * @param object context -> conversation state and shared element helpers
 *
 * @return object dropdown renderer
 */
LemonIrc.createConversationPicker = function(context)
{
    const {make, choose, current, conversations, newChat} = context;
    const trigger = make('button', '', 'irc-conversation-picker');
    trigger.id = 'irc-conversation-picker';
    trigger.type = 'button';
    trigger.setAttribute('role', 'combobox');
    trigger.setAttribute('aria-label', 'Open conversations');
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-controls', 'irc-conversation-list');
    const popup = make('div', '', 'irc-conversation-popup');
    popup.hidden = true;
    const search = document.createElement('input');
    search.type = 'search';
    search.placeholder = 'Find a conversation';
    search.ariaLabel = 'Find a conversation';
    search.className = 'text-input-pretty';
    const list = make('div', '', 'irc-conversation-list');
    list.id = 'irc-conversation-list';
    list.setAttribute('role', 'listbox');
    list.ariaLabel = 'Conversations';
    popup.append(search, list);
    document.body.append(popup);
    document.getElementById('chat-context-select').before(trigger);
    // starts a private chat with someone who shares no channel
    const add = make('button', '+', 'irc-conversation-new');
    add.id = 'irc-conversation-new';
    add.type = 'button';
    add.title = 'New private chat';
    add.setAttribute('aria-label', 'New private chat');
    trigger.after(add);
    const label = conversation => conversation.id.startsWith('channel:') && conversation.name.startsWith('#') ? conversation.name.slice(1) : conversation.name;
    // a hash for channels and a person outline for private chats, drawn in the theme's text color
    const kindIcon = conversation =>
    {
        const channel = conversation.id.startsWith('channel:');
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('class', 'irc-conversation-kind');
        svg.setAttribute('aria-hidden', 'true');
        svg.innerHTML = channel ? '<path d="M9 4 7 20M17 4l-2 16M4.5 9h16M3.5 15h16"/>' : '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/>';
        return svg;
    };
    const badge = count =>
    {
        const node = make('span', String(count), 'irc-unread-badge');
        node.ariaLabel = count + ' unread messages';
        return node;
    };
    const close = () =>
    {
        popup.hidden = true;
        trigger.setAttribute('aria-expanded', 'false');
    };
    let signature = '';
    const render = () =>
    {
        const entries = [...conversations().values()].filter(entry => entry.id !== 'network');
        const active = entries.find(entry => entry.id === current());
        const total = entries.reduce((count, entry) => count + (entry.id === current() ? 0 : entry.unread), 0);
        trigger.replaceChildren(...(active ? [kindIcon(active)] : []), make('span', active ? label(active) : 'Choose a conversation', 'irc-conversation-name'));
        if (total)
        {
            trigger.append(badge(total));
        }
        const arrow = make('span', '', 'irc-conversation-arrow');
        arrow.setAttribute('aria-hidden', 'true');
        trigger.append(arrow);
        const state = JSON.stringify([current(), search.value, entries.map(entry => [entry.id, entry.name, entry.unread])]);
        if (state === signature)
        {
            return;
        }
        signature = state;
        const focused = document.activeElement?.dataset.context;
        list.replaceChildren();
        // channels first, then private chats, each under its own heading
        const ordered = [...entries.filter(entry => entry.id.startsWith('channel:')), ...entries.filter(entry => !entry.id.startsWith('channel:'))];
        let section = '';
        for (const entry of ordered)
        {
            const name = label(entry);
            if (!name.toLowerCase().includes(search.value.toLowerCase()))
            {
                continue;
            }
            const kind = entry.id.startsWith('channel:') ? 'channels' : 'people';
            if (kind !== section)
            {
                section = kind;
                list.append(make('p', kind, 'irc-conversation-section'));
            }
            const option = make('button', '', 'irc-conversation-option');
            option.type = 'button';
            option.dataset.context = entry.id;
            option.setAttribute('role', 'option');
            option.setAttribute('aria-selected', String(entry.id === current()));
            option.append(kindIcon(entry), make('span', name, 'irc-conversation-name'));
            if (entry.id !== current() && entry.unread)
            {
                option.append(badge(entry.unread));
            }
            option.onclick = () =>
            {
                close();
                choose(entry.id);
                trigger.focus();
            };
            list.append(option);
            if (entry.id === focused)
            {
                option.focus({preventScroll: true});
            }
        }
        // a typed nickname can be messaged even when no conversation exists yet
        const typed = search.value.trim();
        if (typed && !/[\s,]/.test(typed) && !/^[#&+!]/.test(typed) && !entries.some(entry => entry.name.toLowerCase() === typed.toLowerCase()))
        {
            const message = make('button', '', 'irc-conversation-option irc-conversation-message');
            message.type = 'button';
            message.setAttribute('role', 'option');
            message.setAttribute('aria-selected', 'false');
            message.append(make('span', 'Message ' + typed + '…', 'irc-conversation-name'));
            message.onclick = () =>
            {
                close();
                newChat(typed);
            };
            list.append(message);
        }
        else if (!list.querySelector('[role="option"]'))
        {
            list.append(make('p', entries.length ? 'No matching conversations' : 'Join a channel or start a private chat'));
        }
    };
    const open = () =>
    {
        search.value = '';
        render();
        popup.hidden = false;
        trigger.setAttribute('aria-expanded', 'true');
        const rect = trigger.getBoundingClientRect();
        popup.style.width = Math.min(innerWidth - 16, Math.max(260, rect.width)) + 'px';
        popup.style.left = Math.max(8, Math.min(rect.left, innerWidth - popup.offsetWidth - 8)) + 'px';
        popup.style.top = Math.max(8, Math.min(rect.bottom + 4, innerHeight - popup.offsetHeight - 8)) + 'px';
        search.focus({preventScroll: true});
    };
    trigger.onclick = () => popup.hidden ? open() : close();
    add.onclick = () =>
    {
        const typed = popup.hidden ? '' : search.value.trim();
        close();
        newChat(typed);
    };
    trigger.onkeydown = event =>
    {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp')
        {
            event.preventDefault();
            open();
            list.querySelector('[aria-selected="true"]')?.focus();
        }
    };
    search.oninput = render;
    search.onkeydown = event =>
    {
        // enter opens the only match or messages the typed nickname
        if (event.key === 'Enter')
        {
            const options = [...list.querySelectorAll('[role="option"]')];
            if (options.length === 1)
            {
                event.preventDefault();
                options[0].click();
            }
        }
    };
    popup.onkeydown = event =>
    {
        if (event.key === 'Escape')
        {
            event.preventDefault();
            close();
            trigger.focus();
        }
        else if (event.key === 'ArrowDown' || event.key === 'ArrowUp')
        {
            const options = [...list.querySelectorAll('[role="option"]')];
            const index = options.indexOf(document.activeElement);
            event.preventDefault();
            options[(index + options.length + (event.key === 'ArrowDown' ? 1 : -1)) % options.length]?.focus();
        }
    };
    document.addEventListener('pointerdown', event =>
    {
        if (!trigger.contains(event.target) && !popup.contains(event.target) && !add.contains(event.target))
        {
            close();
        }
    });
    document.addEventListener('focusin', event =>
    {
        if (!trigger.contains(event.target) && !popup.contains(event.target))
        {
            close();
        }
    });
    window.addEventListener('resize', close);
    return {render, close};
};
