import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { SftpConfig, ServerConfig, PathMapping } from './types';

export class ConfigManager {
    private config: SftpConfig | undefined;
    private configPath: string | undefined;

    constructor(private readonly workspaceRoot: string) {
        this.configPath = path.join(workspaceRoot, '.vscode', 'sftp-deploy.json');
    }

    load(): SftpConfig | undefined {
        if (!this.configPath || !fs.existsSync(this.configPath)) {
            return undefined;
        }
        try {
            const raw = fs.readFileSync(this.configPath, 'utf-8');
            this.config = JSON.parse(raw) as SftpConfig;
            return this.config;
        } catch (err) {
            vscode.window.showErrorMessage(`SFTP Deploy: Failed to parse sftp-deploy.json — ${err}`);
            return undefined;
        }
    }

    get(): SftpConfig | undefined {
        return this.config ?? this.load();
    }

    getServer(name: string): ServerConfig | undefined {
        return this.get()?.servers.find(s => s.name === name);
    }

    getDefaultServer(): ServerConfig | undefined {
        const cfg = this.get();
        if (!cfg) { return undefined; }
        const name = cfg.defaultServer ?? cfg.servers[0]?.name;
        return name ? this.getServer(name) : cfg.servers[0];
    }

    isAutoUpload(): boolean {
        return this.get()?.autoUpload ?? false;
    }

    /** Find the best mapping for a given local file path */
    getMappingForFile(localFilePath: string): PathMapping | undefined {
        const mappings = this.get()?.mappings ?? [];
        // Sort by localPath length descending — most specific match wins
        const sorted = [...mappings].sort(
            (a, b) => ConfigManager.expandPath(b.localPath).length - ConfigManager.expandPath(a.localPath).length
        );
        return sorted.find(m => localFilePath.startsWith(ConfigManager.expandPath(m.localPath)));
    }

    watchConfig(onChange: () => void): vscode.Disposable {
        if (!this.configPath) { return { dispose: () => {} }; }
        const watcher = vscode.workspace.createFileSystemWatcher(this.configPath);
        watcher.onDidChange(() => { this.config = undefined; onChange(); });
        watcher.onDidCreate(() => { this.config = undefined; onChange(); });
        return watcher;
    }

    /** Expand ~ in paths */
    static expandPath(p: string): string {
        return p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p;
    }
}
