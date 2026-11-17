# sourced by start.sh and the build scripts.
# uses Node.js 22.12 or later when it is installed, otherwise downloads the latest Node.js 24 into .tools/ and puts it on PATH.
# set NODEJS_ORG_MIRROR to download from a mirror of https://nodejs.org/dist

lemon_node_ok()
{
    command -v node >/dev/null 2>&1 && node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=12)?0:1)" 2>/dev/null
}

lemon_fetch()
{
    if command -v curl >/dev/null 2>&1
    then
        curl -fsSL --retry 2 -o "$2" "$1"
    elif command -v wget >/dev/null 2>&1
    then
        wget -q -O "$2" "$1"
    else
        echo "Neither curl nor wget is installed, so Node.js can't be downloaded." >&2
        return 1
    fi
}

lemon_sha256()
{
    if command -v sha256sum >/dev/null 2>&1
    then
        sha256sum "$1" | cut -d ' ' -f 1
    else
        shasum -a 256 "$1" | cut -d ' ' -f 1
    fi
}

lemon_node()
{
    if lemon_node_ok
    then
        return 0
    fi
    lemon_tools="$(pwd)/.tools"
    for lemon_bin in "$lemon_tools"/node-v*/bin
    do
        if [ -x "$lemon_bin/node" ]
        then
            PATH="$lemon_bin:$PATH"
            export PATH
            if lemon_node_ok
            then
                return 0
            fi
        fi
    done
    case "$(uname -s)" in
        Linux) lemon_os=linux ;;
        Darwin) lemon_os=darwin ;;
        *) echo "No Node.js download for $(uname -s)." >&2; return 1 ;;
    esac
    case "$(uname -m)" in
        x86_64|amd64) lemon_arch=x64 ;;
        aarch64|arm64) lemon_arch=arm64 ;;
        *) echo "No Node.js download for $(uname -m)." >&2; return 1 ;;
    esac
    lemon_mirror="${NODEJS_ORG_MIRROR:-https://nodejs.org/dist}"
    mkdir -p "$lemon_tools"
    echo "Node.js 22.12 or later wasn't found. Downloading Node.js 24 into .tools ..."
    lemon_fetch "$lemon_mirror/latest-v24.x/SHASUMS256.txt" "$lemon_tools/SHASUMS256.txt" || return 1
    lemon_line=$(grep -- "-$lemon_os-$lemon_arch.tar.gz\$" "$lemon_tools/SHASUMS256.txt" | head -n 1)
    if [ -z "$lemon_line" ]
    then
        echo "The Node.js release list has no $lemon_os-$lemon_arch download." >&2
        return 1
    fi
    lemon_file=${lemon_line##* }
    lemon_expected=${lemon_line%% *}
    lemon_fetch "$lemon_mirror/latest-v24.x/$lemon_file" "$lemon_tools/$lemon_file" || return 1
    if [ "$(lemon_sha256 "$lemon_tools/$lemon_file")" != "$lemon_expected" ]
    then
        rm -f "$lemon_tools/$lemon_file"
        echo "The Node.js download doesn't match its published checksum." >&2
        return 1
    fi
    tar -xzf "$lemon_tools/$lemon_file" -C "$lemon_tools" || return 1
    rm -f "$lemon_tools/$lemon_file" "$lemon_tools/SHASUMS256.txt"
    PATH="$lemon_tools/${lemon_file%.tar.gz}/bin:$PATH"
    export PATH
    lemon_node_ok
}

if ! lemon_node
then
    echo "Install Node.js 24 from https://nodejs.org and run this again." >&2
    exit 1
fi
