const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const tls = require('node:tls');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {WebSocketServer} = require('../vendor/ws');
const {createDirectory} = require('./sources.cjs');

const previewCache = new Map();

/**
 * @brief decodes the html entities found in page titles and descriptions
 *
 * @param string text -> raw attribute or element text
 *
 * @return string plain text
 */
function decodeEntities(text)
{
    const named = {amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“'};
    return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, code) =>
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
 * @brief reads the title, description, site name and picture of a web page
 *
 * @param string address -> http or https page address
 *
 * @return Promise<object> preview fields, empty when the page offers none
 */
function linkPreview(address)
{
    let target;
    try
    {
        target = new URL(address);
    }
    catch (error)
    {
        return Promise.resolve({});
    }
    if (!['http:', 'https:'].includes(target.protocol) || /^(localhost|127\.|0\.|\[)/i.test(target.hostname))
    {
        return Promise.resolve({});
    }
    if (previewCache.has(target.href))
    {
        return previewCache.get(target.href);
    }
    const task = (async () =>
    {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8000);
        try
        {
            const response = await fetch(target.href, {signal: controller.signal, redirect: 'follow', headers: {'User-Agent': 'Mozilla/5.0 (compatible; Lemon IRC link preview)', 'Accept': 'text/html,application/xhtml+xml', 'Accept-Language': 'en'}});
            if (!response.ok || !/html/i.test(response.headers.get('content-type') || ''))
            {
                return {};
            }
            // the head of a page is enough, so reading stops after 512 KB
            const reader = response.body.getReader();
            const chunks = [];
            let size = 0;
            while (size < 524288)
            {
                const {done, value} = await reader.read();
                if (done)
                {
                    break;
                }
                chunks.push(value);
                size += value.length;
                if (Buffer.concat(chunks).toString('utf8').includes('</head>'))
                {
                    break;
                }
            }
            reader.cancel().catch(() => {});
            const html = Buffer.concat(chunks).toString('utf8');
            const meta = name =>
            {
                for (const tag of html.match(/<meta\b[^>]*>/gi) || [])
                {
                    const key = /\b(?:property|name)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
                    if (key && key.toLowerCase() === name)
                    {
                        const content = /\bcontent\s*=\s*"([^"]*)"|\bcontent\s*=\s*'([^']*)'/i.exec(tag);
                        if (content)
                        {
                            return decodeEntities(content[1] ?? content[2]);
                        }
                    }
                }
                return '';
            };
            const title = meta('og:title') || meta('twitter:title') || decodeEntities(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] || '');
            const description = meta('og:description') || meta('twitter:description') || meta('description');
            let image = meta('og:image') || meta('og:image:url') || meta('twitter:image');
            try
            {
                image = image ? new URL(image, response.url || target.href).href : '';
            }
            catch (error)
            {
                image = '';
            }
            return {
                title: title.slice(0, 300),
                description: description.slice(0, 500),
                site: (meta('og:site_name') || new URL(response.url || target.href).hostname.replace(/^www\./, '')).slice(0, 100),
                image: /^https:\/\//.test(image) ? image : ''
            };
        }
        catch (error)
        {
            return {};
        }
        finally
        {
            clearTimeout(timer);
        }
    })();
    previewCache.set(target.href, task);
    if (previewCache.size > 500)
    {
        previewCache.delete(previewCache.keys().next().value);
    }
    return task;
}

