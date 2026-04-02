import * as vscode from 'vscode';
import * as path from 'path';
import { ConfigManager } from './configManager';
import { Uploader } from './uploader';
import { CommandRunner } from './commandRunner';
import { DockerDeployer } from './dockerDeployer';
import { StatusBarManager } from './statusBar';
import { Logger } from './logger';
import { KnownHostsManager } from './knownHosts';
import { ServerConfig } from './types';

let activeServer: ServerConfig | undefined;
let autoUploadEnabled = false;

export function activate(context: vscode.ExtensionContext) {
    console.log('SFTP Deploy: activate() called');

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    console.log('SFTP Deploy: workspaceRoot =', workspaceRoot);
    if (!workspaceRoot) { return; }

    const logger = new Logger();
    const configManager = new ConfigManager(workspaceRoot);
    const knownHosts = new KnownHostsManager(context.globalStorageUri.fsPath);
    const uploader = new Uploader(logger, knownHosts);
    const dockerDeployer = new DockerDeployer(logger, knownHosts);
    const commandRunner = new CommandRunner(logger, knownHosts);
    const statusBar = new StatusBarManager();

    // Load initial config
    function initFromConfig() {
        console.log('SFTP Deploy: initFromConfig() called');
        const cfg = configManager.load();
        console.log('SFTP Deploy: config loaded =', cfg ? 'yes' : 'no');
        if (!cfg) {
            statusBar.setNoConfig();
            return;
        }

        autoUploadEnabled = cfg.autoUpload ?? false;
        activeServer = configManager.getDefaultServer();
        statusBar.setAutoUpload(autoUploadEnabled);
        statusBar.setServer(activeServer);
    }

    initFromConfig();

    // Watch for config changes
    const configWatcher = configManager.watchConfig(() => {
        logger.info('sftp.json changed — reloading config');
        initFromConfig();
    });

    // ─── Core deploy function ───────────────────────────────────────────────────

    function serverDescription(server: ServerConfig): string {
        if (server.type === 'docker') {
            return DockerDeployer.describe(server);
        }
        return `${server.user}@${server.host}`;
    }

    async function deployFile(uri: vscode.Uri) {
        const server = activeServer;
        if (!server) {
            vscode.window.showErrorMessage('SFTP Deploy: No server selected. Configure sftp-deploy.json first.');
            return;
        }

        const filePath = uri.fsPath;
        const mapping = configManager.getMappingForFile(filePath);
        if (!mapping) {
            vscode.window.showWarningMessage(`SFTP Deploy: No mapping found for this file.\nCheck "mappings" in sftp-deploy.json.`);
            return;
        }

        logger.show();
        logger.separator();
        logger.info(`Datei:   ${path.basename(filePath)}`);
        logger.info(`Lokal:   ${filePath}`);
        logger.info(`Server:  ${server.name}  (${serverDescription(server)})`);
        logger.info(`Remote:  ${mapping.remotePath}`);

        statusBar.setUploading(true);

        try {
            if (server.type === 'docker') {
                await dockerDeployer.uploadFile(filePath, server, mapping);
            } else {
                await uploader.uploadFile(filePath, server, mapping);
            }

            if (server.postUploadCommands?.length) {
                logger.info('Running post-upload commands...');
                await commandRunner.runAll(server.postUploadCommands, server, dockerDeployer);
            }

            logger.success(`Done ✓  ${path.basename(filePath)} → ${server.name}`);
            vscode.window.setStatusBarMessage(`$(check) Deployed: ${path.basename(filePath)} → ${server.name}`, 3000);
        } catch (err) {
            logger.error(`Upload failed: ${err}`);
            vscode.window.showErrorMessage(`SFTP Deploy: Upload failed — ${err}`);
        } finally {
            statusBar.setServer(server);
        }
    }

    async function deployFolder(uri: vscode.Uri) {
        const server = activeServer;
        if (!server) {
            vscode.window.showErrorMessage('SFTP Deploy: No server selected. Configure sftp-deploy.json first.');
            return;
        }

        const dirPath = uri.fsPath;
        const mapping = configManager.getMappingForFile(dirPath);
        if (!mapping) {
            vscode.window.showWarningMessage(`SFTP Deploy: No mapping found for this folder.\nCheck "mappings" in sftp-deploy.json.`);
            return;
        }

        logger.show();
        logger.separator();
        logger.info(`Ordner:  ${path.basename(dirPath)}`);
        logger.info(`Lokal:   ${dirPath}`);
        logger.info(`Server:  ${server.name}  (${serverDescription(server)})`);
        logger.info(`Remote:  ${mapping.remotePath}`);

        await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: `Uploading to ${server.name}...`, cancellable: false },
            async () => {
                try {
                    const count = server.type === 'docker'
                        ? await dockerDeployer.uploadDirectory(dirPath, server, mapping)
                        : await uploader.uploadDirectory(dirPath, server, mapping);

                    if (server.postUploadCommands?.length) {
                        logger.info('Running post-upload commands...');
                        await commandRunner.runAll(server.postUploadCommands, server, dockerDeployer);
                    }
                    logger.success(`Done ✓ — ${count} file(s) uploaded`);
                    vscode.window.showInformationMessage(`SFTP: Uploaded ${count} file(s) to ${server.name}`);
                } catch (err) {
                    logger.error(`Upload failed: ${err}`);
                    vscode.window.showErrorMessage(`SFTP Deploy: Upload failed — ${err}`);
                }
            }
        );
    }

    // ─── Commands ───────────────────────────────────────────────────────────────

    const uploadFile = vscode.commands.registerCommand('sftpDeploy.uploadFile', async (uri?: vscode.Uri) => {
        const target = uri ?? vscode.window.activeTextEditor?.document.uri;
        if (!target || target.scheme !== 'file') {
            vscode.window.showWarningMessage('SFTP Deploy: No file to upload.');
            return;
        }
        await deployFile(target);
    });

    const uploadFolder = vscode.commands.registerCommand('sftpDeploy.uploadFolder', async (uri?: vscode.Uri) => {
        if (!uri) {
            vscode.window.showWarningMessage('SFTP Deploy: No folder selected.');
            return;
        }
        await deployFolder(uri);
    });

    const switchServer = vscode.commands.registerCommand('sftpDeploy.switchServer', async () => {
        const cfg = configManager.get();
        if (!cfg?.servers.length) {
            vscode.window.showWarningMessage('SFTP Deploy: No servers configured in sftp.json.');
            return;
        }

        const items: vscode.QuickPickItem[] = cfg.servers.map(s => ({
            label: s.name,
            description: `${s.user}@${s.host}${s.port && s.port !== 22 ? ':' + s.port : ''}`,
            detail: s.postUploadCommands?.filter(c => c.enabled !== false).map(c => c.command).join(' → ') ?? '',
        }));

        const picked = await vscode.window.showQuickPick(items, {
            title: 'SFTP Deploy — Select Server',
            placeHolder: 'Choose a server...',
        });

        if (picked) {
            activeServer = configManager.getServer(picked.label);
            statusBar.setServer(activeServer);
            logger.info(`Switched to server: ${picked.label}`);
            vscode.window.setStatusBarMessage(`$(arrow-swap) Server: ${picked.label}`, 3000);
        }
    });

    const toggleAutoUpload = vscode.commands.registerCommand('sftpDeploy.toggleAutoUpload', () => {
        autoUploadEnabled = !autoUploadEnabled;
        statusBar.setAutoUpload(autoUploadEnabled);
        statusBar.setServer(activeServer);
        const state = autoUploadEnabled ? 'enabled' : 'disabled';
        vscode.window.setStatusBarMessage(`$(sync) SFTP Auto-Upload ${state}`, 3000);
        logger.info(`Auto-upload ${state}`);
    });

    // ─── Auto-upload on save (debounced to prevent double-fire) ──────────────────

    const pendingUploads = new Map<string, ReturnType<typeof setTimeout>>();

    const onSave = vscode.workspace.onDidSaveTextDocument(async (doc) => {
        if (!autoUploadEnabled) { return; }
        if (doc.uri.scheme !== 'file') { return; }

        const key = doc.uri.fsPath;
        const existing = pendingUploads.get(key);
        if (existing) { clearTimeout(existing); }

        const timer = setTimeout(async () => {
            pendingUploads.delete(key);
            await deployFile(doc.uri);
        }, 300);

        pendingUploads.set(key, timer);
    });

    const forgetHost = vscode.commands.registerCommand('sftpDeploy.forgetHost', async () => {
        const cfg = configManager.get();
        if (!cfg?.servers.length) {
            vscode.window.showWarningMessage('SFTP Deploy: No servers configured.');
            return;
        }
        const items: vscode.QuickPickItem[] = [
            { label: '$(trash) Forget all hosts', description: 'Remove all stored host keys' },
            ...cfg.servers.map(s => ({
                label: s.name,
                description: `${s.host}:${s.port ?? 22}`,
            })),
        ];
        const picked = await vscode.window.showQuickPick(items, {
            title: 'SFTP Deploy — Forget Host Key',
            placeHolder: 'Which host key should be removed?',
        });
        if (!picked) { return; }
        if (picked.label.includes('Forget all hosts')) {
            knownHosts.forgetAll();
            vscode.window.showInformationMessage('SFTP Deploy: All stored host keys removed.');
        } else {
            const server = configManager.getServer(picked.label);
            if (server) {
                knownHosts.forget(server.host ?? '', server.port ?? 22);
                vscode.window.showInformationMessage(`SFTP Deploy: Host key for "${server.name}" removed.`);
            }
        }
    });

    // ─── Register all disposables ────────────────────────────────────────────────

    context.subscriptions.push(
        logger,
        statusBar,
        configWatcher,
        uploadFile,
        uploadFolder,
        switchServer,
        toggleAutoUpload,
        forgetHost,
        onSave,
    );
}

export function deactivate() {}
