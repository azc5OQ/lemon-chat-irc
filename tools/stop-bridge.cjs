// stops a previously started Lemon IRC bridge that still holds the configured port
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');

const root = path.join(__dirname, '..');
const configFile = path.join(root, 'bridge.config.json');
const config = fs.existsSync(configFile) ? JSON.parse(fs.readFileSync(configFile, 'utf8')) : {};
const port = config.port ?? 19167;

/**
 * @brief runs a command and returns its output, or an empty string when it fails
 *
 * @param string file -> executable
 * @param array args -> arguments
 *
 * @return string command output
 */
function run(file, args)
{
    try
    {
        return execFileSync(file, args, {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true});
    }
    catch (error)
    {
        return error.stdout || '';
    }
}

/**
 * @brief finds the process IDs listening on the bridge port on 127.0.0.1
 *
 * @return array process IDs
 */
function listeners()
{
    const pids = new Set();
    if (process.platform === 'win32')
    {
        // Get-NetTCPConnection is used because netstat state names are localized
        for (const pid of run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Get-NetTCPConnection -State Listen -LocalPort ' + port + ' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess']).split(/\s+/))
        {
            if (pid)
            {
                pids.add(Number(pid));
            }
        }
    }
    else
    {
        for (const pid of run('lsof', ['-nP', '-iTCP:' + port, '-sTCP:LISTEN', '-t']).split(/\s+/))
        {
            if (pid)
            {
                pids.add(Number(pid));
            }
        }
        if (!pids.size)
        {
            for (const match of run('ss', ['-ltnpH', 'sport = :' + port]).matchAll(/pid=(\d+)/g))
            {
                pids.add(Number(match[1]));
            }
        }
    }
    pids.delete(0);
    pids.delete(process.pid);
    return [...pids];
}

/**
 * @brief reads a process's command line
 *
 * @param number pid -> process ID
 *
 * @return string command line
 */
function commandLine(pid)
{
    if (process.platform === 'win32')
    {
        return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '(Get-CimInstance Win32_Process -Filter "ProcessId=' + pid + '").CommandLine']);
    }
    if (fs.existsSync('/proc/' + pid + '/cmdline'))
    {
        return fs.readFileSync('/proc/' + pid + '/cmdline', 'utf8').replace(/\0/g, ' ');
    }
    return run('ps', ['-o', 'command=', '-p', String(pid)]);
}

const wait = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
let stopped = 0;
for (const pid of listeners())
{
    const command = commandLine(pid);
    // only the bridge is stopped, never another program that happens to use the port
    if (!/node/i.test(command) || !/server\.cjs/.test(command))
    {
        console.error('Port ' + port + ' is used by another program (PID ' + pid + '): ' + command.trim());
        process.exitCode = 1;
        continue;
    }
    try
    {
        process.kill(pid);
        stopped++;
        console.log('Stopped the previous Lemon IRC bridge (PID ' + pid + ')');
    }
    catch (error)
    {
        console.error('Could not stop PID ' + pid + ': ' + error.message);
        process.exitCode = 1;
    }
}
// waits up to 5 seconds for the port to be released
for (let i = 0; stopped && i < 50 && listeners().length; i++)
{
    wait(100);
}
