import { App, Modal, Setting, ButtonComponent } from 'obsidian'
import { CriterionType, TextMatchMode, TagMatchMode, Criterion, PatternCriterion, FrontmatterCriterion, ContentCriterion, TitleCriterion, PathCriterion, AndCriterion, OrCriterion, NotCriterion, TagCriterion, isValidGlobPattern } from './criterion'

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
                    errorEl = container.createEl('div', { text: 'Invalid regex', cls: 'sp-pattern-error' })
                }
                setValue(value)
            })
    )
}

// Helper to add a textarea for line-separated .gitignore-like glob patterns with live validation
// Supports: * ** ? [chars] ! (negate) # (comment) leading / (anchor)
export function addGlobField(container: HTMLElement, setting: Setting, getValue: () => string, setValue: (v: string) => void) {
    let errorEl: HTMLElement | null = null

    setting.addTextArea((textArea) =>
        textArea.setValue(getValue())
            .onChange((value) => {
                if (errorEl) { errorEl.remove(); errorEl = null }

                const invalidLineNumbers = value.split('\n')
                    .map((line, i) => isValidGlobPattern(line, true, true) ? -1 : i + 1)
                    .filter(n => n !== -1)

                if (invalidLineNumbers.length > 0) {
                    const label = invalidLineNumbers.length === 1
                        ? `Invalid glob pattern on line ${invalidLineNumbers[0]}`
                        : `Invalid glob patterns on lines ${invalidLineNumbers.join(', ')}`
                    errorEl = container.createEl('div', { text: label, cls: 'sp-pattern-error' })
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
        const { contentEl, modalEl } = this

        contentEl.empty()
        modalEl.addClass('sp-modal-fixed-footer')
        contentEl.createEl('h2', { text: 'Edit publishing criterion' })

        const outerCriterionContainer = contentEl.createDiv({ cls: 'sp-outer-criterion-container' })
        this.renderCriterion(outerCriterionContainer, this.rootCriterion, 0, null, -1)

        const btnContainer = modalEl.createDiv('modal-button-container')

        new ButtonComponent(btnContainer)
            .setButtonText('Save')
            .setCta()
            .onClick(() => {
                this.onSave(this.rootCriterion)
                this.close()
            })

        new ButtonComponent(btnContainer)
            .setButtonText('Cancel')
            .onClick(() => {
                this.close()
            })
    }

    renderCriterion(container: HTMLElement, criterion: Criterion, depth: number, parent: AndCriterion | OrCriterion | NotCriterion | null, index: number, onDelete?: () => void) {
        container.empty()

        const criterionContainer = container.createDiv({ cls: 'sp-criterion-container' })

        // Type dropdown
        const headerSetting = new Setting(criterionContainer)
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

                        this.renderCriterion(container, newCriterion, depth, parent, index, onDelete)
                    })
            })

        if (onDelete) {
            headerSetting.addExtraButton((btn) => btn
                .setIcon('cross')
                .setTooltip('Remove criterion')
                .onClick(onDelete)
            )
        }

        const makeSubcriterionContainer = (depth: number): HTMLElement => {
            return criterionContainer.createDiv({ cls: 'sp-subcriterion-container' })
        }

        // Render type-specific fields
        if (criterion instanceof FrontmatterCriterion) {
            new Setting(criterionContainer).setName('Property name')
                .addText((text) => text.setValue(criterion.key).onChange((v) => criterion.key = v))
            new Setting(criterionContainer).setName('Property value')
                .addText((text) => text.setValue(criterion.value).onChange((v) => criterion.value = v))

        } else if (criterion instanceof TagCriterion) {
            new Setting(criterionContainer).setName('Tag')
                .addDropdown((dropdown) => {
                    for (const mode of Object.values(TagMatchMode))
                        dropdown.addOption(mode, mode)
                    dropdown.setValue(criterion.matchMode)
                        .onChange((v) => {
                            criterion.matchMode = v as TagMatchMode
                            this.renderCriterion(container, criterion, depth, parent, index, onDelete)
                        })
                })
                .addText((text) => text.setValue(criterion.tag).onChange((v) => criterion.tag = v))

        } else if (criterion instanceof PatternCriterion) {
            const patternSetting = new Setting(criterionContainer).setName((CriterionType[criterion.type] ?? ''))
            patternSetting.addDropdown((dropdown) => {
                for (const mode of Object.values(TextMatchMode))
                    dropdown.addOption(mode, mode)
                dropdown.setValue(criterion.matchMode)
                    .onChange((v) => {
                        criterion.matchMode = v as TextMatchMode
                        this.renderCriterion(container, criterion, depth, parent, index, onDelete)
                    })
            })
            switch (criterion.matchMode) {
                case TextMatchMode.Regex:
                    addRegexField(criterionContainer, patternSetting, () => criterion.pattern, (v) => criterion.pattern = v)
                    break
                case TextMatchMode.Glob:
                    addGlobField(criterionContainer, patternSetting, () => criterion.pattern, (v) => criterion.pattern = v)
                    break
                case TextMatchMode.Contains:
                default:
                    patternSetting.addText((text) => text.setValue(criterion.pattern).onChange((v) => criterion.pattern = v))
                    break
            }

            /*} else if (criterion instanceof FolderCriterion) {
                new Setting(criterionContainer).setName('Include folders')
                    .addTextArea((text) => text.setValue(criterion.includeFolders.join(', '))
                        .onChange((v) => criterion.includeFolders = v.split(',').map(s => s.trim())))
                new Setting(criterionContainer).setName('Exclude folders').setDesc('Comma-separated')
                    .addTextArea((text) => text.setValue(criterion.excludeFolders.join(', '))
                        .onChange((v) => criterion.excludeFolders = v.split(',').map(s => s.trim())))
            */
        } else if (criterion instanceof ContentCriterion) {
            const setting = new Setting(criterionContainer).setName('Content regex')
            addRegexField(criterionContainer, setting, () => criterion.regex, (v) => criterion.regex = v)

        } else if (criterion instanceof AndCriterion || criterion instanceof OrCriterion) {
            criterion.criteria.forEach((sub, i) => {
                const subContainer = makeSubcriterionContainer(depth)
                const subOnDelete = () => {
                    criterion.criteria.splice(i, 1)
                    this.renderCriterion(container, criterion, depth, parent, index, onDelete)
                }
                this.renderCriterion(subContainer, sub, depth + 1, criterion, i, subOnDelete)
            })
            new Setting(criterionContainer).addButton((btn) => btn
                .setButtonText('Add sub-criterion').onClick(() => {
                    criterion.criteria.push(this.createDefaultCriterionByType(CriterionType.Frontmatter))
                    this.renderCriterion(container, criterion, depth, parent, index, onDelete)
                }))

        } else if (criterion instanceof NotCriterion) {
            this.renderCriterion(makeSubcriterionContainer(depth), criterion.criterion, depth + 1, criterion, 0)
        }
        // new Setting(criterionContainer)
    }

    createDefaultCriterionByType(type: CriterionType): Criterion {
        switch (type) {
            case CriterionType.Tag: return new TagCriterion('public')
            case CriterionType.Frontmatter: return new FrontmatterCriterion('public', 'true')
            case CriterionType.Title: return new TitleCriterion('^[^_].*', TextMatchMode.Regex)
            case CriterionType.Path: return new PathCriterion('^**/.*\n_*', TextMatchMode.Glob)
            //case CriterionType.Folder: return new FolderCriterion(['public'], [])
            case CriterionType.Content: return new ContentCriterion('^(?!.*#todo)(?!.*#private).*')
            case CriterionType.And: return new AndCriterion([this.createDefaultCriterionByType(CriterionType.Tag)])
            case CriterionType.Or: return new OrCriterion([this.createDefaultCriterionByType(CriterionType.Tag)])
            case CriterionType.Not: return new NotCriterion(new TagCriterion('private'))
            default: throw new Error(`Unknown criterion type: ${type as string}`)
        }
    }
}
