import * as vscode from 'vscode';
import { ServerConfig } from './types';

export class StatusBarManager {
    private readonly item: vscode.StatusBarItem;
    private autoUpload = false;

    constructor() {
        this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        this.item.command = 'sftpDeploy.switchServer';
        this.item.tooltip = 'SFTP Deploy — click to switch server';
    }

    setNoConfig() {
        this.item.text = '$(cloud-upload) SFTP: no config';
        this.item.tooltip = 'SFTP Deploy — create .vscode/sftp-deploy.json to configure';
        this.item.show();
    }

    setServer(server: ServerConfig | undefined) {
        if (!server) {
            this.item.text = '$(cloud-upload) SFTP: no server';
            this.item.backgroundColor = undefined;
        } else {
            const autoIcon = this.autoUpload ? '$(sync)' : '$(cloud-upload)';
            this.item.text = `${autoIcon} ${server.name}`;
        }
        this.item.show();
    }

    setAutoUpload(enabled: boolean) {
        this.autoUpload = enabled;
    }

    setUploading(uploading: boolean) {
        if (uploading) {
            this.item.text = this.item.text.replace(/^\$\([^)]+\)/, '$(loading~spin)');
        }
    }

    hide() {
        this.item.hide();
    }

    dispose() {
        this.item.dispose();
    }
}
