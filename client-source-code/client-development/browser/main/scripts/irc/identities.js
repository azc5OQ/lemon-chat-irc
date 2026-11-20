(function(root)
{
    /**
     * @brief identifies a server endpoint
     *
     * @param object network -> server address and port
     *
     * @return string storage key
     */
    function key(network)
    {
        return network.host.toLowerCase() + ':' + network.port + ':' + Boolean(network.tls);
    }

    /**
     * @brief reads saved account names without credentials
     *
     * @param object storage -> storage callbacks
     *
     * @return array valid profiles
     */
    function load(storage)
    {
        try
        {
            const data = JSON.parse(storage.read() || '[]');
            if (!Array.isArray(data))
            {
                return [];
            }
            const profiles = [];
            for (const profile of data.slice(0, 200))
            {
                if (!profile || typeof profile.network !== 'string' || typeof profile.nick !== 'string' || typeof profile.account !== 'string' || profile.nick.length > 30 || profile.account.length > 100)
                {
                    continue;
                }

                // username and real name
                const username = typeof profile.username === 'string' && profile.username.length <= 10 ? profile.username : '';
                const realname = typeof profile.realname === 'string' && profile.realname.length <= 50 ? profile.realname : '';

                // channels joined at the end of the last session
                const channels = Array.isArray(profile.channels) ? profile.channels.filter(name => typeof name === 'string' && name.length <= 200).slice(0, 100) : [];
                profiles.push({network: profile.network, nick: profile.nick, account: profile.account, username, realname, channels, selected: Boolean(profile.selected)});
            }
            return profiles;
        }
        catch (error)
        {
            return [];
        }
    }

    /**
     * @brief lists profiles for one server
     *
     * @param object storage -> storage callbacks
     * @param object network -> selected server
     *
     * @return array matching profiles
     */
    function list(storage, network)
    {
        return load(storage).filter(profile => profile.network === key(network));
    }

    /**
     * @brief remembers the chosen nickname and account
     *
     * @param object storage -> storage callbacks
     * @param object network -> selected server
     * @param string nick -> preferred nickname
     * @param string account -> account name or empty for guests
     *
     * @return void
     */
    function remember(storage, network, nick, account)
    {
        const endpoint = key(network);
        const all = load(storage);
        const previous = all.find(profile => profile.network === endpoint && profile.account.toLowerCase() === account.toLowerCase());
        const profiles = all.filter(profile => profile !== previous);
        for (const profile of profiles)
        {
            if (profile.network === endpoint)
            {
                profile.selected = false;
            }
        }

        // keep the stored details of the same identity
        profiles.push({network: endpoint, nick, account, username: previous?.username || '', realname: previous?.realname || '', channels: previous?.channels || [], selected: true});
        storage.write(JSON.stringify(profiles.slice(-200)));
    }

    /**
     * @brief removes a saved profile
     *
     * @param object storage -> storage callbacks
     * @param object network -> selected server
     * @param string account -> account to forget
     *
     * @return void
     */
    function forget(storage, network, account)
    {
        const endpoint = key(network);
        storage.write(JSON.stringify(load(storage).filter(profile => profile.network !== endpoint || profile.account !== account)));
    }

    /**
     * @brief stores the username and real name of a saved profile
     *
     * @param object storage -> storage callbacks
     * @param object network -> selected server
     * @param string account -> account name or empty for guests
     * @param string username -> username sent with USER
     * @param string realname -> real name sent with USER
     *
     * @return void
     */
    function rememberUser(storage, network, account, username, realname)
    {
        const endpoint = key(network);
        const profiles = load(storage);

        // update the profile
        for (const profile of profiles)
        {
            if (profile.network === endpoint && profile.account.toLowerCase() === account.toLowerCase())
            {
                profile.username = username;
                profile.realname = realname;
            }
        }
        storage.write(JSON.stringify(profiles));
    }

    /**
     * @brief stores the channels an identity is in, for joining them again on the next connection
     *
     * @param object storage -> storage callbacks
     * @param object network -> server address and port
     * @param string account -> account name or empty for guests
     * @param array channels -> channel names
     *
     * @return void
     */
    function rememberChannels(storage, network, account, channels)
    {
        const endpoint = key(network);
        const profiles = load(storage);

        // update the profile
        for (const profile of profiles)
        {
            if (profile.network === endpoint && profile.account.toLowerCase() === account.toLowerCase())
            {
                profile.channels = channels.slice(0, 100);
            }
        }
        storage.write(JSON.stringify(profiles));
    }

    // PBKDF2 rounds for the master password key, so each guess takes about a second
    const iterations = 600000;

    /**
     * @brief writes bytes as base64 text
     *
     * @param Uint8Array bytes -> binary data
     *
     * @return string base64 text
     */
    function toBase64(bytes)
    {
        return btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(''));
    }

    /**
     * @brief reads base64 text as bytes
     *
     * @param string text -> base64 text
     *
     * @return Uint8Array binary data
     */
    function fromBase64(text)
    {
        return Uint8Array.from(atob(text), character => character.charCodeAt(0));
    }

    /**
     * @brief derives the AES-256-GCM key from the master password with PBKDF2-SHA-256
     *
     * @param string password -> master password
     * @param Uint8Array salt -> random salt stored in the file
     *
     * @return Promise<CryptoKey> key for encrypting and decrypting
     */
    async function deriveKey(password, salt)
    {
        const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
        return crypto.subtle.deriveKey({name: 'PBKDF2', hash: 'SHA-256', salt, iterations}, base, {name: 'AES-GCM', length: 256}, false, ['encrypt', 'decrypt']);
    }

    /**
     * @brief makes a new key with a new random salt for a new identities file
     *
     * @param string password -> new master password
     *
     * @return Promise<object> {key, salt}
     */
    async function createVault(password)
    {
        if (password.length < 8)
        {
            throw new Error('The master password needs at least 8 characters.');
        }
        const salt = crypto.getRandomValues(new Uint8Array(16));
        return {key: await deriveKey(password, salt), salt};
    }

    /**
     * @brief encrypts the identities with a new random IV
     *
     * @param CryptoKey key -> key from createVault() or openVault()
     * @param Uint8Array salt -> salt of the key
     * @param object content -> {profiles, passwords}
     *
     * @return Promise<object> file content {version, iterations, salt, iv, data}
     */
    async function sealVault(key, salt, content)
    {
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const data = await crypto.subtle.encrypt({name: 'AES-GCM', iv}, key, new TextEncoder().encode(JSON.stringify(content)));
        return {version: 1, iterations, salt: toBase64(salt), iv: toBase64(iv), data: toBase64(new Uint8Array(data))};
    }

    /**
     * @brief decrypts an identities file with the master password
     *
     * @param string password -> master password
     * @param object file -> file content from sealVault()
     *
     * @return Promise<object> {key, salt, content}
     */
    async function openVault(password, file)
    {
        // check the file
        if (!file || file.version !== 1 || file.iterations !== iterations || typeof file.salt !== 'string' || typeof file.iv !== 'string' || typeof file.data !== 'string')
        {
            throw new Error('The saved identities file has an unknown format.');
        }
        const salt = fromBase64(file.salt);
        const key = await deriveKey(password, salt);

        // decrypt the identities
        let plain;
        try
        {
            plain = await crypto.subtle.decrypt({name: 'AES-GCM', iv: fromBase64(file.iv)}, key, fromBase64(file.data));
        }
        catch (error)
        {
            throw new Error('Wrong master password, or the file was changed.');
        }
        const content = JSON.parse(new TextDecoder().decode(plain));
        return {key, salt, content: {profiles: Array.isArray(content.profiles) ? content.profiles : [], passwords: content.passwords && typeof content.passwords === 'object' ? content.passwords : {}, servers: Array.isArray(content.servers) ? content.servers : []}};
    }

    /**
     * @brief names the saved password of one account on one server
     *
     * @param object network -> server address and port
     * @param string account -> account name
     *
     * @return string key in the passwords object
     */
    function passwordKey(network, account)
    {
        return key(network) + ' ' + account.toLowerCase();
    }

    root.LemonIrc.Identities = {list, remember, rememberUser, rememberChannels, forget, createVault, sealVault, openVault, passwordKey, serverKey: key};
    if (typeof module !== 'undefined')
    {
        module.exports = root.LemonIrc.Identities;
    }
})(globalThis);
