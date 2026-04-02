export interface PostUploadCommand {
    /** "local" runs the command on the local machine, "ssh" runs it on the remote server */
    type: 'local' | 'ssh';
    command: string;
    /** Disable this command without removing it (default: true) */
    enabled?: boolean;
    /** If true, failure won't stop subsequent commands (default: false) */
    continueOnError?: boolean;
}

export interface ServerConfig {
    name: string;
    host: string;
    port?: number;           // default: 22
    user: string;
    privateKey?: string;     // path to private key, ~ expanded
    password?: string;       // alternative to privateKey
    passphrase?: string;     // passphrase for encrypted private key
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
