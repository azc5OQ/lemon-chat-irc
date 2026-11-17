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
                profiles.push({network: profile.network, nick: profile.nick, account: profile.account, selected: Boolean(profile.selected)});
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
        const profiles = load(storage).filter(profile => !(profile.network === endpoint && profile.account.toLowerCase() === account.toLowerCase()));
        for (const profile of profiles)
        {
            if (profile.network === endpoint)
            {
                profile.selected = false;
            }
        }
        profiles.push({network: endpoint, nick, account, selected: true});
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

    root.LemonIrc.Identities = {list, remember, forget};
    if (typeof module !== 'undefined')
    {
        module.exports = root.LemonIrc.Identities;
    }
})(globalThis);
