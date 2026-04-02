# SFTP Deploy+

> Deploy files to remote servers via SCP/SSH or Docker — with configurable post-upload commands.  
> Inspired by PhpStorm's SFTP deployment, built for VS Code.

## Features

- **Upload on Save** — automatically deploy files when you save them
- **Multi-Server Support** — configure multiple servers, switch with one click from the status bar
- **Docker Support** — deploy directly into containers via `docker cp` (local or remote via SSH)
- **Post-Upload Commands** — run SSH or Docker commands after every upload (e.g. clear cache, restart service)
- **Folder Upload** — deploy entire directories via Explorer context menu
- **Path Mappings** — map multiple local project folders to remote paths
- **Host Key Verification** — PhpStorm-style fingerprint check on first connection
- **Off Mode** — disable deploy globally without changing your config

## Getting Started

1. Install the extension
2. Create `.vscode/sftp-deploy.json` in your workspace (see example below)
3. Click the server name in the status bar to switch servers or turn deploy off
4. Toggle auto-upload with the sync icon, or use `SFTP: Toggle Auto-Upload`

## Configuration

Create `.vscode/sftp-deploy.json`:

```json
{
  "autoUpload": true,
  "startupMode": "last",
  "defaultServer": "my-server",
  "servers": [
    {
      "name": "my-server",
      "host": "192.168.1.100",
      "port": 22,
      "user": "root",
      "privateKey": "~/.ssh/id_rsa",
      "postUploadCommands": [
        {
          "enabled": true,
          "type": "ssh",
          "command": "systemctl restart apache2",
          "continueOnError": false
        }
      ]
    }
  ],
  "mappings": [
    {
      "name": "my-project",
      "localPath": "/Users/me/Development/my-project",
      "remotePath": "/var/www/html"
    }
  ]
}
```

## Server Options

| Option | Required | Description |
|---|---|---|
| `name` | ✅ | Display name |
| `host` | ✅ | Hostname or IP |
| `port` | — | SSH port (default: 22) |
| `user` | ✅ | SSH username |
| `privateKey` | — | Path to private key (`~` supported) |
| `password` | — | Password (alternative to privateKey) |
| `passphrase` | — | Passphrase for encrypted private key |
| `postUploadCommands` | — | Commands to run after upload (see below) |

## Global Options

| Option | Default | Description |
|---|---|---|
| `autoUpload` | `false` | Deploy automatically on file save |
| `startupMode` | `"last"` | Controls which server is active on startup (see below) |
| `defaultServer` | first server | Server name to use when `startupMode` is `"default"` |

### Startup Mode

Controls which server is active when VS Code starts or reloads:

| Value | Behavior |
|---|---|
| `"last"` | Remembers the last selected server (or Off) across sessions |
| `"off"` | Always starts with no server — deploy is disabled until you pick one |
| `"default"` | Always activates `defaultServer` on startup |

```json
"startupMode": "last"
```

## Off Mode

Click the server name in the status bar and select **Off** to disable all deploys without changing your config. The status bar shows `⊘ SFTP: Off`.

With `"startupMode": "last"`, VS Code remembers this choice and starts with deploy disabled next time.

## Docker Support

Set `"type": "docker"` to deploy files directly into a running container via `docker cp`.

### Local Docker

```json
{
  "servers": [
    {
      "name": "otobo-docker",
      "type": "docker",
      "container": "otobo_web_1",
      "postUploadCommands": [
        {
          "type": "docker",
          "command": "/opt/otobo/bin/otobo.Console.pl Maint::Cache::Delete"
        }
      ]
    }
  ],
  "mappings": [
    {
      "localPath": "~/Development/my-addon/Kernel",
      "remotePath": "/opt/otobo/Kernel"
    }
  ]
}
```

### Remote Docker (via SSH)

If Docker runs on a remote server, add `dockerHost` — the extension SSHs in and runs `docker cp` / `docker exec` there:

