import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as vscode from 'vscode';
import { Client } from 'ssh2';
import { ServerConfig, PathMapping, PostUploadCommand } from './types';
import { ConfigManager } from './configManager';
import { KnownHostsManager } from './knownHosts';
import { buildConnectConfig } from './sshConfig';
import { Logger } from './logger';

const execAsync = promisify(exec);

/**
 * Handles file deployment and post-upload commands for Docker-based servers.
 *
 * Supports two modes:
 * - Local Docker: runs `docker cp` / `docker exec` directly on the developer's machine.
 * - Remote Docker via SSH: SSHs into a remote host, then runs docker commands there.
 */
export class DockerDeployer {
    constructor(
        private readonly logger: Logger,
        private readonly knownHosts: KnownHostsManager,
    ) {}

    async uploadFile(localFilePath: string, server: ServerConfig, mapping: PathMapping): Promise<void> {
        const container = server.container;
        if (!container) { throw new Error(`Docker server "${server.name}" is missing "container"`); }

        const localRoot = ConfigManager.expandPath(mapping.localPath);
        const remoteRoot = mapping.remotePath.replace(/\/$/, '');

        if (!localFilePath.startsWith(localRoot)) {
            this.logger.warn(`File is outside mapping localPath — skipping`);
            this.logger.warn(`  File:    ${localFilePath}`);
            this.logger.warn(`  Mapping: ${localRoot}`);
            return;
        }

        const relativePath = localFilePath.slice(localRoot.length);
        const remotePath = path.posix.normalize(remoteRoot + relativePath.replace(/\\/g, '/'));

        this.logger.info(`Uploading → docker:${container}:${remotePath}`);

        if (server.dockerHost) {
            await this.uploadViaSSH(localFilePath, remotePath, container, server);
        } else {
            await this.uploadLocal(localFilePath, remotePath, container);
        }

        this.logger.success(`Uploaded  ✓ ${path.basename(localFilePath)}`);
    }

    async uploadDirectory(localDirPath: string, server: ServerConfig, mapping: PathMapping): Promise<number> {
        const container = server.container;
        if (!container) { throw new Error(`Docker server "${server.name}" is missing "container"`); }

        const localRoot = ConfigManager.expandPath(mapping.localPath);
        const remoteRoot = mapping.remotePath.replace(/\/$/, '');

        if (!localDirPath.startsWith(localRoot)) {
            this.logger.warn(`Directory is outside mapping localPath — skipping`);
            return 0;
        }

        const relativePath = localDirPath.slice(localRoot.length);
        const remotePath = path.posix.normalize(remoteRoot + (relativePath.replace(/\\/g, '/') || '/'));

        this.logger.info(`Uploading directory → docker:${container}:${remotePath}`);

        if (server.dockerHost) {
            await this.uploadDirViaSSH(localDirPath, remotePath, container, server);
        } else {
            await this.uploadDirLocal(localDirPath, remotePath, container);
        }

        // Count is approximate (docker cp copies recursively, no per-file callback)
        return 1;
    }

    async runCommand(cmd: PostUploadCommand, server: ServerConfig): Promise<void> {
        if (cmd.enabled === false) {
            this.logger.info(`[skipped] ${cmd.command}`);
            return;
        }

        const container = server.container;
        if (!container) { throw new Error(`Docker server "${server.name}" is missing "container"`); }

        if (server.dockerHost) {
            await this.runCommandViaSSH(cmd.command, container, server);
        } else {
            await this.runCommandLocal(cmd.command, container);
        }
    }

    // ─── Local Docker ─────────────────────────────────────────────────────────

    private async uploadLocal(localPath: string, remotePath: string, container: string): Promise<void> {
        const destDir = path.posix.dirname(remotePath);
        // Ensure remote directory exists
        await this.execLocal(`docker exec "${container}" mkdir -p "${destDir}"`);
        await this.execLocal(`docker cp "${localPath}" "${container}:${remotePath}"`);
    }

    private async uploadDirLocal(localDir: string, remotePath: string, container: string): Promise<void> {
        await this.execLocal(`docker exec "${container}" mkdir -p "${remotePath}"`);
        // docker cp copies the *contents* when source ends with /.
        await this.execLocal(`docker cp "${localDir}/." "${container}:${remotePath}"`);
    }

    private async runCommandLocal(command: string, container: string): Promise<void> {
        this.logger.info(`[docker:${container}] $ ${command}`);
        await this.execLocal(`docker exec "${container}" sh -c ${JSON.stringify(command)}`);
    }

    private async execLocal(cmd: string): Promise<void> {
        const { stdout, stderr } = await execAsync(cmd);
        if (stdout.trim()) { this.logger.info(`[docker] ${stdout.trim()}`); }
        if (stderr.trim()) { this.logger.warn(`[docker] ${stderr.trim()}`); }
    }

    // ─── Remote Docker via SSH ────────────────────────────────────────────────

