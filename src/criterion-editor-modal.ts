import { App, Modal, Setting } from 'obsidian'
import { CriterionType, Criterion, FrontmatterCriterion, FolderCriterion, ContentCriterion, TitleCriterion, PathCriterion, AndCriterion, OrCriterion, NotCriterion, TagCriterion } from './criterion'

// Utility: validate regex pattern
function isValidRegex(pattern: string): boolean {
    try {
        new RegExp(pattern)
        return true
    } catch {
        return false
    }
}

// Helper to add a text field with live regex validation
function addRegexField(container: HTMLElement, setting: Setting, getValue: () => string, setValue: (v: string) => void) {
    let errorEl: HTMLElement | null = null

    setting.addText((text) =>
        text.setValue(getValue())
            .onChange((value) => {
                if (errorEl) { errorEl.remove(); errorEl = null }

                if (!isValidRegex(value)) {
                    errorEl = container.createEl('div', { text: 'Invalid regex', cls: 'sp-regex-error' })
                }
                setValue(value)
            })
    )
}

export class CriterionEditorModal extends Modal {
    rootCriterion: Criterion
    onSave: (updatedCriterion: Criterion) => void

    constructor(app: App, criterion: Criterion, onSave: (updatedCriterion: Criterion) => void) {
        super(app)
        // Clone the criterion to avoid modifying the original object directly
        this.rootCriterion = Criterion.deserialize(criterion.serialize())
        this.onSave = onSave
    }

    onOpen() {
        const { contentEl } = this

        contentEl.empty()
        contentEl.createEl('h2', { text: 'Edit publishing criterion' })

        const criteriaContainer = contentEl.createDiv({ cls: 'criteria-container' })
        this.renderCriterion(criteriaContainer, this.rootCriterion, 0, null, -1)

        new Setting(contentEl)
            .addButton((btn) =>
                btn.setButtonText('Save').setCta()
                    .onClick(() => {
                        this.onSave(this.rootCriterion)
                        this.close()
                    })
            )
            .addButton((btn) =>
                btn.setButtonText('Cancel')
                    .onClick(() => this.close())
            )
    }

