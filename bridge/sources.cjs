// collects IRC network listings from public directories and picks a working server on demand
const fs = require('node:fs');
const net = require('node:net');
const tls = require('node:tls');

const DAY = 24 * 60 * 60 * 1000;
const HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;

/**
 * @brief downloads a page as text with a timeout
 *
 * @param string url -> page address
 * @param number timeout -> milliseconds before giving up
 *
 * @return Promise<string> page body
 */
async function download(url, timeout = 15000)
{
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try
    {
        const response = await fetch(url, {signal: controller.signal, headers: {'User-Agent': 'Mozilla/5.0 (compatible; Lemon IRC server list)', 'Accept-Language': 'en'}});
        if (!response.ok)
        {
            throw new Error(url + ' answered ' + response.status);
        }
        return await response.text();
    }
    finally
    {
        clearTimeout(timer);
    }
}

/**
 * @brief removes tags and html entities from a fragment
 *
 * @param string html -> markup
 *
 * @return string plain text
 */
function text(html)
{
    const named = {amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', ndash: '–', mdash: '—'};
    return html.replace(/<[^>]*>/g, ' ').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, code) =>
    {
        if (code[0] === '#')
        {
            const value = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
            return value > 0 && value < 0x110000 ? String.fromCodePoint(value) : entity;
        }
        return named[code.toLowerCase()] ?? entity;
    }).replace(/\s+/g, ' ').trim();
}

/**
 * @brief reduces a network name to the key used to merge listings
 *
 * @param string name -> network name
 *
 * @return string comparison key
 */
function key(name)
{
    return name.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/(irc|network|net)$/, '') || name.toLowerCase();
}

/**
 * @brief turns a network name into an identifier the bridge accepts
 *
 * @param string name -> network name
 *
 * @return string identifier
 */
function slug(name)
{
    return ('x-' + name.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')).slice(0, 40);
}

/**
 * @brief splits "host" or "host:port" into a server candidate
 *
 * @param string value -> address text
 *
 * @return object|null host and optional port
 */
function address(value)
{
    const match = /^([a-z0-9.-]+)(?::\+?(\d{2,5}))?$/i.exec(value.trim());
    if (!match || !HOST.test(match[1]))
    {
        return null;
    }
    return {host: match[1].toLowerCase(), port: match[2] ? Number(match[2]) : 0};
}

// source parsers, each returns [{name, users?, description?, site?, servers: [{host, port, tls?}]}]
const parsers =
{
    async ircbits()
    {
        const html = await download('https://ircbits.com/articles/irc-networks-overview');
        const found = [];
        for (const row of html.match(/<tr[\s\S]*?<\/tr>/gi) || [])
        {
            const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(match => match[1]);
            if (cells.length < 4)
            {
                continue;
            }
            const servers = [...cells[3].matchAll(/<code>([\s\S]*?)<\/code>/gi)].map(match => address(text(match[1]))).filter(Boolean);
            const site = /href="(https?:\/\/[^"]+)"/i.exec(cells[5] || '')?.[1];
            found.push({name: text(cells[0]), users: Number(text(cells[1]).replace(/[^\d]/g, '')) || 0, description: text(cells[4] || ''), site, servers});
        }
        return found;
    },
    async irchelp()
    {
        const html = await download('https://www.irchelp.org/networks/popular.html');
        const found = [];
        for (const block of html.split(/<h3\b/i).slice(1))
        {
            const name = text(/<a\b[^>]*>([\s\S]*?)<\/a>/i.exec(block)?.[1] || '');
            if (!name)
            {
                continue;
            }
            const servers = [];
            for (const match of block.matchAll(/<b>Servers:<\/b>\s*([^<]+)/gi))
            {
                for (const part of match[1].split(','))
                {
                    const server = address(part);
                    if (server)
                    {
                        servers.push(server);
                    }
                }
            }
            const description = text(/<b>Information:<\/b>(?:<br\s*\/?>)?([\s\S]*?)<\/p>/i.exec(block)?.[1] || '');
            const site = /<a href="(https?:\/\/[^"]+)"/i.exec(block)?.[1];
            found.push({name, description, site, servers});
        }
        return found;
    },
    async netsplit()
    {
        const [list, top] = await Promise.all([download('https://netsplit.de/networks/'), download('https://netsplit.de/networks/top100.php').catch(() => '')]);
        const users = new Map();
        for (const match of top.matchAll(/<a\b[^>]*href="\/networks\/([^/"]+)\/"[^>]*>[^<]*<\/a><\/td>\s*<td[^>]*>(\d+)<\/td>/gi))
        {
            users.set(decodeURIComponent(match[1]), Number(match[2]));
        }
        const found = [];
        const seen = new Set();
        for (const match of list.matchAll(/<a\b[^>]*href="\/networks\/([^/"?]+)\/"[^>]*>([^<]+)<\/a>/gi))
        {
            const name = text(match[2]);
            const id = decodeURIComponent(match[1]);
            if (seen.has(id))
            {
                continue;
            }
            seen.add(id);
            found.push({name, netsplit: id, users: users.get(id) || 0, servers: []});
        }
        return found;
    },
    async ircnet()
    {
        const data = JSON.parse(await download('https://bot.ircnet.info/api/v2/serversByCountry'));
        const servers = [];
        for (const country of data.countriesWithServers || [])
        {
            for (const server of country.serverList || [])
            {
                // only open servers accept users from any country
                if (server.open && HOST.test(server.serverName || ''))
                {
                    const host = server.serverName.toLowerCase();
                    servers.push({host, port: /ssl/i.test(host + server.version) ? 6697 : 6667, tls: /ssl/i.test(host + server.version) ? true : undefined, users: server.userCount || 0});
                }
            }
        }
        servers.sort((a, b) => b.users - a.users);
        return [{name: 'IRCnet', description: 'One of the oldest IRC networks. Only open servers accept users from any country', servers: servers.map(({host, port, tls: secure}) => ({host, port, tls: secure}))}];
    }
};

