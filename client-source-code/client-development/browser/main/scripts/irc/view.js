// copied renderer state
var g_is_chat_hidden = false;
var g_sound_effects = null;
var g_are_sound_effects_enabled = utils__storage_get('sounds') !== 'false';
var g_layout =
{
    grid_active: true,
    edit_active: false,
    panels: null,
    drag: null,
    edit_dragged: null,
    state:
    {
        order: ['channels', 'chat', 'info'],
        input_col: 'chat',
        input_pos: 'bottom',
        toolbar_col: 'full',
        toolbar_pos: 'top',
        col_channels: '15%',
        col_info: '13%'
    }
};
var g_channel_list = [];
var g_server_policy = {is_avatar_upload_allowed: false};

function utils__storage_get(key)
{
    try
    {
        return localStorage.getItem('irc_' + key);
    }
    catch (error)
    {
        return null;
    }
}

function utils__storage_set(key, value)
{
    try
    {
        localStorage.setItem('irc_' + key, value);
    }
    catch (error)
    {
        console.warn('Could not save local preference', error.message);
    }
}

function chat__sanitize_string(text)
{
    const node = document.createElement('span');
    node.textContent = text;
    return node.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function chat__generate_unread_badge_html(count)
{
    const value = Number(count || 0);
    return '<p class="connected-client-p-received-messages-number" data-unread-digits="' + String(value).length + '"' + (value > 0 ? '' : ' hidden') + '>' + value + '</p>';
}

function channel_tree__get_indentation_level()
{
    return 1;
}

function channel_tree__is_channel_or_his_parent_collapsed()
{
    return false;
}
