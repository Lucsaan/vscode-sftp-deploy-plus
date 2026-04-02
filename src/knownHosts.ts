import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

interface KnownHostsFile {
    hosts: Record<string, string>; // "host:port" → "SHA256:<base64>"
}

export class KnownHostsManager {
    private readonly filePath: string;
    private hosts: Record<string, string> = {};

    constructor(storagePath: string) {
        this.filePath = path.join(storagePath, 'known-hosts.json');
        this.load();
    }

    private load(): void {
        try {
            if (fs.existsSync(this.filePath)) {
                const raw = fs.readFileSync(this.filePath, 'utf-8');
                const parsed = JSON.parse(raw) as KnownHostsFile;
                this.hosts = parsed.hosts ?? {};
            }
        } catch {
            this.hosts = {};
        }
    }

    private save(): void {
        const dir = path.dirname(this.filePath);
        if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); }
        fs.writeFileSync(this.filePath, JSON.stringify({ hosts: this.hosts }, null, 2), 'utf-8');
    }

    static fingerprint(key: Buffer): string {
        return 'SHA256:' + crypto.createHash('sha256').update(key).digest('base64');
    }

    /**
     * Verifies a server's host key.
     * - First connection: asks the user to trust the fingerprint, then saves it.
     * - Subsequent connections: compares against the stored fingerprint.
     * - Changed fingerprint: warns the user (possible MITM), asks to update or abort.
     */
    async verify(host: string, port: number, key: Buffer): Promise<boolean> {
        const hostKey = `${host}:${port}`;
        const fp = KnownHostsManager.fingerprint(key);
        const known = this.hosts[hostKey];

        if (!known) {
            const answer = await vscode.window.showWarningMessage(
                `SFTP Deploy: Unknown server "${host}:${port}"`,
                {
                    modal: true,
                    detail: `Fingerprint (SHA256):\n${fp}\n\nVerify this matches the server's host key before connecting.`,
                },
                'Trust and Connect',
            );
            if (answer === 'Trust and Connect') {
                this.hosts[hostKey] = fp;
                this.save();
                return true;
            }
            return false;
        }

        if (known !== fp) {
            const answer = await vscode.window.showErrorMessage(
                `⚠️ SFTP Deploy: Host key CHANGED for "${host}:${port}"`,
                {
                    modal: true,
                    detail: `Expected: ${known}\nReceived: ${fp}\n\nThis could indicate a man-in-the-middle attack. Only continue if you intentionally changed the server.`,
                },
                'Update and Connect',
            );
            if (answer === 'Update and Connect') {
                this.hosts[hostKey] = fp;
                this.save();
                return true;
            }
            return false;
        }

        // Known and fingerprint matches — connect silently
        return true;
    }

    /** Remove a single host entry (e.g. after a known server rebuild) */
    forget(host: string, port: number): void {
        const hostKey = `${host}:${port}`;
        delete this.hosts[hostKey];
        this.save();
    }

    /** Remove all stored host entries */
    forgetAll(): void {
        this.hosts = {};
        this.save();
    }
}
