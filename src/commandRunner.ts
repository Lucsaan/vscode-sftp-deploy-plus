import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import { Client } from 'ssh2';
import { PostUploadCommand, ServerConfig } from './types';
import { ConfigManager } from './configManager';
import { Logger } from './logger';

const execAsync = promisify(exec);

export class CommandRunner {
    constructor(private readonly logger: Logger) {}

    async runAll(commands: PostUploadCommand[], server: ServerConfig): Promise<void> {
        for (const cmd of commands) {
            // Skip disabled commands
            if (cmd.enabled === false) {
                this.logger.info(`[skipped] ${cmd.command}`);
                continue;
            }
            try {
                if (cmd.type === 'local') {
                    await this.runLocal(cmd.command);
                } else {
                    await this.runSsh(cmd.command, server);
                }
            } catch (err) {
                const msg = `Command failed: ${cmd.command}\n  ${err}`;
                if (cmd.continueOnError) {
                    this.logger.warn(msg);
                } else {
                    throw new Error(msg);
                }
            }
        }
    }

    private async runLocal(command: string): Promise<void> {
        this.logger.info(`[local] $ ${command}`);
        const { stdout, stderr } = await execAsync(command);
        if (stdout.trim()) { this.logger.info(`[local] ${stdout.trim()}`); }
        if (stderr.trim()) { this.logger.warn(`[local] ${stderr.trim()}`); }
    }

    private runSsh(command: string, server: ServerConfig): Promise<void> {
        this.logger.info(`[ssh:${server.host}] $ ${command}`);
        return new Promise((resolve, reject) => {
            const conn = new Client();

            conn.on('ready', () => {
                conn.exec(command, (err, stream) => {
                    if (err) {
                        conn.end();
                        return reject(err);
                    }

                    let stdout = '';
                    let stderr = '';

                    stream.on('data', (data: Buffer) => { stdout += data.toString(); });
                    stream.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

                    stream.on('close', (code: number) => {
                        conn.end();
                        if (stdout.trim()) { this.logger.info(`[ssh] ${stdout.trim()}`); }
                        if (stderr.trim()) { this.logger.warn(`[ssh] ${stderr.trim()}`); }
                        if (code !== 0) {
                            reject(new Error(`Exit code ${code}`));
                        } else {
                            resolve();
                        }
                    });
                });
            });

            conn.on('error', reject);
            conn.connect(this.buildConnectConfig(server));
        });
    }

    private buildConnectConfig(server: ServerConfig) {
        const cfg: import('ssh2').ConnectConfig = {
            host: server.host,
            port: server.port ?? 22,
            username: server.user,
        };
        if (server.privateKey) {
            cfg.privateKey = fs.readFileSync(ConfigManager.expandPath(server.privateKey));
            if (server.passphrase) { cfg.passphrase = server.passphrase; }
        } else if (server.password) {
            cfg.password = server.password;
        }
        return cfg;
    }
}
