import * as fs from 'fs';
import { ConnectConfig } from 'ssh2';
import { ServerConfig } from './types';
import { ConfigManager } from './configManager';
import { KnownHostsManager } from './knownHosts';

/**
 * Builds the ssh2 ConnectConfig for a server, including host key verification.
 * The hostVerifier checks the server's fingerprint against the local known-hosts store
 * and prompts the user on first connection or when the fingerprint has changed.
 */
export function buildConnectConfig(server: ServerConfig, knownHosts: KnownHostsManager): ConnectConfig {
    const cfg: ConnectConfig = {
        host: server.host,
        port: server.port ?? 22,
        username: server.user,
        hostVerifier: (key: Buffer, callback: (valid: boolean) => void) => {
            knownHosts.verify(server.host, server.port ?? 22, key)
                .then(callback)
                .catch(() => callback(false));
        },
    };

    if (server.privateKey) {
        cfg.privateKey = fs.readFileSync(ConfigManager.expandPath(server.privateKey));
        if (server.passphrase) { cfg.passphrase = server.passphrase; }
    } else if (server.password) {
        cfg.password = server.password;
    }

    return cfg;
}