    private uploadViaSSH(
        localPath: string,
        remotePath: string,
        container: string,
        server: ServerConfig,
    ): Promise<void> {
        return new Promise((resolve, reject) => {
            const conn = new Client();
            conn.on('ready', () => {
                // First ensure remote dir exists, then upload via sftp + docker cp trick:
                // We upload to a temp path, then docker cp into the container.
                const tmpPath = `/tmp/sftp-deploy-${Date.now()}-${path.basename(remotePath)}`;
                const destDir = path.posix.dirname(remotePath);

                conn.sftp((sftpErr, sftp) => {
                    if (sftpErr) { conn.end(); return reject(sftpErr); }

                    sftp.fastPut(localPath, tmpPath, (putErr) => {
                        if (putErr) { conn.end(); return reject(putErr); }

                        const dockerCmd =
                            `mkdir -p /tmp/sftp-deploy-dirs && ` +
                            `docker exec "${container}" mkdir -p "${destDir}" && ` +
                            `docker cp "${tmpPath}" "${container}:${remotePath}" && ` +
                            `rm -f "${tmpPath}"`;

                        conn.exec(dockerCmd, (execErr, stream) => {
                            if (execErr) { conn.end(); return reject(execErr); }

                            let stderr = '';
                            stream.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
                            stream.on('close', (code: number) => {
                                conn.end();
                                if (stderr.trim()) { this.logger.warn(`[ssh+docker] ${stderr.trim()}`); }
                                code !== 0 ? reject(new Error(`docker cp failed (exit ${code})`)) : resolve();
                            });
                        });
                    });
                });
            });
            conn.on('error', (err) => { conn.end(); reject(err); });
            conn.connect(this.buildSSHConfig(server));
        });
    }

    private uploadDirViaSSH(
        localDir: string,
        remotePath: string,
        container: string,
        server: ServerConfig,
    ): Promise<void> {
        return new Promise((resolve, reject) => {
            const conn = new Client();
            conn.on('ready', () => {
                const tmpDir = `/tmp/sftp-deploy-dir-${Date.now()}`;

                // We use tar: pack locally, upload via SFTP as a tar, extract on host, docker cp into container
                // Simpler approach: use scp of tar via exec
                const packCmd = `cd "${localDir}" && tar czf - . | base64`;
                exec(packCmd, { maxBuffer: 50 * 1024 * 1024 }, (err, stdout) => {
                    if (err) { conn.end(); return reject(err); }

                    const dockerCmd =
                        `mkdir -p ${tmpDir} && ` +
                        `echo ${JSON.stringify(stdout)} | base64 -d | tar xzf - -C ${tmpDir} && ` +
                        `docker exec "${container}" mkdir -p "${remotePath}" && ` +
                        `docker cp "${tmpDir}/." "${container}:${remotePath}" && ` +
                        `rm -rf "${tmpDir}"`;

                    conn.exec(dockerCmd, (execErr, stream) => {
                        if (execErr) { conn.end(); return reject(execErr); }
                        let stderr = '';
                        stream.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
                        stream.on('close', (code: number) => {
                            conn.end();
                            if (stderr.trim()) { this.logger.warn(`[ssh+docker] ${stderr.trim()}`); }
                            code !== 0 ? reject(new Error(`docker cp dir failed (exit ${code})`)) : resolve();
                        });
                    });
                });
            });
            conn.on('error', (err) => { conn.end(); reject(err); });
            conn.connect(this.buildSSHConfig(server));
        });
    }

    private runCommandViaSSH(command: string, container: string, server: ServerConfig): Promise<void> {
        this.logger.info(`[ssh+docker:${container}] $ ${command}`);
        return new Promise((resolve, reject) => {
            const conn = new Client();
            conn.on('ready', () => {
                const dockerCmd = `docker exec "${container}" sh -c ${JSON.stringify(command)}`;
                conn.exec(dockerCmd, (err, stream) => {
                    if (err) { conn.end(); return reject(err); }
                    let stdout = '';
                    let stderr = '';
                    stream.on('data', (d: Buffer) => { stdout += d.toString(); });
                    stream.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
                    stream.on('close', (code: number) => {
                        conn.end();
                        if (stdout.trim()) { this.logger.info(`[docker] ${stdout.trim()}`); }
                        if (stderr.trim()) { this.logger.warn(`[docker] ${stderr.trim()}`); }
                        code !== 0 ? reject(new Error(`Exit code ${code}`)) : resolve();
                    });
                });
            });
            conn.on('error', (err) => { conn.end(); reject(err); });
            conn.connect(this.buildSSHConfig(server));
        });
    }

    private buildSSHConfig(server: ServerConfig) {
        // For remote docker, we reuse KnownHostsManager with the docker host
        const remoteServer = {
            ...server,
            host: server.dockerHost!,
            port: server.dockerPort,
            user: server.dockerUser ?? server.user ?? 'root',
            privateKey: server.dockerPrivateKey ?? server.privateKey,
            passphrase: server.dockerPassphrase ?? server.passphrase,
            password: server.dockerPassword ?? server.password,
        };
        return buildConnectConfig(remoteServer as any, this.knownHosts);
    }

    /** Returns a short description for display in the status bar / logger */
    static describe(server: ServerConfig): string {
        if (server.dockerHost) {
            return `docker:${server.container} via ${server.dockerHost}`;
        }
        return `docker:${server.container} (local)`;
    }

    /** Prompt user to confirm local docker commands if workspace is not trusted */
    static assertTrusted(): void {
        if (!vscode.workspace.isTrusted) {
            throw new Error(
                'Docker post-upload commands are disabled in untrusted workspaces. ' +
                'Trust this workspace in VS Code to enable them.'
            );
        }
    }
}
