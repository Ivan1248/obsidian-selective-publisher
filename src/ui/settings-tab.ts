import { App, PluginSettingTab, Setting, Notice, DropdownComponent, TextComponent, SettingDefinitionItem, debounce } from 'obsidian'
import SelectivePublisherPlugin from '../main'
import { validateGlobPatterns } from '../criteria/glob'
import { CriterionEditorModal } from './criterion-editor-modal'
import { BranchListResult, GitHelper } from '../publishing/git-helper'
import { dialog } from '@electron/remote'

export class SelectivePublisherSettingTab extends PluginSettingTab {
    plugin: SelectivePublisherPlugin
    /** Update functions of the rendered setting rows that depend on the publishing folder */
    private readonly repoListeners = new Set<(result: BranchListResult) => void>()
    /** Branches of the publishing folder, listed once for all setting rows until the folder changes */
    private branchListing?: Promise<BranchListResult>
    /** Validates the typed folder only after a pause in typing. */
    private readonly notifyRepoChangedDebounced = debounce(() => {
        this.branchListing = undefined
        for (const update of this.repoListeners) void this.passBranches(update)
    }, 500, true)

    constructor(app: App, plugin: SelectivePublisherPlugin) {
        super(app, plugin)
        this.plugin = plugin
    }

    getSettingDefinitions(): SettingDefinitionItem[] {
        return [
            {
                type: 'group',
                heading: 'Publishing repository',
                items: [
                    {
                        name: 'Publishing folder',
                        desc: 'The content folder in a local Git repository. Files in it that are not published are deleted.',
                        aliases: ['directory', 'path'],
                        render: (setting) => this.renderPublishingFolderSetting(setting),
                    },
                    {
                        name: 'Branch',
                        desc: 'Git branch to push the published notes to.',
                        render: (setting) => this.renderBranchSetting(setting),
                    },
                    {
                        name: 'Commit message',
                        desc: 'Used for every commit.',
                        control: { type: 'text', key: 'commitMessage', placeholder: 'Enter commit message' },
                    },
                ],
            },
            {
                type: 'group',
                heading: 'Files to publish',
                items: [
                    {
                        name: 'Show preview before publishing',
                        desc: 'Review changes, with an option to commit without pushing.',
                        aliases: ['diff'],
                        control: { type: 'toggle', key: 'showPreviewBeforePublishing' },
                    },
                    {
                        name: 'Publishing criterion',
                        desc: 'Applies to Markdown files only.',
                        aliases: ['filter', 'frontmatter', 'selection'],
                        render: (setting) => this.renderCriterionSetting(setting),
                    },
                    {
                        name: 'Publish attachments',
                        desc: 'Publish non-Markdown files linked or embedded in published notes.',
                        control: { type: 'toggle', key: 'publishAttachments' },
                    },
                    {
                        name: 'Extra file patterns',
                        desc: 'Glob patterns, one per line, for vault files to publish regardless of the criterion. Supports !, #, and ** syntax.',
                        aliases: ['include'],
                        control: {
                            type: 'textarea',
                            key: 'extraFilePatterns',
                            validate: validateGlobPatterns,
                        },
                    },
                ],
            },
        ]
    }

    // Settings need saving through the plugin, which serializes the criterion
    async setControlValue(key: string, value: unknown): Promise<void> {
        Object.assign(this.plugin.settings, { [key]: value })
        await this.plugin.saveSettings()
    }

    // Branches are listed again the next time the tab is shown
    hide(): void {
        this.branchListing = undefined
        super.hide()
    }

    /**
     * Calls `update` with the branches of the publishing folder, now and after each folder change.
     * Returns a cleanup function for the setting row, which Obsidian calls before it removes the row.
     */
    private watchBranches(update: (result: BranchListResult) => void): () => void {
        this.repoListeners.add(update)
        void this.passBranches(update)
        return () => { this.repoListeners.delete(update) }
    }

