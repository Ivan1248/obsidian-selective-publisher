import { App, PluginSettingTab, Setting, Notice, DropdownComponent, TextComponent } from 'obsidian'
import SelectivePublisherPlugin from './main'
import { CriterionEditorModal, addGlobField } from './criterion-editor-modal'
import { GitHelper } from './git-service'
import { dialog } from '@electron/remote'

export class SelectivePublisherSettingTab extends PluginSettingTab {
    plugin: SelectivePublisherPlugin

    constructor(app: App, plugin: SelectivePublisherPlugin) {
        super(app, plugin)
        this.plugin = plugin
    }

    display(): void {
        const { containerEl } = this

        containerEl.empty()
        new Setting(containerEl).setName('Publishing repository').setHeading()

        // Publishing repository setting
        let repoText: TextComponent
        new Setting(containerEl)
            .setName('Publishing directory')
            .setDesc('Path to the content directory in a local Git repository for publishing.')
            .addText((text) => {
                repoText = text
                text.setPlaceholder('Enter repository path')
                    .setValue(this.plugin.settings.repo)
                    .onChange(async (value) => {
                        this.plugin.settings.repo = value
                        await this.plugin.saveSettings()
                        await this.validateAndRefreshBranches(branchDropdown)
                    })
            })
            .addExtraButton((btn) => btn
                .setIcon('folder')
                .setTooltip('Select content directory in repository')
                .onClick(async () => {
                    try {
                        const result = await dialog.showOpenDialog({
                            properties: ['openDirectory'],
                            defaultPath: this.plugin.settings.repo
                        })

                        if (!result.canceled && result.filePaths.length > 0) {
                            const selectedPath = result.filePaths[0]!
                            this.plugin.settings.repo = selectedPath
                            repoText.setValue(selectedPath)
                            await this.plugin.saveSettings()
                            await this.validateAndRefreshBranches(branchDropdown)
                        }
                    } catch (error) {
                        console.error('Directory picker error:', error)
                        new Notice('Failed to open directory picker.')
                    }
                })
            )

        // Branch dropdown setting
        let branchDropdown: DropdownComponent
        new Setting(containerEl)
            .setName('Branch')
            .setDesc('Branch to push the published notes to.')
            .addDropdown((dropdown) => {
                branchDropdown = dropdown
                void this.refreshBranchDropdown(dropdown)
                dropdown.onChange(async (value) => {
                    this.plugin.settings.repoBranch = value
                    await this.plugin.saveSettings()
                })
            })

        // Commit message setting
        new Setting(containerEl)
            .setName('Commit message')
            .setDesc('Default commit message for publishing changes.')
            .addText((text) =>
                text.setPlaceholder('Enter commit message')
                    .setValue(this.plugin.settings.commitMessage)
                    .onChange(async (value) => {
                        this.plugin.settings.commitMessage = value
                        await this.plugin.saveSettings()
                    })
            )

        new Setting(containerEl).setName('Publishing').setHeading()

        // Show preview before publishing
        new Setting(containerEl)
            .setName('Show preview before publishing')
            .setDesc('Show the publishing preview modal before publishing.')
            .addToggle((toggle) =>
                toggle.setValue(this.plugin.settings.showPreviewBeforePublishing)
                    .onChange(async (value) => {
                        this.plugin.settings.showPreviewBeforePublishing = value
                        await this.plugin.saveSettings()
                    })
            )

        // Criteria editor and a label representing the current criterion
        new Setting(containerEl)
            .setName('Publishing criterion')
            .setDesc('The criterion for selecting markdown notes to publish.')
            .addButton((btn) => btn
                .setButtonText('Edit criterion')
                .setCta()
                .onClick(() => {
                    new CriterionEditorModal(this.app, this.plugin.settings.criterion, (updatedCriterion) => {
                        this.plugin.settings.criterion = updatedCriterion
                        void this.plugin.saveSettings().then(() => this.display())
                    }).open()
                })
            )
            .addButton((btn) => btn
                .setButtonText('Preview publishable files')
                .onClick(this.plugin.previewPublishableFiles.bind(this.plugin))
            )

        containerEl.createEl('pre', {
            text: this.plugin.settings.criterion.getSummary(),
            cls: 'sp-criterion-summary',
        })

        // Publish attachments
        new Setting(containerEl)
            .setName('Publish attachments')
            .setDesc('Publish attachments referenced in publishable notes.')
            .addToggle((toggle) =>
                toggle.setValue(this.plugin.settings.publishAttachments)
                    .onChange(async (value) => {
                        this.plugin.settings.publishAttachments = value
                        await this.plugin.saveSettings()
                        await this.plugin.updateStatusBar()
                    })
            )

        // Extra file patterns
        const extraPatternsSetting = new Setting(containerEl)
            .setName('Extra file patterns')
            .setDesc('Glob patterns (one per line) for additional vault files to publish, regardless of the publishing criterion. Supports !, #, and ** syntax.')
        addGlobField(containerEl, extraPatternsSetting, () => this.plugin.settings.extraFilePatterns, async (value) => {
            this.plugin.settings.extraFilePatterns = value
            await this.plugin.saveSettings()
            await this.plugin.updateStatusBar()
        })


        // Initial validation
        void this.validateAndRefreshBranches(branchDropdown!)
    }

    async validateAndRefreshBranches(dropdown?: DropdownComponent) {
        const result = await GitHelper.validateRepo(this.plugin.settings.repo)
        if (!result.isValid) {
            new Notice(result.error || 'Invalid repository path')
        }
        if (dropdown) {
            await this.refreshBranchDropdown(dropdown)
        }
    }

    async refreshBranchDropdown(dropdown: DropdownComponent) {
        const branches = await GitHelper.getBranches(this.plugin.settings.repo)
            .catch(() => [] as string[])

        // Clear existing options
        const selectEl = dropdown.selectEl
        selectEl.empty()

        if (branches.length === 0) {
            dropdown.addOption('', 'No branches found')
            dropdown.setDisabled(true)
            this.plugin.settings.repoBranch = ''
        } else {
            dropdown.setDisabled(false)
            branches.forEach(branch => {
                dropdown.addOption(branch, branch)
            })

            // Ensure a valid branch is selected
            if (!branches.includes(this.plugin.settings.repoBranch)) {
                // If current branch is not in list, select the first one and save
                this.plugin.settings.repoBranch = branches[0]!
                await this.plugin.saveSettings()
            }
        }

        dropdown.setValue(this.plugin.settings.repoBranch)
    }


}
