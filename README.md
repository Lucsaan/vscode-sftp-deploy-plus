# SFTP Deploy+

> Deploy files to remote servers via SCP/SSH — with configurable post-upload commands.  
> Inspired by PhpStorm's SFTP deployment, built for VS Code.

## Features

- **Upload on Save** — automatically deploy files when you save them
- **Multi-Server Support** — configure multiple servers, switch with one click from the status bar
- **Post-Upload Commands** — run SSH commands on the remote server after every upload (e.g. clear cache, restart service)
- **Folder Upload** — deploy entire directories via Explorer context menu
- **Path Mappings** — map multiple local project folders to remote paths

## Getting Started

1. Install the extension
2. Create `.vscode/sftp-deploy.json` in your workspace (see example below)
3. Click the server name in the status bar to switch servers
4. Toggle auto-upload with the sync icon, or use `SFTP: Toggle Auto-Upload`

## Configuration

Create `.vscode/sftp-deploy.json`:

```json
{
  "autoUpload": false,
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

## Post-Upload Commands

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

## Why not just use the SFTP extension?

The popular [SFTP extension](https://marketplace.visualstudio.com/items?itemName=Natizyskunk.sftp) is great, but we needed:
- **Post-upload commands** that run on the remote server via SSH (not just local commands)
- A **simpler config format** focused on the deployment workflow
- **Multi-server switching** without editing config files

## License

MIT