// configured server list
function createBridge(options = {})
{
    const port = options.port ?? 19167;
    const target = options.target || {host: 'irc.libera.chat', port: 6697, tls: true};
    if (!Number.isInteger(port) || port < 0 || port > 65535 || !Number.isInteger(target.port) || target.port < 1 || target.port > 65535 || typeof target.host !== 'string' || !target.host || /[\s/\0]/.test(target.host) || typeof target.tls !== 'boolean')
    {
        return Promise.reject(new Error('Invalid bridge port or IRC destination in bridge.config.json'));
    }
    if (Boolean(options.cert) !== Boolean(options.key))
    {
        return Promise.reject(new Error('WSS requires both cert and key paths'));
    }
    const catalog = require('../networks.json');
    const entries = options.networks ?? catalog.networks;
    if (!Array.isArray(entries) || entries.length > 1000)
    {
        return Promise.reject(new Error('Invalid IRC network list'));
    }
    const networks = new Map();
    for (const entry of entries)
    {
        if (!entry || !/^[a-z0-9_-]{1,40}$/.test(entry.id) || networks.has(entry.id) || typeof entry.name !== 'string' || typeof entry.host !== 'string' || !entry.host || /[\s/\0]/.test(entry.host) || !Number.isInteger(entry.port) || entry.port < 1 || entry.port > 65535 || typeof entry.tls !== 'boolean')
        {
            return Promise.reject(new Error('Invalid IRC network entry'));
        }
        networks.set(entry.id, {...entry});
    }
    let defaultNetwork = [...networks.values()].find(entry => entry.host === target.host && entry.port === target.port && entry.tls === target.tls);
    if (!defaultNetwork)
    {
        defaultNetwork = {...target, id: 'configured', name: target.name || 'Configured server', description: 'Your bridge configuration'};
        networks.set(defaultNetwork.id, defaultNetwork);
    }
    // a saved token keeps bookmarked addresses working across restarts
    // networks collected from public directories, when enabled
    const directory = options.discovery ? createDirectory({builtin: [...networks.values()], cacheFile: options.cacheFile || path.join(__dirname, '../networks.cache.json')}) : null;
    const remember = entry =>
    {
        if (entry && entry.ready && /^[a-z0-9_-]{1,40}$/.test(entry.id) && typeof entry.host === 'string' && Number.isInteger(entry.port))
        {
            networks.set(entry.id, {id: entry.id, name: entry.name, host: entry.host, port: entry.port, tls: Boolean(entry.tls), description: entry.description || ''});
        }
    };
    const token = /^[a-f0-9]{64}$/.test(options.token || '') ? options.token : crypto.randomBytes(32).toString('hex');
    const secure = options.cert && options.key;
    const scheme = secure ? 'https' : 'http';
    const sockets = new Set();
    let origin;
    const handler = (request, response) =>
    {
        if (request.headers.host !== new URL(origin).host)
        {
            response.writeHead(403).end();
            return;
        }
        if (request.method === 'GET' && request.url.startsWith('/networks?'))
        {
            const url = new URL(request.url, origin);
            if (url.pathname !== '/networks' || url.searchParams.get('token') !== token)
            {
                response.writeHead(403).end();
                return;
            }
            const listed = directory ? directory.list() : [...networks.values()];
            listed.forEach(remember);
            response.writeHead(200, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'});
            response.end(JSON.stringify({defaultId: defaultNetwork.id, verified: catalog.verified, directory: directory?.status() || null, networks: listed.map(({servers, ...entry}) => entry)}));
            return;
        }
        if (request.method === 'GET' && /^\/(resolve|refresh)\?/.test(request.url))
        {
            const url = new URL(request.url, origin);
            if (url.searchParams.get('token') !== token || !directory)
            {
                response.writeHead(403).end();
                return;
            }
            const task = url.pathname === '/refresh' ? directory.refresh().then(() => directory.status()) : directory.resolve(url.searchParams.get('id') || '');
            task.then(result =>
            {
                remember(result);
                const {servers, ...entry} = result;
                response.writeHead(200, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'});
                response.end(JSON.stringify(entry));
            }, error =>
            {
                response.writeHead(200, {'Content-Type': 'application/json; charset=utf-8'});
                response.end(JSON.stringify({error: error.message}));
            });
            return;
        }
        if (request.method === 'GET' && request.url.startsWith('/preview?'))
        {
            const url = new URL(request.url, origin);
            if (url.searchParams.get('token') !== token)
            {
                response.writeHead(403).end();
                return;
            }
            linkPreview(url.searchParams.get('url') || '').then(preview =>
            {
                response.writeHead(200, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'});
                response.end(JSON.stringify(preview));
            });
            return;
        }
        if (request.method !== 'GET' || !['/', '/client.html'].includes(request.url))
        {
            response.writeHead(404).end();
            return;
        }
        // the page carries its own access key, so the plain local address works.
        // other websites cannot read it: the host check above blocks DNS rebinding, and browsers keep cross-origin responses private
        fs.readFile(path.join(__dirname, '../client.html'), 'utf8', (error, html) =>
        {
            if (error)
            {
                response.writeHead(500).end();
                return;
            }
            response.writeHead(200, {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff'});
            response.end(html.replace('<head>', '<head><meta name="lemon-irc-token" content="' + token + '">'));
        });
    };
    const server = secure ? https.createServer({cert: fs.readFileSync(options.cert), key: fs.readFileSync(options.key)}, handler) : http.createServer(handler);
    const wss = new WebSocketServer({noServer: true, maxPayload: 8192, perMessageDeflate: false, handleProtocols: protocols => protocols.has('text.ircv3.net') ? 'text.ircv3.net' : false});
    server.on('upgrade', (request, socket, head) =>
    {
        let url;
        try
        {
            url = new URL(request.url, origin);
        }
        catch (error)
        {
            socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
            return;
        }
        const network = networks.get(url.searchParams.get('network') || defaultNetwork.id);
        if (request.headers.host !== new URL(origin).host || request.headers.origin !== origin || url.pathname !== '/irc' || url.searchParams.get('token') !== token || !network || wss.clients.size >= 8)
        {
            socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
            return;
        }
        wss.handleUpgrade(request, socket, head, ws => wss.emit('connection', ws, network));
    });
    wss.on('connection', (ws, target) =>
    {
        let ready = false;
        let pending = [];
        let pendingBytes = 0;
        let incoming = '';
        let count = 0;
        let windowStart = Date.now();
        const upstream = target.tls ? tls.connect({host: target.host, port: target.port, servername: net.isIP(target.host) ? undefined : target.host, rejectUnauthorized: true}) : net.connect({host: target.host, port: target.port});
        sockets.add(upstream);
        const timeout = setTimeout(() => upstream.destroy(new Error('IRC connection timed out')), 20000);
        upstream.setEncoding('utf8');
        upstream.once(target.tls ? 'secureConnect' : 'connect', () =>
        {
            clearTimeout(timeout);
            ready = true;
            for (const line of pending)
            {
                upstream.write(line + '\r\n');
            }
            pending = [];
            pendingBytes = 0;
        });
        upstream.on('data', chunk =>
        {
            incoming += chunk;
            let end;
            while ((end = incoming.indexOf('\n')) >= 0)
            {
                const line = incoming.slice(0, end).replace(/\r$/, '');
                incoming = incoming.slice(end + 1);
                if (Buffer.byteLength(line) > 16384 || ws.bufferedAmount > 1024 * 1024)
                {
                    ws.close(1009, 'IRC receive limit exceeded');
                    upstream.destroy();
                    return;
                }
                if (ws.readyState === 1)
                {
                    ws.send(line);
                }
            }
            if (Buffer.byteLength(incoming) > 16384)
            {
                upstream.destroy(new Error('IRC line too large'));
            }
        });
        ws.on('message', (buffer, binary) =>
        {
            const line = buffer.toString('utf8');
            if (Date.now() - windowStart > 1000)
            {
                count = 0;
                windowStart = Date.now();
            }
            if (binary || /[\r\n\0]/.test(line) || buffer.length > 510 || ++count > 30 || upstream.writableLength > 65536)
            {
                ws.close(1008, 'Invalid IRC line or send limit');
                upstream.destroy();
                return;
            }
            if (ready)
            {
                upstream.write(line + '\r\n');
            }
            else if ((pendingBytes += buffer.length) <= 8192)
            {
                pending.push(line);
            }
            else
            {
                ws.close(1008, 'Registration queue full');
                upstream.destroy();
            }
        });
        upstream.on('error', () => ws.close(1011, 'IRC connection failed. Check the bridge destination and TLS settings.'));
        upstream.on('close', () =>
        {
            clearTimeout(timeout);
            sockets.delete(upstream);
            ws.close(1000, 'IRC connection closed');
        });
        ws.on('error', () => upstream.destroy());
        ws.on('close', () => upstream.destroy());
    });
    return new Promise((resolve, reject) =>
    {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () =>
        {
            origin = scheme + '://127.0.0.1:' + server.address().port;
            resolve({server, origin, token, url: origin + '/#' + token, close: () =>
            {
                for (const socket of sockets)
                {
                    socket.destroy();
                }
                for (const ws of wss.clients)
                {
                    ws.terminate();
                }
                wss.close();
                server.close();
                server.closeAllConnections();
            }});
        });
    });
}

/**
 * @brief reads the saved access token, creating it on first start
 *
 * @param string file -> token file path
 *
 * @return string 64 hexadecimal characters
 */
function savedToken(file)
{
    try
    {
        const saved = fs.readFileSync(file, 'utf8').trim();
        if (/^[a-f0-9]{64}$/.test(saved))
        {
            return saved;
        }
    }
    catch (error)
    {
        // first start
    }
    const token = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(file, token + '\n', {mode: 0o600});
    return token;
}

/**
 * @brief opens an address in the default browser
 *
 * @param string url -> full local address including the token
 *
 * @return void
 */
function openBrowser(url)
{
    const {spawn} = require('node:child_process');
    // rundll32 keeps the #token part, which start and explorer can drop
    const [command, args] = process.platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', url]] : [process.platform === 'darwin' ? 'open' : 'xdg-open', [url]];
    try
    {
        spawn(command, args, {detached: true, stdio: 'ignore', windowsHide: true}).on('error', () => console.log('Open the address above in your browser')).unref();
    }
    catch (error)
    {
        console.log('Open the address above in your browser');
    }
}

if (require.main === module)
{
    const configFile = path.join(__dirname, '../bridge.config.json');
    const config = fs.existsSync(configFile) ? JSON.parse(fs.readFileSync(configFile, 'utf8')) : {};
    config.token = savedToken(path.join(__dirname, '../bridge.token'));
    config.discovery = config.discovery !== false;
    createBridge(config).then(bridge =>
    {
        console.log('Lemon IRC local bridge\nOpen: ' + bridge.origin + '/');
        if (process.argv.includes('--open'))
        {
            openBrowser(bridge.origin + '/');
        }
        console.log('Default IRC network: ' + (config.target?.host || 'irc.libera.chat') + ' (nothing connects until you press connect)');
        process.on('SIGINT', () => bridge.close());
    }).catch(error =>
    {
        console.error(error.message);
        process.exitCode = 1;
    });
}
module.exports = {createBridge};
