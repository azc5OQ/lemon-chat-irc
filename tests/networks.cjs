const net = require('node:net');
const tls = require('node:tls');
const {networks} = require('../networks.json');

// certificate checks for tls entries, reachability for unencrypted ones
Promise.all(networks.map(network => new Promise(resolve =>
{
    const socket = network.tls ? tls.connect({host: network.host, port: network.port, servername: network.host, rejectUnauthorized: true}) : net.connect({host: network.host, port: network.port});
    const timer = setTimeout(() => socket.destroy(new Error('Connection timed out')), 15000);
    let finished = false;
    function finish(error)
    {
        if (finished)
        {
            return;
        }
        finished = true;
        clearTimeout(timer);
        socket.destroy();
        console.log((error ? 'FAIL ' : 'PASS ') + network.name + ': ' + (error ? error.message : network.tls ? 'TLS certificate verified' : 'reachable without encryption'));
        resolve(!error);
    }
    socket.once(network.tls ? 'secureConnect' : 'connect', () => finish());
    socket.once('error', finish);
}))).then(results =>
{
    if (results.some(passed => !passed))
    {
        process.exitCode = 1;
    }
});