```json
{
  "name": "otobo-remote-docker",
  "type": "docker",
  "container": "otobo_web_1",
  "dockerHost": "192.168.1.100",
  "dockerPort": 22,
  "dockerUser": "root",
  "dockerPrivateKey": "~/.ssh/id_rsa"
}
```

### Docker Server Options

| Option | Required | Description |
|---|---|---|
| `type` | ✅ | `"docker"` |
| `container` | ✅ | Container name or ID |
| `dockerHost` | — | SSH host for remote Docker (omit for local Docker) |
| `dockerPort` | — | SSH port (default: 22) |
| `dockerUser` | — | SSH user |
| `dockerPrivateKey` | — | Path to SSH private key |
| `dockerPassword` | — | SSH password (alternative to key) |

### Post-Upload Commands for Docker

Use `"type": "docker"` to run commands **inside** the container:

```json
"postUploadCommands": [
  {
    "type": "docker",
    "command": "/opt/otobo/bin/otobo.Console.pl Maint::Cache::Delete",
    "enabled": true,
    "continueOnError": false
  }
]
```



```json
"postUploadCommands": [
  {
    "type": "ssh",
    "command": "systemctl restart apache2",
    "enabled": true,
    "continueOnError": false
  },
  {
    "type": "ssh",
    "command": "su -s /bin/bash otobo -c '/opt/otobo/bin/otobo.Console.pl Maint::Cache::Delete'",
    "enabled": true,
    "continueOnError": false
  }
]
```

| Field | Description |
|---|---|
| `type` | `"ssh"` — runs on remote server |
| `command` | Shell command to execute |
| `enabled` | Set to `false` to skip without deleting |
| `continueOnError` | If `true`, failure won't stop subsequent commands |

## Commands

| Command | Description |
|---|---|
| `SFTP: Upload Current File` | Upload the active file |
| `SFTP: Upload Folder` | Upload a folder (Explorer context menu) |
| `SFTP: Switch Server` | Pick a different server from the list |
| `SFTP: Toggle Auto-Upload` | Enable/disable upload on save |
| `SFTP: Forget Host Key` | Remove a stored host key (e.g. after server rebuild) |

## Security

### Host Key Verification

On the **first connection** to a server, the extension shows the server's SSH fingerprint and asks you to confirm:

```
SFTP Deploy: Unknown server "192.168.1.100:22"
Fingerprint (SHA256): SHA256:abc123...

[Trust and Connect]   [Cancel]
```

Once trusted, the fingerprint is stored locally. If it **ever changes**, you'll see a warning:

```
⚠️ Host key CHANGED for "192.168.1.100:22"
Expected: SHA256:abc123...
Received: SHA256:xyz789...

This could indicate a man-in-the-middle attack.
[Update and Connect]   [Cancel]
```

Stored fingerprints are saved in VS Code's global extension storage (not in your project). Use `SFTP: Forget Host Key` to remove a stored key when you intentionally rebuild a server.

### Workspace Trust

`local` post-upload commands (those with `"type": "local"`) run shell commands on your machine. This extension requires **[Workspace Trust](https://code.visualstudio.com/docs/editor/workspace-trust)** before executing any local commands.

> **If you open an unknown repository, do not trust the workspace unless you have reviewed the `sftp-deploy.json` config.**

SSH commands (`"type": "ssh"`) always run on the remote server — they are not affected by this restriction.

### Config File & Credentials

⚠️ **Never commit `sftp-deploy.json` to version control if it contains passwords.**

Add it to your `.gitignore`:

```
.vscode/sftp-deploy.json
```

Prefer SSH keys over passwords wherever possible — they are more secure and never stored in the config file.

## Why not just use the SFTP extension?

The popular [SFTP extension](https://marketplace.visualstudio.com/items?itemName=Natizyskunk.sftp) is great, but we needed:
- **Post-upload commands** that run on the remote server via SSH (not just local commands)
- A **simpler config format** focused on the deployment workflow
- **Multi-server switching** without editing config files

## License

MIT