/**
 * @brief reads the server table netsplit.de keeps for one network
 *
 * @param string id -> netsplit network name
 *
 * @return Promise<array> server candidates
 */
async function netsplitServers(id)
{
    const html = await download('https://netsplit.de/servers/?net=' + encodeURIComponent(id));
    const table = html.split(/servers last connected to/i)[0];
    const servers = [];
    for (const match of table.matchAll(/<tr><td[^>]*>([^<]+)<\/td><td[^>]*>(\d+)<\/td><td[^>]*>(on|off)<\/td>/gi))
    {
        const server = address(match[1]);
        if (server)
        {
            servers.push({host: server.host, port: Number(match[2]), tls: match[3].toLowerCase() === 'on'});
        }
    }
    return servers;
}

/**
 * @brief checks whether an IRC server accepts a connection, verifying its certificate for TLS
 *
 * @param object server -> host, port and tls flag
 *
 * @return Promise<boolean> whether the connection succeeded
 */
function probe(server)
{
    return new Promise(resolve =>
    {
        const socket = server.tls ? tls.connect({host: server.host, port: server.port, servername: server.host, rejectUnauthorized: true}) : net.connect({host: server.host, port: server.port});
        const finish = result =>
        {
            clearTimeout(timer);
            socket.destroy();
            resolve(result);
        };
        const timer = setTimeout(() => finish(false), 6000);
        socket.once(server.tls ? 'secureConnect' : 'connect', () => finish(true));
        socket.once('error', () => finish(false));
    });
}

/**
 * @brief keeps a merged, cached directory of IRC networks
 *
 * @param object options -> builtin verified networks and cache file path
 *
 * @return object directory with list, refresh and resolve
 */
