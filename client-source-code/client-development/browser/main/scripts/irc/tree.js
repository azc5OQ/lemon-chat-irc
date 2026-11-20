// visible tree rows
LemonIrc.Tree = class
{
    constructor(container, createRow)
    {
        this.container = container;
        this.createRow = createRow;
        this.entries = [];
        this.offsets = [0];
        this.heights = new Map();
        this.theme = '';
        this.first = -1;
        this.last = -1;
        this.search = '';
        this.searchTime = 0;
        container.tabIndex = 0;
        container.title = 'Double click a channel to join. Expand it to see available members. Type a channel name to find it';
        container.addEventListener('scroll', () => this.draw());
        container.addEventListener('keydown', event => this.keydown(event));
        new ResizeObserver(() => this.draw(true)).observe(container);
    }

    setEntries(entries)
    {
        const scroll = this.container.scrollTop;
        this.entries = entries;
        if (this.theme !== document.body.dataset.ircTheme)
        {
            this.heights.clear();
            this.theme = document.body.dataset.ircTheme;
        }
        for (const entry of entries)
        {
            if (!this.heights.has(entry.type))
            {
                const row = this.createRow(entry);
                row.style.visibility = 'hidden';
                this.container.append(row);
                const style = getComputedStyle(row);
                this.heights.set(entry.type, Math.max(20, row.getBoundingClientRect().height + parseFloat(style.marginTop || 0) + parseFloat(style.marginBottom || 0)));
                row.remove();
            }
        }
        this.offsets = new Float64Array(entries.length + 1);
        for (let index = 0; index < entries.length; index++)
        {
            this.offsets[index + 1] = this.offsets[index] + this.heights.get(entries[index].type);
        }
        this.draw(true, scroll);
    }

    indexAt(offset)
    {
        let low = 0;
        let high = this.entries.length;
        while (low < high)
        {
            const middle = Math.floor((low + high) / 2);
            if (this.offsets[middle] < offset)
            {
                low = middle + 1;
            }
            else
            {
                high = middle;
            }
        }
        return Math.max(0, low - 1);
    }

    draw(force = false, scroll = this.container.scrollTop)
    {
        const first = Math.max(0, this.indexAt(scroll) - 12);
        const last = Math.min(this.entries.length, this.indexAt(scroll + this.container.clientHeight) + 14);
        if (!force && first === this.first && last === this.last)
        {
            return;
        }
        this.first = first;
        this.last = last;
        const activeKey = this.container.contains(document.activeElement) ? document.activeElement.closest('[data-irc-tree-key]')?.dataset.ircTreeKey : null;
        const fragment = document.createDocumentFragment();
        const spacer = height =>
        {
            const node = document.createElement('div');
            node.className = 'irc-tree-spacer';
            node.style.height = height + 'px';
            node.setAttribute('aria-hidden', 'true');
            return node;
        };
        fragment.append(spacer(this.offsets[first] || 0));
        for (let index = first; index < last; index++)
        {
            const row = this.createRow(this.entries[index]);
            row.dataset.ircTreeRow = String(index);
            const entry = this.entries[index];
            row.dataset.ircTreeKey = entry.type === 'member' ? entry.channel.id + ':' + entry.member.user.id : (entry.id || 'network');
            fragment.append(row);
        }
        fragment.append(spacer(this.offsets[this.entries.length] - (this.offsets[last] || 0)));
        this.container.replaceChildren(fragment);
        this.container.scrollTop = scroll;
        if (activeKey)
        {
            [...this.container.children].find(row => row.dataset.ircTreeKey === activeKey)?.focus({preventScroll: true});
        }
    }

    focus(index)
    {
        if (!this.entries.length)
        {
            return;
        }
        index = Math.max(0, Math.min(this.entries.length - 1, index));
        this.draw(true, this.offsets[index]);
        this.container.querySelector('[data-irc-tree-row="' + index + '"]')?.focus({preventScroll: true});
    }

    /**
     * @brief scrolls the list so the row of an entry is visible, without moving the keyboard focus
     *
     * @param string id -> entry identifier, for example channel:#name
     *
     * @return void
     */
    reveal(id)
    {
        const index = this.entries.findIndex(entry => entry.id === id);
        if (index < 0)
        {
            return;
        }

        // already visible
        const view = this.container.scrollTop;
        if (this.offsets[index] >= view && this.offsets[index + 1] <= view + this.container.clientHeight)
        {
            return;
        }

        // a third from the top
        this.draw(true, Math.max(0, this.offsets[index] - this.container.clientHeight / 3));
    }

    keydown(event)
    {
        if (event.ctrlKey || event.metaKey || event.altKey || event.target.closest('input, textarea'))
        {
            return;
        }
        const row = event.target.closest('[data-irc-tree-row]');
        const index = Number(row?.dataset.ircTreeRow || 0);
        const movement = {ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: this.entries.length - 1};
        if (event.key in movement)
        {
            event.preventDefault();
            this.focus(movement[event.key]);
            return;
        }
        if (event.key.length === 1 && event.key !== ' ')
        {
            event.preventDefault();
            this.search = (Date.now() - this.searchTime < 1500 ? this.search : '') + event.key.toLowerCase();
            this.searchTime = Date.now();
            const explicitPrefix = '#&+!'.includes(this.search[0]);
            const label = entry => (explicitPrefix ? entry.label : entry.label.slice(1)).toLowerCase();
            let match = this.entries.findIndex(entry => entry.type === 'channel' && label(entry) === this.search);
            if (match < 0)
            {
                match = this.entries.findIndex(entry => entry.type === 'channel' && label(entry).startsWith(this.search));
            }
            if (match >= 0)
            {
                this.focus(match);
            }
        }
    }
};
