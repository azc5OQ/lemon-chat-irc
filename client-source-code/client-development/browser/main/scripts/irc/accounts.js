// nickname account registration through NickServ or the IRCv3 REGISTER command
(function(root)
{
    // service reply sentences of Atheme, Anope, Ergo and OFTC, checked in this order
    const replies = [
        {result: 'wrong-code', pattern: /verification failed|invalid (key|passcode|code|verification code)|could not verify|incorrect (code|passcode)|code (is )?(invalid|incorrect|wrong)/i, message: 'The code was not accepted. Check the code in the e-mail.'},
        {result: 'verified', pattern: /has (now )?been (verified|confirmed)|verification (is )?(complete|successful)|account .*(is )?(now )?confirmed|e-?mail address .* (has been )?confirmed|successfully verified|account verified/i, message: 'The account is confirmed.'},
        {result: 'confirm', pattern: /passcode|activation|verification code|pending verification|sent to .*@|must (be )?(verified|confirmed|validated)|confirm your e-?mail|instructions .* sent|to (confirm|verify|complete) (your )?(registration|account)/i, message: 'The account is registered and must be confirmed. Open the e-mail from the network and enter its code under "Confirm code".'},
        {result: 'exists', pattern: /already registered|already exists|is already in use|account already|already taken/i, message: 'This account name is already registered. If it is yours, log in under "Log in". Otherwise change your nickname and register again.'},
        {result: 'wrong-password', pattern: /invalid password|password incorrect|incorrect password|wrong password|authentication failed|password (is )?(not correct|wrong)/i, message: 'The password is wrong.'},
        {result: 'email', pattern: /not a valid e-?mail|invalid e-?mail|e-?mail address (is )?(invalid|required|not allowed)|(enter|provide|specify|supply) an? (valid )?e-?mail|requires? an? (valid )?e-?mail|e-?mail .*(not permitted|banned|blocked)/i, message: 'The e-mail address was not accepted. Enter a valid address that this network allows.'},
        {result: 'password', pattern: /obscure password|password .*(too short|too long|at least|weak|cannot contain|must|insecure|not secure)|(weak|insecure|short) password/i, message: 'The password was not accepted. Use a longer password without spaces that is not your nickname.'},
        {result: 'wait', pattern: /using this nick for at least|must wait|too soon|before (you can|registering)|try again (later|in)|been connected for/i, message: 'The network asks you to wait before registering. Stay connected for a minute and try again.'},
        {result: 'limit', pattern: /too many (accounts|registrations|nicknames)|registration limit|limit of .*account/i, message: 'This network allows no more accounts from your e-mail address or connection.'},
        {result: 'logged-in', pattern: /you are now (identified|logged in|recognized)|password accepted|now logged in as|you('re| are) now logged in/i, message: 'You are logged in to the account.'},
        {result: 'not-registered', pattern: /is not registered|no such account|isn't registered|not a registered/i, message: 'This account name is not registered on this network.'},
        {result: 'registered', pattern: /is now registered|registered to|nickname \S+ (is )?registered|account created|registration (is )?(complete|successful)|successfully registered/i, message: 'The account is registered and you are logged in.'},
        {result: 'unknown-command', pattern: /unknown command|not a valid command|invalid command|no such command/i, message: 'NickServ on this network does not accept this command.'}
    ];

    // IRCv3 standard reply codes of REGISTER and VERIFY
    const failures = {
        ACCOUNT_EXISTS: 'exists',
        BAD_ACCOUNT_NAME: 'Account name was not accepted. Use letters and digits only.',
        ACCOUNT_NAME_MUST_BE_NICK: 'The account name must be the same as your current nickname.',
        NEED_NICK: 'Choose a nickname before registering.',
        ALREADY_AUTHENTICATED: 'You are already logged in to an account.',
        WEAK_PASSWORD: 'password',
        UNACCEPTABLE_PASSWORD: 'password',
        INVALID_EMAIL: 'email',
        UNACCEPTABLE_EMAIL: 'email',
        COMPLEX_EMAIL: 'email',
        TEMPORARILY_UNAVAILABLE: 'Registration is not available at the moment. Try again later.',
        INVALID_CODE: 'wrong-code'
    };

    /**
     * @brief finds the plain sentence for a result name
     *
     * @param string result -> result name from the reply table
     *
     * @return object {result, message}
     */
    function named(result)
    {
        const entry = replies.find(reply => reply.result === result);
        return {result, message: entry.message};
    }

    /**
     * @brief turns a service or server reply into a plain result
     *
     * @param string command -> irc command or numeric of the reply
     * @param array params -> reply parameters
     * @param string text -> reply text without the sender
     *
     * @return object|null {result, message} or null for an unknown reply
     */
    function describe(command, params, text)
    {
        // IRCv3 success
        if (['REGISTER', 'VERIFY'].includes(command))
        {
            if (params[0] === 'SUCCESS')
            {
                return command === 'VERIFY' ? named('verified') : named('registered');
            }
            if (params[0] === 'VERIFICATION_REQUIRED')
            {
                return named('confirm');
            }
            return null;
        }

        // IRCv3 failure
        if (command === 'FAIL' && ['REGISTER', 'VERIFY'].includes(params[0]))
        {
            const failure = failures[params[1]];
            if (!failure)
            {
                return {result: 'failed', message: 'The network refused the request: ' + (params.at(-1) || params[1])};
            }
            return failure.includes(' ') ? {result: 'failed', message: failure} : named(failure);
        }

        // missing service
        if (command === '401' || command === '440')
        {
            return {result: 'no-service', message: 'This network has no NickServ service. Nicknames cannot be registered here.'};
        }

        // service sentences
        const plain = text.replace(/\x03\d{0,2}(,\d{1,2})?|[\x02\x0f\x16\x1d\x1e\x1f]/g, '');
        const entry = replies.find(reply => reply.pattern.test(plain));
        return entry ? {result: entry.result, message: entry.message} : null;
    }

    /**
     * @brief finds the kind of account service from the server and its replies
     *
     * @param object registration -> result of client.accountRegistration()
     * @param string serverVersion -> version from reply 004
     * @param string replies -> service replies seen so far
     *
     * @return string ircv3, ergo, anope or atheme
     */
    function serviceType(registration, serverVersion, replies)
    {
        if (registration.is_available)
        {
            return 'ircv3';
        }
        if (/ergo|oragono/i.test(serverVersion))
        {
            return 'ergo';
        }
        if (/\bCONFIRM\b/.test(replies))
        {
            return 'anope';
        }
        return 'atheme';
    }

    /**
     * @brief builds the registration command
     *
     * @param string type -> service type from serviceType()
     * @param object form -> {account, password, repeat, email}
     * @param object registration -> result of client.accountRegistration()
     *
     * @return string irc command line
     */
    function registerLine(type, form, registration)
    {
        // check the fields
        if (!/^[^\s:]{1,50}$/.test(form.account))
        {
            throw new Error('Enter an account name without spaces.');
        }
        if (!form.password || /\s/.test(form.password) || form.password.length > 300)
        {
            throw new Error('Enter a password without spaces.');
        }
        if (form.password !== form.repeat)
        {
            throw new Error('The two passwords are different.');
        }
        if (form.email && !/^[^\s@:]+@[^\s@]+\.[^\s@]+$/.test(form.email))
        {
            throw new Error('Enter an e-mail address such as name@example.com.');
        }
        if (!form.email && registration.is_email_required)
        {
            throw new Error('This network needs an e-mail address for registration.');
        }

        // build the command
        if (type === 'ircv3')
        {
            return 'REGISTER ' + form.account + ' ' + (form.email || '*') + ' ' + form.password;
        }
        return 'PRIVMSG NickServ :REGISTER ' + form.password + (form.email ? ' ' + form.email : '');
    }

    /**
     * @brief builds the command that confirms a registration with the code from the e-mail
     *
     * @param string type -> service type from serviceType()
     * @param string account -> registered account name
     * @param string input -> code alone, or the whole line from the e-mail
     *
     * @return string irc command line
     */
    function confirmLine(type, account, input)
    {
        // read a pasted line
        const text = input.trim().replace(/^\/(msg|query)\s+nickserv\s+|^\/(ns|nickserv)\s+/i, '');
        if (/^(VERIFY|CONFIRM)\s/i.test(text))
        {
            if (/[\r\n\0]/.test(text) || text.length > 400)
            {
                throw new Error('Paste only the one line from the e-mail.');
            }
            return 'PRIVMSG NickServ :' + text;
        }

        // check the code
        if (!/^\S{1,100}$/.test(text))
        {
            throw new Error('Enter the code from the e-mail.');
        }

        // build the command
        if (type === 'ircv3')
        {
            return 'VERIFY ' + account + ' ' + text;
        }
        if (type === 'anope')
        {
            return 'PRIVMSG NickServ :CONFIRM ' + text;
        }
        if (type === 'ergo')
        {
            return 'PRIVMSG NickServ :VERIFY ' + account + ' ' + text;
        }
        return 'PRIVMSG NickServ :VERIFY REGISTER ' + account + ' ' + text;
    }

    /**
     * @brief builds the login command for a registered nickname
     *
     * @param string account -> account name
     * @param string password -> account password
     *
     * @return string irc command line
     */
    function loginLine(account, password)
    {
        if (!/^[^\s:]{1,50}$/.test(account))
        {
            throw new Error('Enter an account name without spaces.');
        }
        if (!password || /\s/.test(password) || password.length > 300)
        {
            throw new Error('Enter a password without spaces.');
        }
        return 'PRIVMSG NickServ :IDENTIFY ' + account + ' ' + password;
    }

    root.LemonIrc.Accounts = {describe, serviceType, registerLine, confirmLine, loginLine};
    if (typeof module !== 'undefined')
    {
        module.exports = root.LemonIrc.Accounts;
    }
})(globalThis);