    /** Calls `update` with the branches of the publishing folder, unless the folder changed or the setting row was removed in the meantime. */
    private async passBranches(update: (result: BranchListResult) => void) {
        const listing = this.branchListing ??= GitHelper.listBranches(this.plugin.settings.repo)
        const result = await listing
        if (listing === this.branchListing && this.repoListeners.has(update)) update(result)
    }

    private renderPublishingFolderSetting(setting: Setting) {
        let folderText: TextComponent
        setting
            .addText((text) => {
                folderText = text
                text.setPlaceholder('Enter folder path')
                    .setValue(this.plugin.settings.repo)
                    .onChange(async (value) => { await this.setPublishingFolder(value) })
            })
            .addExtraButton((btn) => btn
                .setIcon('folder')
                .setTooltip('Select content folder in repository')
                .onClick(async () => {
                    try {
                        const result = await dialog.showOpenDialog({
                            properties: ['openDirectory'],
                            defaultPath: this.plugin.settings.repo
                        })

                        if (!result.canceled && result.filePaths.length > 0) {
                            const selectedPath = result.filePaths[0]!
                            folderText.setValue(selectedPath)
                            await this.setPublishingFolder(selectedPath)
                            // A picked folder is validated without waiting
                            this.notifyRepoChangedDebounced.run()
                        }
                    } catch (error) {
                        console.error('Folder picker error:', error)
                        new Notice('Failed to open folder picker.')
                    }
                })
            )
        return this.watchBranches(({ error }) => { setting.setErrorMessage(error ?? null) })
    }

    private renderBranchSetting(setting: Setting) {
        let branchDropdown: DropdownComponent
        setting.addDropdown((dropdown) => {
            branchDropdown = dropdown
            dropdown.onChange(async (value) => { await this.setControlValue('repoBranch', value) })
        })
        return this.watchBranches((result) => this.fillBranchDropdown(branchDropdown, result))
    }

    private renderCriterionSetting(setting: Setting) {
        // Representation of the current criterion, spanning the full width below the name and buttons
        setting.settingEl.addClass('sp-criterion-setting')
        const summaryEl = setting.settingEl.createEl('pre', {
            text: this.plugin.settings.criterion.getSummary(),
            cls: 'sp-criterion-summary',
        })
        setting
            .addButton((btn) => btn
                .setButtonText('Edit criterion')
                .setCta()
                .onClick(() => {
                    new CriterionEditorModal(this.app, this.plugin.settings.criterion, (updatedCriterion) => {
                        summaryEl.setText(updatedCriterion.getSummary())
                        void this.setControlValue('criterion', updatedCriterion)
                    }).open()
                })
            )
            .addButton((btn) => btn
                .setButtonText('Preview publishable files')
                .onClick(() => { void this.plugin.previewPublishableFiles() })
            )
        // The summary is removed, as Obsidian reuses the setting row element when it renders the row again
        return () => summaryEl.remove()
    }

    private async setPublishingFolder(folder: string) {
        await this.setControlValue('repo', folder)
        this.notifyRepoChangedDebounced()
    }

    /** Lists the branches without changing the saved branch, which is marked if it is not found. */
    private fillBranchDropdown(dropdown: DropdownComponent, { branches, current }: BranchListResult) {
        const savedBranch = this.plugin.settings.repoBranch
        dropdown.selectEl.empty()
        // Option for the empty saved branch (see SelectivePublisherSettings.repoBranch)
        dropdown.addOption('', current ? `Current branch (${current})` : 'Current branch')
        if (savedBranch && !branches.includes(savedBranch)) {
            dropdown.addOption(savedBranch, `${savedBranch} (not found)`)
        }
        for (const branch of branches) {
            dropdown.addOption(branch, branch)
        }
        dropdown.setDisabled(branches.length === 0)
        dropdown.setValue(savedBranch)
    }
}