function createDirectory({builtin, cacheFile})
{
    let cache = {updated: 0, sources: {}, networks: []};
    try
    {
        cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    }
    catch (error)
    {
        // first start
    }
    let refreshing = null;
    const resolving = new Map();

    /**
     * @brief merges built-in and collected entries into one list sorted by users
     *
     * @return array networks
     */
    function list()
    {
        const merged = new Map();
        for (const entry of builtin)
        {
            merged.set(key(entry.name), {...entry, ready: true, verified: true, servers: []});
        }
        for (const entry of cache.networks)
        {
            const known = merged.get(key(entry.name));
            if (known)
            {
                known.users = Math.max(known.users || 0, entry.users || 0);
                known.sources = [...new Set([...(known.sources || []), ...entry.sources])];
                if (!known.verified && entry.ready && !known.ready)
                {
                    Object.assign(known, {host: entry.host, port: entry.port, tls: entry.tls, ready: true});
                }
                continue;
            }
            merged.set(key(entry.name), {...entry, ready: Boolean(entry.ready)});
        }
        return [...merged.values()].sort((a, b) => ((b.users || 0) - (a.users || 0)) || (Boolean(b.verified) - Boolean(a.verified)) || a.name.localeCompare(b.name));
    }

    /**
     * @brief downloads every source and stores the merged result
     *
     * @return Promise<void> refresh finished
     */
    function refresh()
    {
        if (refreshing)
        {
            return refreshing;
        }
        refreshing = (async () =>
        {
            const merged = new Map();
            const sources = {};
            const results = await Promise.allSettled(Object.entries(parsers).map(async ([source, parse]) => [source, await parse()]));
            for (const result of results)
            {
                if (result.status !== 'fulfilled')
                {
                    continue;
                }
                const [source, entries] = result.value;
                sources[source] = entries.length;
                for (const entry of entries)
                {
                    if (!entry.name || entry.name.length > 60)
                    {
                        continue;
                    }
                    const id = key(entry.name);
                    const known = merged.get(id) || {id: slug(entry.name), name: entry.name, description: '', users: 0, servers: [], sources: []};
                    known.users = Math.max(known.users, entry.users || 0);
                    known.description = known.description || entry.description || '';
                    known.site = known.site || entry.site;
                    known.netsplit = known.netsplit || entry.netsplit;
                    known.sources.push(source);
                    for (const server of entry.servers)
                    {
                        if (!known.servers.some(existing => existing.host === server.host && existing.port === server.port))
                        {
                            known.servers.push(server);
                        }
                    }
                    merged.set(id, known);
                }
            }
            // keep earlier resolved servers so a refresh does not undo a working choice
            for (const old of cache.networks)
            {
                const fresh = merged.get(key(old.name));
                if (fresh && old.ready)
                {
                    Object.assign(fresh, {host: old.host, port: old.port, tls: old.tls, ready: true});
                }
            }
            if (merged.size)
            {
                cache = {updated: Date.now(), sources, networks: [...merged.values()]};
                fs.writeFile(cacheFile, JSON.stringify(cache), () => {});
            }
        })().finally(() =>
        {
            refreshing = null;
        });
        return refreshing;
    }

    /**
     * @brief finds a working server for a collected network, preferring verified TLS
     *
     * @param string id -> network identifier
     *
     * @return Promise<object> network with host, port and tls, or an error message
     */
    function resolve(id)
    {
        const entry = list().find(network => network.id === id);
        if (!entry)
        {
            return Promise.resolve({error: 'Unknown network'});
        }
        if (entry.ready)
        {
            return Promise.resolve(entry);
        }
        if (resolving.has(id))
        {
            return resolving.get(id);
        }
        const task = (async () =>
        {
            let candidates = [...entry.servers];
            if (entry.netsplit)
            {
                candidates.push(...await netsplitServers(entry.netsplit).catch(() => []));
            }
            // a host without a known port is tried with TLS on 6697, then plain on 6667
            const tries = [];
            for (const server of candidates)
            {
                if (server.port && server.tls !== undefined)
                {
                    tries.push({host: server.host, port: server.port, tls: server.tls});
                }
                else if (server.port)
                {
                    tries.push({host: server.host, port: server.port, tls: [6697, 7000, 9999, 6698].includes(server.port)});
                }
                else
                {
                    tries.push({host: server.host, port: 6697, tls: true}, {host: server.host, port: 6667, tls: false});
                }
            }
            const unique = tries.filter((server, index) => tries.findIndex(other => other.host === server.host && other.port === server.port) === index);
            unique.sort((a, b) => b.tls - a.tls);
            for (const server of unique.slice(0, 8))
            {
                if (await probe(server))
                {
                    const stored = cache.networks.find(network => network.id === id);
                    if (stored)
                    {
                        Object.assign(stored, server, {ready: true});
                        fs.writeFile(cacheFile, JSON.stringify(cache), () => {});
                    }
                    return {...entry, ...server, ready: true};
                }
            }
            return {error: unique.length ? 'None of the ' + Math.min(unique.length, 8) + ' known servers of ' + entry.name + ' answered' : 'No server address is known for ' + entry.name};
        })().finally(() => resolving.delete(id));
        resolving.set(id, task);
        return task;
    }

    if (Date.now() - cache.updated > DAY)
    {
        refresh().catch(() => {});
    }
    const timer = setInterval(() => refresh().catch(() => {}), DAY);
    timer.unref();
    return {list, refresh, resolve, status: () => ({updated: cache.updated, sources: cache.sources, refreshing: Boolean(refreshing)})};
}

module.exports = {createDirectory, parsers, netsplitServers, key};
