import { App, Modal, ButtonComponent } from 'obsidian'
import { FileWithStatus, FileUpdateStatus } from './publishing-service'

export type PublishAction = 'publish' | 'commit'

export class PublishPreviewModal extends Modal {
    constructor(app: App, private fileStatuses: FileWithStatus[], private hasUncommittedChanges: boolean, private onAction: (action: PublishAction) => Promise<void>) {
        super(app)
    }

    onOpen() {
        const { contentEl, modalEl } = this
        this.setTitle('Publishing preview')
        modalEl.addClass('sp-modal-fixed-footer')
        contentEl.empty()

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
            }
            this.renderFileList(contentEl, 'Unmodified published files', unmodified, true)
        }

        const btnContainer = modalEl.createDiv('modal-button-container')

        if (changed.length > 0 || this.hasUncommittedChanges) {
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

        new ButtonComponent(btnContainer)
            .setButtonText('Cancel')
            .onClick(() => {
                this.close()
            })
    }

    private renderFileList(container: HTMLElement, title: string, files: FileWithStatus[], hideBadge = false) {
        if (files.length === 0) return

        container.createEl('h4', { text: `${title} (${files.length})` })
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
