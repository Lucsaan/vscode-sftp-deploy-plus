import * as fs from 'fs';
import * as path from 'path';
import { Client, ConnectConfig, SFTPWrapper } from 'ssh2';
import { ServerConfig, PathMapping } from './types';
import { ConfigManager } from './configManager';
import { Logger } from './logger';

export class Uploader {
    constructor(private readonly logger: Logger) {}

    async uploadFile(localFilePath: string, server: ServerConfig, mapping: PathMapping): Promise<void> {
        const localRoot = ConfigManager.expandPath(mapping.localPath);
        const remoteRoot = mapping.remotePath.replace(/\/$/, '');

        if (!localFilePath.startsWith(localRoot)) {
            this.logger.warn(`File is outside mapping localPath — skipping`);
            this.logger.warn(`  File:    ${localFilePath}`);
            this.logger.warn(`  Mapping: ${localRoot}`);
            return;
        }

        const relativePath = localFilePath.slice(localRoot.length);
        const remotePath = remoteRoot + relativePath.replace(/\\/g, '/');

        this.logger.info(`Uploading → ${server.name}:${remotePath}`);

        await this.sftpUpload(localFilePath, remotePath, server);
        this.logger.success(`Uploaded  ✓ ${path.basename(localFilePath)}`);
    }

    async uploadDirectory(localDirPath: string, server: ServerConfig, mapping: PathMapping): Promise<number> {
        const files = this.collectFiles(localDirPath);
        let count = 0;
        for (const f of files) {
            await this.uploadFile(f, server, mapping);
            count++;
        }
        return count;
    }

    private collectFiles(dir: string): string[] {
        const results: string[] = [];
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                results.push(...this.collectFiles(full));
            } else {
                results.push(full);
            }
        }
        return results;
    }

    private buildConnectConfig(server: ServerConfig): ConnectConfig {
        const cfg: ConnectConfig = {
            host: server.host,
            port: server.port ?? 22,
            username: server.user,
        };
        if (server.privateKey) {
            cfg.privateKey = fs.readFileSync(ConfigManager.expandPath(server.privateKey));
            if (server.passphrase) {
                cfg.passphrase = server.passphrase;
            }
        } else if (server.password) {
            cfg.password = server.password;
        }
        return cfg;
    }

    private sftpUpload(localPath: string, remotePath: string, server: ServerConfig): Promise<void> {
        return new Promise((resolve, reject) => {
            const conn = new Client();

            conn.on('ready', () => {
                conn.sftp((err, sftp: SFTPWrapper) => {
                    if (err) {
                        conn.end();
                        return reject(err);
                    }

                    this.ensureRemoteDir(sftp, path.posix.dirname(remotePath))
                        .then(() => {
                            sftp.fastPut(localPath, remotePath, (putErr) => {
                                conn.end();
                                if (putErr) { reject(putErr); } else { resolve(); }
                            });
                        })
                        .catch(dirErr => {
                            conn.end();
                            reject(dirErr);
                        });
                });
            });

            conn.on('error', reject);
            conn.connect(this.buildConnectConfig(server));
        });
    }

    private ensureRemoteDir(sftp: SFTPWrapper, dir: string): Promise<void> {
        return new Promise((resolve, reject) => {
            sftp.stat(dir, (err) => {
                if (!err) { return resolve(); }
                const parent = path.posix.dirname(dir);
                this.ensureRemoteDir(sftp, parent)
                    .then(() => {
                        sftp.mkdir(dir, (mkErr) => {
                            if (mkErr && (mkErr as NodeJS.ErrnoException).code !== 'EEXIST') {
                                reject(mkErr);
                            } else {
                                resolve();
                            }
                        });
                    })
                    .catch(reject);
            });
        });
    }
}
