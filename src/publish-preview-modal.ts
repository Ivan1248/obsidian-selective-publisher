import { App, Modal, TFile, ButtonComponent, Setting } from 'obsidian'
import * as fs from 'fs/promises'

export const enum FileUpdateStatus {
    New = 'new',
    Modified = 'modified',
    Unmodified = 'unmodified',
    Deleted = 'deleted',
}

export async function getFileStatus(srcFile: TFile, destPath: string): Promise<FileUpdateStatus> {
    try {
        const stats = await fs.stat(destPath)
        if (srcFile.stat.mtime > stats.mtimeMs) {  // Obsidian mtime is in ms
            return FileUpdateStatus.Modified
        }
    } catch {
        return FileUpdateStatus.New
    }
    return FileUpdateStatus.Unmodified
}

export interface FileWithStatus {
    path: string
    status: FileUpdateStatus
}

export type PublishAction = 'publish' | 'commit'

export class PublishPreviewModal extends Modal {
    constructor(app: App, private fileStatuses: FileWithStatus[], private hasUncommittedChanges: boolean, private onAction: (action: PublishAction) => Promise<void>) {
        super(app)
    }

    onOpen() {
        const { contentEl } = this
        contentEl.empty()
        contentEl.addClass('sp-publish-preview-modal')
        contentEl.createEl('h2', { text: 'Publishing preview' })

        const sortedFiles = [...this.fileStatuses].sort((a, b) => a.path.localeCompare(b.path))
        const changed = sortedFiles.filter(f => f.status !== FileUpdateStatus.Unmodified)
        const unmodified = sortedFiles.filter(f => f.status === FileUpdateStatus.Unmodified)
        if (sortedFiles.length === 0 && !this.hasUncommittedChanges) {
            contentEl.createEl('p', { text: 'No files match the current publishing criteria and no files to unpublish.' })
        } else {
            if (changed.length === 0 && !this.hasUncommittedChanges) {
                contentEl.createEl('p', { text: 'Published files are up to date. No changes to publish.' })
            } else {
                this.renderFileList(contentEl, 'Changed files', changed)

                const btnContainer = contentEl.createEl('div', { cls: 'modal-button-container' })
                new ButtonComponent(btnContainer)
                    .setButtonText('Publish')
                    .setCta()
                    .onClick(async () => {
                        this.close()
                        await this.onAction('publish')
                    })

                new ButtonComponent(btnContainer)
                    .setButtonText('Commit')
                    .onClick(async () => {
                        this.close()
                        await this.onAction('commit')
                    })
            }

            this.renderFileList(contentEl, 'Unmodified published files', unmodified, true)
        }
    }

    private renderFileList(container: HTMLElement, title: string, files: FileWithStatus[], hideBadge = false) {
        if (files.length === 0) return

        new Setting(container).setName(`${title} (${files.length})`).setHeading()
        const listEl = container.createEl('ul', { cls: 'sp-publish-preview-list' })

        for (const { path, status } of files) {
            const li = listEl.createEl('li', { cls: `is-${status}` })
            li.createEl('span', { text: path, cls: 'sp-publish-path' })
            if (!hideBadge) {
                li.createEl('span', { text: status, cls: 'sp-publish-badge' })
            }
        }
    }

    onClose() {
        this.contentEl.empty()
    }
}