    renderCriterion(container: HTMLElement, criterion: Criterion, depth: number, parent: AndCriterion | OrCriterion | NotCriterion | null, index: number) {
        container.empty()

        const criterionContainer = container.createDiv({ cls: 'criterion-container' })

        // Type dropdown
        new Setting(criterionContainer)
            .setName('Criterion type')
            .addDropdown((dropdown) => {
                for (const type in CriterionType)
                    dropdown.addOption(type, CriterionType[type as keyof typeof CriterionType])

                dropdown.setValue(criterion.getType())
                    .onChange((value) => {
                        const newCriterion = this.createDefaultCriterionByType(value as CriterionType)

                        if (depth === 0) {
                            this.rootCriterion = newCriterion
                        } else if (parent instanceof AndCriterion || parent instanceof OrCriterion) {
                            parent.criteria[index] = newCriterion
                        } else if (parent instanceof NotCriterion) {
                            parent.criterion = newCriterion
                        }

                        this.renderCriterion(container, newCriterion, depth, parent, index)
                    })
            })

        const makeSubcriterionContainer = (depth: number): HTMLElement => {
            const div = criterionContainer.createDiv({ cls: 'sp-sub-criterion-container' })
            div.style.marginLeft = `${depth * 10}px`
            return div
        }

        // Render type-specific fields
        if (criterion instanceof FrontmatterCriterion) {
            new Setting(criterionContainer).setName('Property name')
                .addText((text) => text.setValue(criterion.key).onChange((v) => criterion.key = v))
            new Setting(criterionContainer).setName('Property value')
                .addText((text) => text.setValue(criterion.value).onChange((v) => criterion.value = v))

        } else if (criterion instanceof TagCriterion) {
            new Setting(criterionContainer).setName('Tag')
                .addText((text) => text.setValue(criterion.tag).onChange((v) => criterion.tag = v))

        } else if (criterion instanceof TitleCriterion) {
            const setting = new Setting(criterionContainer).setName('Title pattern')
            if (criterion.isRegex) {
                addRegexField(criterionContainer, setting, () => criterion.pattern, (v) => criterion.pattern = v)
            } else {
                setting.addText((text) => text.setValue(criterion.pattern).onChange((v) => criterion.pattern = v))
            }
            new Setting(criterionContainer).setName('Is regex')
                .addToggle((toggle) => toggle.setValue(criterion.isRegex).onChange((v) => {
                    criterion.isRegex = v
                    this.renderCriterion(container, criterion, depth, parent, index)
                }))

        } else if (criterion instanceof PathCriterion) {
            const setting = new Setting(criterionContainer).setName('Path pattern')
            if (criterion.isRegex) {
                addRegexField(criterionContainer, setting, () => criterion.pattern, (v) => criterion.pattern = v)
            } else {
                setting.addText((text) => text.setValue(criterion.pattern).onChange((v) => criterion.pattern = v))
            }
            new Setting(criterionContainer).setName('Is regex')
                .addToggle((toggle) => toggle.setValue(criterion.isRegex).onChange((v) => {
                    criterion.isRegex = v
                    this.renderCriterion(container, criterion, depth, parent, index)
                }))

        } else if (criterion instanceof FolderCriterion) {
            new Setting(criterionContainer).setName('Include folders')
                .addTextArea((text) => text.setValue(criterion.includeFolders.join(', '))
                    .onChange((v) => criterion.includeFolders = v.split(',').map(s => s.trim())))
            new Setting(criterionContainer).setName('Exclude folders').setDesc('Comma-separated')
                .addTextArea((text) => text.setValue(criterion.excludeFolders.join(', '))
                    .onChange((v) => criterion.excludeFolders = v.split(',').map(s => s.trim())))

        } else if (criterion instanceof ContentCriterion) {
            const setting = new Setting(criterionContainer).setName('Content regex')
            addRegexField(criterionContainer, setting, () => criterion.regex, (v) => criterion.regex = v)

        } else if (criterion instanceof AndCriterion || criterion instanceof OrCriterion) {
            criterion.criteria.forEach((sub, i) => {
                const subContainer = makeSubcriterionContainer(depth)
                this.renderCriterion(subContainer, sub, depth + 1, criterion, i)
                new Setting(subContainer).addButton((btn) =>
                    btn.setButtonText('Remove').onClick(() => {
                        criterion.criteria.splice(i, 1)
                        this.renderCriterion(container, criterion, depth, parent, index)
                    }))
            })
            new Setting(criterionContainer).addButton((btn) =>
                btn.setButtonText('Add sub-criterion').onClick(() => {
                    criterion.criteria.push(this.createDefaultCriterionByType(CriterionType.Frontmatter))
                    this.renderCriterion(container, criterion, depth, parent, index)
                }))

        } else if (criterion instanceof NotCriterion) {
            this.renderCriterion(makeSubcriterionContainer(depth), criterion.criterion, depth + 1, criterion, 0)
        }
    }

    createDefaultCriterionByType(type: CriterionType): Criterion {
        switch (type) {
            case CriterionType.Tag: return new TagCriterion('public')
            case CriterionType.Frontmatter: return new FrontmatterCriterion('public', 'true')
            case CriterionType.Title: return new TitleCriterion('^[^_].*', true)
            case CriterionType.Path: return new PathCriterion('^(?!.*[/_][^/_].*).*', true)
            case CriterionType.Folder: return new FolderCriterion(['public'], [])
            case CriterionType.Content: return new ContentCriterion('^(?!.*#todo)(?!.*#private).*')
            case CriterionType.And: return new AndCriterion([this.createDefaultCriterionByType(CriterionType.Tag)])
            case CriterionType.Or: return new OrCriterion([this.createDefaultCriterionByType(CriterionType.Tag)])
            case CriterionType.Not: return new NotCriterion(new TagCriterion('private'))
            default: throw new Error(`Unknown criterion type: ${type}`)
        }
    }
}