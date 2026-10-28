import { Notice, Plugin, TFile } from 'obsidian'
import { PublishPreviewModal, PublishAction } from './ui/publish-preview-modal'
import { FailureModal } from './ui/failure-modal'
import { matchesGlobPatterns } from './criteria/glob'
import { Criterion } from './criteria/criteria'
import { SelectivePublisherSettings, DEFAULT_SETTINGS } from './settings'
import { SelectivePublisherSettingTab } from './ui/settings-tab'
import { PublishingService } from './publishing/publishing-service'

async function filterAsync<T>(arr: T[], cond: (el: T) => Promise<boolean>): Promise<T[]> {
    const results = await Promise.all(arr.map(cond))
    return arr.filter((_, index) => results[index])
}

export default class SelectivePublisherPlugin extends Plugin {
    settings!: SelectivePublisherSettings
    publishingService!: PublishingService

    async onload() {
        await this.loadSettings()
        this.publishingService = new PublishingService(this.app, this.settings)

        this.addCommand({
            id: 'publish-notes',
            name: 'Publish notes',
            callback: () => this.publishNotes(),
        })

        this.addCommand({
            id: 'preview-publishable',
            name: 'Preview publishable files',
            callback: () => this.previewPublishableFiles(),
        })

        this.addRibbonIcon('paper-plane', 'Publish notes', () => { void this.publishNotes() })

        this.addSettingTab(new SelectivePublisherSettingTab(this.app, this))
    }

    async getPublishableFiles(): Promise<TFile[]> {
        const markdownFiles = this.app.vault.getMarkdownFiles()
        const publishableNotes = await this.filterPublishableFiles(markdownFiles)

        const publishableSet = new Set<TFile>()
        for (const file of publishableNotes) {
            publishableSet.add(file)
        }

        if (this.settings.publishAttachments) {
            for (const file of publishableNotes) {
                const referencedAttachments = this.getReferencedAttachments(file)
                referencedAttachments.forEach(attachment => publishableSet.add(attachment))
            }
        }

        if (this.settings.extraFilePatterns.trim()) {
            const allFiles = this.app.vault.getFiles().filter(f => matchesGlobPatterns(this.settings.extraFilePatterns, f.path.replace(/\\/g, '/')))
            for (const file of allFiles) {
                publishableSet.add(file)
            }
        }

        return Array.from(publishableSet)
    }

    private getReferencedAttachments(file: TFile): TFile[] {
        const metadata = this.app.metadataCache.getFileCache(file)
        if (!metadata) return []

        const attachments: TFile[] = []
        const links = [...(metadata.links ?? []), ...(metadata.embeds ?? [])]

        for (const link of links) {
            const linkPath = link.link.split('#')[0]!
            const linkedFile = this.app.metadataCache.getFirstLinkpathDest(linkPath, file.path)
            if (linkedFile instanceof TFile && linkedFile.extension !== 'md') {
                attachments.push(linkedFile)
            }
        }

        return attachments
    }

    async previewPublishableFiles() {
        try {
            if (!await this.switchToPublishingBranch()) return

            const publishableFiles = await this.getPublishableFiles()
            const [fileStatuses, repoHasUncommittedChanges] = await Promise.all([
                this.publishingService.getPublishingStatuses(publishableFiles),
                this.publishingService.hasUncommittedChanges(),
            ])

            if (fileStatuses.length === 0 && !repoHasUncommittedChanges) {
                new Notice('No files to publish or unpublish.')
                return
            }

            const modal = new PublishPreviewModal(this.app, fileStatuses, repoHasUncommittedChanges,
                (action: PublishAction) => this.publishNotes({
                    commitOnly: action === 'commit',
                    skipPreview: true,
                    cachedPublishableFiles: publishableFiles,
                }),
                (path: string) => this.publishingService.getFileDiff(path))
            modal.open()
        } catch (error) {
            console.error('Preview failed:', error)
            new FailureModal(this.app, error as Error, this.settings.repo).open()
        }
    }

    async publishNotes({ commitOnly = false, skipPreview = false, cachedPublishableFiles }: {
        commitOnly?: boolean
        skipPreview?: boolean
        cachedPublishableFiles?: TFile[]
    } = {}) {
        try {
            if (!skipPreview && this.settings.showPreviewBeforePublishing) {
                await this.previewPublishableFiles()
                return
            }

            const branch = await this.switchToPublishingBranch()
            if (!branch) return

            const operationName = commitOnly ? 'commit' : 'publish'
            new Notice(`Starting ${operationName} operation...`)

            const publishableFiles = cachedPublishableFiles ?? await this.getPublishableFiles()
            await this.publishingService.publishFiles(publishableFiles, branch, { commitOnly })
            const noteCount = publishableFiles.filter(f => f.extension === 'md').length
            new Notice(`Successfully ${operationName}ed ${noteCount} notes.`)
        } catch (error) {
            console.error('Publishing failed:', error)
            new FailureModal(this.app, error as Error, this.settings.repo).open()
        }
    }

    /** Switches to the publishing branch and returns its name, or undefined if there is none. */
    private async switchToPublishingBranch(): Promise<string | undefined> {
        const branch = await this.publishingService.switchToPublishingBranch()
        if (!branch) {
            new Notice('No branch is checked out. Please select a branch in the settings.')
            return undefined
        }
        if (branch.isNewlyCheckedOut) new Notice(`Switched to branch "${branch.name}".`)
        return branch.name
    }

    async filterPublishableFiles(files: TFile[]): Promise<TFile[]> {
        return filterAsync(files, file => this.isFilePublishable(file))
    }

    async isFilePublishable(file: TFile): Promise<boolean> {
        try {
            const metadata = this.app.metadataCache.getFileCache(file)
            if (!metadata) {
                return false
            }
            const content = await this.app.vault.read(file)
            return this.settings.criterion.evaluate(file, content, metadata)
        } catch (error) {
            console.error(`Error evaluating publishability for ${file.path}:`, error)
            return false
        }
    }

    async loadSettings() {
        type SavedData = Partial<Omit<SelectivePublisherSettings, 'criterion'> & { criterion: import('./criteria/criteria').SerializedCriterion }>
        const data = (await this.loadData()) as SavedData | null
        this.settings = Object.assign({}, DEFAULT_SETTINGS)

        if (data) {
            if (data.criterion) this.settings.criterion = Criterion.deserialize(data.criterion)
            if (data.repo) this.settings.repo = data.repo
            if (data.repoBranch) this.settings.repoBranch = data.repoBranch
            if (data.commitMessage) this.settings.commitMessage = data.commitMessage
            if (data.showPreviewBeforePublishing !== undefined) {
                this.settings.showPreviewBeforePublishing = data.showPreviewBeforePublishing
            }
            if (data.publishAttachments !== undefined) {
                this.settings.publishAttachments = data.publishAttachments
            }
            if (data.extraFilePatterns !== undefined) {
                this.settings.extraFilePatterns = data.extraFilePatterns
            }
        }
    }

    async saveSettings() {
        const data = {
            ...this.settings,
            criterion: this.settings.criterion.serialize(),
        }
        await this.saveData(data)
    }
}
