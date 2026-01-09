import { App, Modal, TFile } from 'obsidian'
import * as fs from 'fs/promises'

export const enum FileUpdateStatus {
    New = 'new',
    Modified = 'modified',
    Unmodified = 'unmodified',
    Deleted = 'deleted',
}

export async function getFileStatus(srcFile: TFile, destPath: string): Promise<FileUpdateStatus> {
    let isNew = false
    let isModified = false

    try {
        const stats = await fs.stat(destPath)
        // Obsidian mtime is in ms, fs.stat mtimeMs is in ms
        if (srcFile.stat.mtime > stats.mtimeMs) {
            isModified = true
        }
    } catch (error) {
        // File doesn't exist in repo
        isNew = true
    }

    return isNew ? FileUpdateStatus.New : isModified ? FileUpdateStatus.Modified : FileUpdateStatus.Unmodified
}

export interface FileWithStatus {
    path: string
    status: FileUpdateStatus
}

export type PublishAction = 'publish' | 'commit'

export class PublishPreviewModal extends Modal {
    constructor(app: App, private fileStatuses: FileWithStatus[], private onAction: (action: PublishAction) => Promise<void>) {
        super(app)
    }

    onOpen() {
        const { contentEl } = this
        contentEl.empty()
        contentEl.addClass('publish-preview-modal')
        contentEl.createEl('h2', { text: 'Publishing preview' })

        const sortedFiles = [...this.fileStatuses].sort((a, b) => a.path.localeCompare(b.path))
        const changed = sortedFiles.filter(f => f.status !== FileUpdateStatus.Unmodified)
        const unmodified = sortedFiles.filter(f => f.status === FileUpdateStatus.Unmodified)
        if (sortedFiles.length === 0) {
            contentEl.createEl('p', { text: 'No files match the current publishing criteria and no files to unpublish.' })
        } else {
            if (changed.length === 0) {
                contentEl.createEl('p', { text: 'Published files are up to date. No changes to publish.' })
            } else {
                this.renderFileList(contentEl, 'Changed files', changed)

                const btnContainer = contentEl.createEl('div', { cls: 'modal-button-container' })
                btnContainer.createEl('button', { text: 'Publish', cls: 'mod-cta' }).onclick = async () => {
                    this.close()
                    await this.onAction('publish')
                }
                btnContainer.createEl('button', { text: 'Commit' }).onclick = async () => {
                    this.close()
                    await this.onAction('commit')
                }
            }

            this.renderFileList(contentEl, 'Unmodified published files', unmodified, true)
        }
    }

    private renderFileList(container: HTMLElement, title: string, files: FileWithStatus[], hideBadge = false) {
        if (files.length === 0) return

        container.createEl('h3', { text: `${title} (${files.length})` })
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
