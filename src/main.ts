import { Notice, Plugin, TFile } from 'obsidian'
import * as fs from 'fs/promises'
import * as path from 'path'
import { PublishPreviewModal, FileWithStatus, getFileStatus, FileUpdateStatus } from './publish-preview-modal'
import { Criterion, PathCriterion, AndCriterion, NotCriterion, TagCriterion, TitleCriterion } from './criterion'
import { SelectivePublisherSettingTab } from './settings-tab'
import { GitHelper } from './git-service'

interface SelectivePublisherSettings {
	publishRepo: string
	publishBranch: string
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
	publishRepo: '/path/to/publish/repo',
	publishBranch: 'main',
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

	async onload() {
		await this.loadSettings()

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
		this.updateStatusBar()

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

			// Get statuses for publishable files
			const fileStatuses: FileWithStatus[] = await Promise.all(
				publishableFiles.map(async (file) => ({
					path: file.path,
					status: await getFileStatus(file, path.join(this.settings.publishRepo, file.path)),
				}))
			)

			// Find files that would be deleted (exist in repo but not publishable)
			const publishablePaths = new Set(publishableFiles.map(f => f.path))
			const publishedFiles = await this.getPublishedMarkdownFiles()
			const deletedStatuses: FileWithStatus[] = publishedFiles
				.filter(publishedPath => !publishablePaths.has(publishedPath))
				.map(publishedPath => ({ path: publishedPath, status: FileUpdateStatus.Deleted }))

			const allStatuses = [...fileStatuses, ...deletedStatuses]

			if (allStatuses.length === 0) {
				new Notice('No files to publish or unpublish.')
				return
			}

			// Create a modal to display the list
			const modal = new PublishPreviewModal(this.app, allStatuses, (action) => this.publishNotes(action === 'commit', true))
			modal.open()
		} catch (error) {
			console.error('Preview failed:', error)
			new Notice(`Preview failed: ${(error as Error).message}`)
		}
	}

	async publishNotes(onlyCommit = false, skipPreview = false) {
		try {
			if (!skipPreview && this.settings.showPreviewBeforePublishing) {
				await this.previewPublishableNotes()
				return
			}

			if (!this.settings.publishBranch) {
				new Notice('No publishing branch selected. Please check the settings.')
				return
			}

			const operationStr = onlyCommit ? 'commit' : 'publish'
			new Notice(`Starting ${operationStr} operation...`)

			if (!onlyCommit) {
				await this.syncWithRemote()
			}

			const publishableFiles = await this.getPublishableFiles()
			await this.updatePublishRepoContent(publishableFiles)

			// Commit and optionally push changes
			try {
				await GitHelper.add(this.settings.publishRepo)
				await GitHelper.commit(this.settings.publishRepo, this.settings.commitMessage)
				if (!onlyCommit) {
					await GitHelper.push(this.settings.publishRepo, this.settings.publishBranch)
				}
				new Notice(`Successfully ${operationStr}ed ${publishableFiles.length} notes.`)
			} catch (error) {
				console.error('Git operation failed:', error)
				throw new Error(`Git operation failed: ${(error as Error).message}`)
			}
		} catch (error) {
			console.error('Publishing failed:', error)
			new Notice(`Publishing failed: ${(error as Error).message}`)
		}
	}

	async filterPublishableFiles(files: TFile[]): Promise<TFile[]> {
		return filterAsync(files, file => this.isFilePublishable(file))
	}

	async isFilePublishable(file: TFile): Promise<boolean> {
		try {
			const metadata = this.app.metadataCache.getFileCache(file)
			if (!metadata) {
				// new Notice(`Metadata not found for file: ${file.path}`)
				return false
			}
			const content = await this.app.vault.read(file)
			return await this.settings.criterion.evaluate(file, content, metadata)
		} catch (error) {
			console.error(`Error evaluating publishability for ${file.path}:`, error)
			return false
		}
	}

	async updatePublishRepoContent(files: TFile[]) {
		await this.cleanupPublishRepo(files)
		await this.copyFilesToPublishRepo(files)
	}

	async copyFilesToPublishRepo(files: TFile[]) {
		for (const file of files)
			await this.copyFileToPublishRepo(file)
	}

	async copyFileToPublishRepo(file: TFile) {
		const content = await this.app.vault.read(file)
		const destPath = path.join(this.settings.publishRepo, file.path)

		// Process content (modify links, etc. if needed)
		const processedContent = SelectivePublisherPlugin.processContent(content, file)

		await fs.mkdir(path.dirname(destPath), { recursive: true })
		await fs.writeFile(destPath, processedContent)
	}

	static processContent(content: string, file: TFile): string {
		// Here could be a transformations needed for publishing if necessary
		return content
	}

	async getPublishedMarkdownFiles(): Promise<string[]> {
		try {
			const publishedFiles: string[] = []
			const repoPath = this.settings.publishRepo

			async function scanDirectory(dir: string) {
				const entries = await fs.readdir(dir, { withFileTypes: true })
				for (const entry of entries) {
					const fullPath = path.join(dir, entry.name)
					// Skip .git and .obsidian directories
					if (entry.isDirectory() && !entry.name.startsWith('.')) {
						await scanDirectory(fullPath)
					} else if (entry.isFile() && entry.name.endsWith('.md')) {
						// Get relative path from repo root
						const relativePath = path.relative(repoPath, fullPath).replace(/\\/g, '/')
						publishedFiles.push(relativePath)
					}
				}
			}

			await scanDirectory(repoPath)
			return publishedFiles
		} catch (error) {
			console.error('Failed to scan publish repo:', error)
			return []
		}
	}

	async cleanupPublishRepo(publishableFiles: TFile[]) {
		try {
			// Get set of paths that should be published
			const shouldPublish = new Set(publishableFiles.map(f => f.path))

			// Get all markdown files currently in publish repo
			const publishedFiles = await this.getPublishedMarkdownFiles()

			// Remove files that shouldn't be there
			for (const publishedPath of publishedFiles) {
				if (!shouldPublish.has(publishedPath)) {
					await this.deleteFileFromPublishRepo(publishedPath)
				}
			}
		} catch (error) {
			console.error('Cleanup failed:', error)
		}
	}

	async deleteFileFromPublishRepo(relativePath: string) {
		try {
			const destPath = path.join(this.settings.publishRepo, relativePath)
			// Check if file exists before attempting to delete
			try {
				await fs.access(destPath)
				await fs.unlink(destPath)
			} catch {
				// File doesn't exist, nothing to do
			}
		} catch (error) {
			console.error(`Failed to delete ${relativePath}:`, error)
		}
	}

	async syncWithRemote() {
		new Notice('Syncing with remote repository...')
		try {
			await GitHelper.pull(this.settings.publishRepo, this.settings.publishBranch)
		} catch (syncError) {
			// Merge conflict occurred
			throw new Error(`Cannot sync with remote: ${(syncError as Error).message}`)
		}
	}

	onunload() {
		// Clean up any event listeners or resources here
	}

	async loadSettings() {
		const data = await this.loadData()
		this.settings = Object.assign({}, DEFAULT_SETTINGS)

		if (data) {
			if (data.criterion) this.settings.criterion = Criterion.deserialize(data.criterion)
			if (data.publishRepo) this.settings.publishRepo = data.publishRepo
			if (data.publishBranch) this.settings.publishBranch = data.publishBranch
			if (data.commitMessage) this.settings.commitMessage = data.commitMessage
			if (data.showPreviewBeforePublish !== undefined) this.settings.showPreviewBeforePublishing = data.showPreviewBeforePublish
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
