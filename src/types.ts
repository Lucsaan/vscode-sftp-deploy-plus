export interface PostUploadCommand {
    /** "local" runs on the developer's machine, "ssh" on the remote server, "docker" inside the container */
    type: 'local' | 'ssh' | 'docker';
    command: string;
    /** Disable this command without removing it (default: true) */
    enabled?: boolean;
    /** If true, failure won't stop subsequent commands (default: false) */
    continueOnError?: boolean;
}

export interface ServerConfig {
    name: string;
    /** Transport type: "ssh" (default) uses SFTP, "docker" uses docker cp/exec */
    type?: 'ssh' | 'docker';

    // ─── SSH fields (type: "ssh") ────────────────────────────────────────────
    host?: string;
    port?: number;           // default: 22
    user?: string;
    privateKey?: string;     // path to private key, ~ expanded
    password?: string;       // alternative to privateKey
    passphrase?: string;     // passphrase for encrypted private key

    // ─── Docker fields (type: "docker") ──────────────────────────────────────
    /** Docker container name or ID */
    container?: string;
    /** Optional: run docker commands via SSH on a remote host (host:port) instead of local docker */
    dockerHost?: string;
    dockerPort?: number;
    dockerUser?: string;
    dockerPrivateKey?: string;
    dockerPassphrase?: string;
    dockerPassword?: string;

    postUploadCommands?: PostUploadCommand[];
}

export interface PathMapping {
    /** Local root directory (absolute or ~-relative) */
    localPath: string;
    /** Remote root directory */
    remotePath: string;
    /** Optional label for display */
    name?: string;
}

export interface SftpConfig {
    /** Enable auto-upload on file save (default: false) */
    autoUpload?: boolean;
    /** Name of the server to use by default */
    defaultServer?: string;
    servers: ServerConfig[];
    /** Path mappings: which local folder maps to which remote path */
    mappings: PathMapping[];
}
