import { Notice, Plugin, TFile } from 'obsidian'
import { PublishPreviewModal, PublishAction } from './publish-preview-modal'
import { FailureModal } from './failure-modal'
import { Criterion, PathCriterion, AndCriterion, NotCriterion, TagCriterion, TitleCriterion } from './criterion'
import { SelectivePublisherSettingTab } from './settings-tab'
import { GitHelper } from './git-service'
import { PublishingService } from './publishing-service'

interface SelectivePublisherSettings {
    repo: string
    repoBranch: string
    criterion: Criterion
    commitMessage: string
    showPreviewBeforePublishing: boolean
}

async function filterAsync<T>(arr: T[], cond: (el: T) => Promise<boolean>): Promise<T[]> {
    const results = await Promise.all(arr.map(cond))
    return arr.filter((_, index) => results[index])
}

// Default criterion: notes with frontmatter "publish: true"
const DEFAULT_SETTINGS: SelectivePublisherSettings = {
    repo: '/path/to/publish/repo',
    repoBranch: 'main',
    criterion: new AndCriterion([
        new PathCriterion('^(?!.*(?:^|[\\/])_).*', true),
        new NotCriterion(new TagCriterion('todo')),
        new NotCriterion(new TitleCriterion('^Untitled.*', true))]),
    commitMessage: 'Update published notes',
    showPreviewBeforePublishing: true,
}

export default class SelectivePublisherPlugin extends Plugin {
    settings!: SelectivePublisherSettings
    statusBarItem!: HTMLElement
    publishingService!: PublishingService

    async onload() {
        await this.loadSettings()
        this.publishingService = new PublishingService(this.app, this.settings.repo)

        // Add publish command
        this.addCommand({
            id: 'publish-notes',
            name: 'Publish notes',
            callback: () => this.publishNotes(),
        })

        // Add preview command
        this.addCommand({
            id: 'preview-publishable',
            name: 'Preview publishable notes',
            callback: () => this.previewPublishableNotes(),
        })

        // Add a ribbon icon
        this.addRibbonIcon('paper-plane', 'Publish notes', async () => {
            await this.publishNotes()
        })

        // Add a status bar item
        this.statusBarItem = this.addStatusBarItem()
        void this.updateStatusBar()

        // This adds a settings tab so the user can configure various aspects of the plugin
        this.addSettingTab(new SelectivePublisherSettingTab(this.app, this))
    }

    async updateStatusBar() {
        const publishableFiles = await this.getPublishableFiles()
        this.statusBarItem.setText(`${publishableFiles.length} publishable notes`)
    }

    async getPublishableFiles(): Promise<TFile[]> {
        const files = this.app.vault.getMarkdownFiles()
        return await this.filterPublishableFiles(files)
    }

    async previewPublishableNotes() {
        try {
            const publishableFiles = await this.getPublishableFiles()
            const fileStatuses = await this.publishingService.getPublishingStatuses(publishableFiles)
            const hasUncommittedChanges = await GitHelper.hasUncommittedChanges(this.settings.repo)

            if (fileStatuses.length === 0 && !hasUncommittedChanges) {
                new Notice('No files to publish or unpublish.')
                return
            }

            const modal = new PublishPreviewModal(this.app, fileStatuses, hasUncommittedChanges, (action: PublishAction) => this.publishNotes(action === 'commit', true))
            modal.open()
        } catch (error) {
            console.error('Preview failed:', error)
            new FailureModal(this.app, error as Error, this.settings.repo).open()
        }
    }

    async publishNotes(onlyCommit = false, skipPreview = false) {
        try {
            if (!skipPreview && this.settings.showPreviewBeforePublishing) {
                await this.previewPublishableNotes()
                return
            }

            if (!this.settings.repoBranch) {
                new Notice('No publishing branch selected. Please check the settings.')
                return
            }

            const operationStr = onlyCommit ? 'commit' : 'publish'
            new Notice(`Starting ${operationStr} operation...`)

            if (!onlyCommit) {
                // Sync with remote repository if not onlyCommit
                try {
                    await GitHelper.pull(this.settings.repo, this.settings.repoBranch)
                } catch (syncError) {
                    // Merge conflict occurred
                    throw new Error(`Cannot sync with remote: ${(syncError as Error).message}`)
                }
            }

            const publishableFiles = await this.getPublishableFiles()
            await this.publishingService.updateFilesInRepo(publishableFiles)

            // Commit and optionally push changes
            try {
                await GitHelper.add(this.settings.repo)
                await GitHelper.commit(this.settings.repo, this.settings.commitMessage)
                if (!onlyCommit) {
                    await GitHelper.push(this.settings.repo, this.settings.repoBranch)
                }
                new Notice(`Successfully ${operationStr}ed ${publishableFiles.length} notes.`)
            } catch (error) {
                console.error('Git operation failed:', error)
                throw new Error(`Git operation failed: ${(error as Error).message}`)
            }
        } catch (error) {
            console.error('Publishing failed:', error)
            new FailureModal(this.app, error as Error, this.settings.repo).open()
        }
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

    onunload() {
        // Clean up any event listeners or resources here
    }

    async loadSettings() {
        type SavedData = Partial<Omit<SelectivePublisherSettings, 'criterion'> & { criterion: import('./criterion').SerializedCriterion }>
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
        }
    }

    async saveSettings() {
        const data = {
            ...this.settings,
            criterion: this.settings.criterion.serialize(),
        }
        await this.saveData(data)
        // Update service if repo path changed
        this.publishingService = new PublishingService(this.app, this.settings.repo)
    }
}
