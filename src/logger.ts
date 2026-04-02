import * as vscode from 'vscode';

export class Logger {
    private readonly channel: vscode.OutputChannel;

    constructor() {
        this.channel = vscode.window.createOutputChannel('SFTP Deploy');
    }

    show() {
        this.channel.show(true);
    }

    info(msg: string) {
        this.log('INFO', msg);
    }

    success(msg: string) {
        this.log('OK  ', msg);
    }

    error(msg: string) {
        this.log('ERR ', msg);
        const showOnUpload = vscode.workspace.getConfiguration('sftpDeploy').get<boolean>('showOutputOnUpload');
        if (showOnUpload) { this.channel.show(true); }
    }

    warn(msg: string) {
        this.log('WARN', msg);
    }

    separator() {
        this.channel.appendLine('─'.repeat(60));
    }

    private log(level: string, msg: string) {
        const time = new Date().toTimeString().slice(0, 8);
        this.channel.appendLine(`[${time}] [${level}] ${msg}`);
    }

    dispose() {
        this.channel.dispose();
    }
}
