(function(root)
{
    /**
     * @brief validates a web link before opening or loading it
     *
     * @param string value -> supplied link
     * @param boolean remote -> require https and reject local addresses
     *
     * @return URL|null accepted link
     */
    function url(value, remote = false)
    {
        try
        {
            const parsed = new URL(value);
            if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password)
            {
                return null;
            }
            if (remote)
            {
                const host = parsed.hostname.toLowerCase();
                if (parsed.protocol !== 'https:' || parsed.port || !host.includes('.') || host.includes(':') || host.endsWith('.localhost') || host.endsWith('.local') || /^(127|10|0|169\.254|192\.168|172\.(1[6-9]|2\d|3[01]))\./.test(host))
                {
                    return null;
                }
            }
            return parsed;
        }
        catch (error)
        {
            return null;
        }
    }

    /**
     * @brief selects a preview for a supported media link
     *
     * @param string value -> supplied link
     *
     * @return object|null preview type and source
     */
    function preview(value)
    {
        const parsed = url(value, true);
        if (!parsed)
        {
            return null;
        }
        if (/\.(png|jpe?g|gif|webp|avif)$/i.test(parsed.pathname))
        {
            return {type: 'image', source: parsed.href};
        }
        if (/\.(mp3|ogg|opus|wav|m4a)$/i.test(parsed.pathname))
        {
            return {type: 'audio', source: parsed.href};
        }
        if (/\.(mp4|webm)$/i.test(parsed.pathname))
        {
            return {type: 'video', source: parsed.href};
        }
        const host = parsed.hostname.replace(/^www\./, '');
        const id = host === 'youtu.be' ? parsed.pathname.slice(1) : (host === 'youtube.com' ? (parsed.searchParams.get('v') || /^\/shorts\/([^/]+)/.exec(parsed.pathname)?.[1]) : null);
        if (id && /^[A-Za-z0-9_-]{11}$/.test(id))
        {
            return {type: 'image', source: 'https://i.ytimg.com/vi/' + id + '/hqdefault.jpg', title: 'YouTube video'};
        }
        return null;
    }

    /**
     * @brief creates an image without cookies or a referrer
     *
     * @param string value -> image address
     * @param string description -> alternative text
     *
     * @return HTMLImageElement|null image or rejected address
     */
    function image(value, description)
    {
        const parsed = url(value.replaceAll('{size}', '64'), true);
        if (!parsed)
        {
            return null;
        }
        const node = document.createElement('img');
        node.alt = description;
        node.referrerPolicy = 'no-referrer';
        node.crossOrigin = 'anonymous';
        node.loading = 'lazy';
        node.decoding = 'async';
        node.src = parsed.href;
        node.onerror = () => node.remove();
        return node;
    }

    /**
     * @brief shortens a link for display: host and path, without the scheme, www and long tails
     *
     * @param URL parsed -> accepted link
     *
     * @return string readable label
     */
    function label(parsed)
    {
        const host = parsed.hostname.replace(/^www\./, '');
        let rest = (parsed.pathname + parsed.search).replace(/\/$/, '');
        try
        {
            rest = decodeURIComponent(parsed.pathname + parsed.search).replace(/\/$/, '');
        }
        catch (error)
        {
            // keep the encoded form
        }
        const text = host + rest;
        return text.length > 60 ? text.slice(0, 57) + '…' : text;
    }

    /**
     * @brief renders text with links and optional media previews
     *
     * @param string text -> message body
     * @param boolean previews -> allow up to three image, audio or video previews
     * @param boolean sites -> mark other links for a website preview card
     *
     * @return DocumentFragment message contents
     */
    function render(text, previews, sites = false)
    {
        const fragment = document.createDocumentFragment();
        let offset = 0;
        let count = 0;
        for (const match of text.matchAll(/https?:\/\/[^\s<>]+/gi))
        {
            const value = match[0].replace(/[.,!?;:)\]]+$/, '');
            const parsed = url(value);
            if (!parsed)
            {
                continue;
            }
            fragment.append(document.createTextNode(text.slice(offset, match.index)));
            const link = document.createElement('a');
            link.href = parsed.href;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.className = 'irc-link';
            link.title = parsed.href;
            link.textContent = label(parsed);
            fragment.append(link);
            const media = previews && count < 3 ? preview(value) : null;
            if (!media && sites && count < 3 && url(value, true))
            {
                // page.js fills this with the page's title, description and picture
                const pending = document.createElement('span');
                pending.className = 'chat-link-previews irc-site-preview';
                pending.dataset.previewUrl = parsed.href;
                fragment.append(pending);
                count++;
            }
            if (media)
            {
                const container = document.createElement('span');
                container.className = 'chat-link-previews';
                if (media.type === 'image')
                {
                    const thumbnail = image(media.source, media.title || 'Shared image');
                    const card = link.cloneNode(false);
                    card.className = 'chat-link-preview';
                    card.append(thumbnail);
                    container.append(card);
                }
                else
                {
                    const player = document.createElement(media.type);
                    player.controls = true;
                    player.preload = 'none';
                    player.crossOrigin = 'anonymous';
                    player.src = media.source;
                    container.append(player);
                }
                fragment.append(container);
                count++;
            }
            offset = match.index + value.length;
        }
        fragment.append(document.createTextNode(text.slice(offset)));
        return fragment;
    }

    root.LemonIrc.Media = {url, preview, image, render, label};
    if (typeof module !== 'undefined')
    {
        module.exports = root.LemonIrc.Media;
    }
})(globalThis);
