const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = path.join(__dirname, 'client-source-code/client-development/browser/main');
let template = fs.readFileSync(path.join(source, 'template.html'), 'utf8');
// copied desktop layout
template = template.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
const themes = ['default', 'hybrid', 'hybrid-v2', 'aero', 'termix', 'ozone', 'default-mobile', 'mobile-2'];
template = template.replace(/<style\b[^>]*id="style-theme-([^"]+)"[^>]*>[\s\S]*?<\/style>/gi, (sheet, name) => themes.includes(name) ? sheet : '');
template = template.replace(/\/\*\s*@@INCLUDE:\s*(.+?)\s*@@\s*\*\//g, (_, file) => fs.readFileSync(path.join(source, file.trim()), 'utf8'));
function element(id)
{
    const start = template.indexOf('<div id="' + id + '"');
    if (start < 0)
    {
        throw new Error('Missing copied element ' + id);
    }
    const tags = /<div\b[^>]*>|<\/div>/g;
    tags.lastIndex = start;
    let depth = 0;
    let match;
    while ((match = tags.exec(template)))
    {
        depth += match[0].startsWith('</') ? -1 : 1;
        if (depth === 0)
        {
            return template.slice(start, tags.lastIndex);
        }
    }
    throw new Error('Unclosed copied element ' + id);
}
const head = template.slice(0, template.indexOf('</head>')).replace('<title>chat</title>', '<title>Lemon IRC</title>');
const treeSource = fs.readFileSync(path.join(source, 'scripts/app/channel/channel-tree.js'), 'utf8');
const memberStart = treeSource.indexOf('function channel_tree__generate_html_for_single_client(');
const memberEnd = treeSource.indexOf('\n/**', memberStart);
if (memberStart < 0 || memberEnd < 0)
{
    throw new Error('Missing copied member renderer');
}
const scripts = [
    // the server list is built in, so the globe works even when the bridge cannot send it
    'window.LemonIrcNetworks = ' + JSON.stringify(JSON.parse(fs.readFileSync(path.join(__dirname, 'networks.json'), 'utf8'))) + ';',
    fs.readFileSync(path.join(source, 'scripts/irc/protocol.js'), 'utf8'),
    fs.readFileSync(path.join(source, 'scripts/irc/media.js'), 'utf8'),
    fs.readFileSync(path.join(source, 'scripts/irc/identities.js'), 'utf8'),
    fs.readFileSync(path.join(source, 'scripts/irc/tree.js'), 'utf8'),
    fs.readFileSync(path.join(source, 'scripts/irc/view.js'), 'utf8'),
    fs.readFileSync(path.join(source, 'scripts/irc/management.js'), 'utf8'),
    fs.readFileSync(path.join(source, 'scripts/irc/conversations.js'), 'utf8'),
    fs.readFileSync(path.join(source, 'scripts/app/audio/sounds.js'), 'utf8'),
    fs.readFileSync(path.join(source, 'scripts/app/ui/layout.js'), 'utf8'),
    treeSource.slice(memberStart, memberEnd),
    fs.readFileSync(path.join(source, 'scripts/irc/page.js'), 'utf8')
];
for (const script of scripts)
{
    new vm.Script(script);
}
const toolbar = element('communication-system-head-menu').replace(/<button\b[^>]*class="choose-theme-item"[^>]*data-name="([^"]+)"[^>]*>[\s\S]*?<\/button>/g, (button, name) => themes.includes(name) ? button : '');
const logButton = template.match(/<input\b[^>]*id="show-hide-log-button"[^>]*>/)[0];
const defaultTheme = fs.readFileSync(path.join(source, 'styles/theme-default.style'), 'utf8');
/**
 * @brief reads an existing toolbar icon from the default theme
 *
 * @param string id -> toolbar control identifier
 *
 * @return string css image value
 */
function toolbarIcon(id)
{
    const rule = defaultTheme.match(new RegExp('#' + id + '\\s*\\{([^}]+)\\}'));
    const icon = rule?.[1].match(/background-image:\s*(url\([^)]+\))/);
    if (!icon)
    {
        throw new Error('Missing copied toolbar icon ' + id);
    }
    return icon[1];
}
const uiSource = fs.readFileSync(path.join(source, 'scripts/app/ui/ui.js'), 'utf8');
const soundIcons = [...uiSource.matchAll(/document\.getElementById\("sound-effects-button"\)\.style\.backgroundImage = "(url\([^)]+\))"/g)].map(match => match[1]);
if (soundIcons.length !== 2)
{
    throw new Error('Missing copied sound state icons');
}
const toolbarIcons = ':root\n{\n    --irc-sound-icon: ' + soundIcons[0] + ';\n    --irc-sound-muted-icon: ' + soundIcons[1] + ';\n    --irc-flag-icon: ' + toolbarIcon('hide-show-flags-button') + ';\n}\n';
const html = head + '<style>' + toolbarIcons + fs.readFileSync(path.join(source, 'styles/irc.style'), 'utf8') + '</style></head><body class="irc-client irc-disconnected">' + element('textarea-log') + '<div id="body-container">' + toolbar + element('verification-system') + element('communication-system-container') + element('contextmenus-container') + logButton + '</div><script>' + scripts.join('\n').replace(/<\/script/gi, '<\\/script') + '</script></body></html>';
fs.writeFileSync(path.join(__dirname, 'client.html'), html);
console.log('Built client.html from the copied Lemon template and theme sheets (' + html.length + ' characters)');
