import { TFile, CachedMetadata } from 'obsidian'

// Serialization

export enum CriterionType {
    Tag = 'Tag',
    Frontmatter = 'Frontmatter',
    Folder = 'Folder',
    Title = 'Title',
    Path = 'Path',
    Content = 'Content',
    And = 'And',
    Or = 'Or',
    Not = 'Not',
}

export interface SerializedCriterion {
    type: CriterionType
    [key: string]: unknown
}

const registry: Map<CriterionType, typeof Criterion> = new Map()

// Decorator for registering criterion classes
// Assumes that the class name ends with 'Criterion' and that the 
function RegisterCriterion(constructor: Function) {
    const type = constructor.name.replace('Criterion', '') as CriterionType
    registry.set(type, constructor as unknown as typeof Criterion)
}

// Utilities

function safeRegexTest(pattern: string, input: string, flags = 'i'): boolean {
    try {
        return new RegExp(pattern, flags).test(input)
    } catch {
        console.error(`Invalid regex pattern: ${pattern}`)
        return false
    }
}

export abstract class Criterion {
    static deserialize(data: SerializedCriterion): Criterion {
        const criterionClass = registry.get(data.type)
        if (!criterionClass) {
            throw new Error(`Unknown criterion type: ${data.type}`)
        }
        return criterionClass.deserialize(data)
    }

    abstract serialize(): SerializedCriterion
    abstract evaluate(file: TFile, content: string, metadata: CachedMetadata): Promise<boolean>
    abstract getSummary(): string

    getType(): CriterionType {
        return this.constructor.name.replace('Criterion', '') as CriterionType
    }
}

@RegisterCriterion
export class FrontmatterCriterion extends Criterion {
    type = CriterionType.Frontmatter

    constructor(public key: string, public value: string) {
        super()
    }

    async evaluate(file: TFile, content: string, metadata: CachedMetadata): Promise<boolean> {
        const frontmatterValue = metadata?.frontmatter?.[this.key]
        if (frontmatterValue === undefined) return false

        // support both exact match and regex match
        const regex = new RegExp(`^${this.value}$`, 'i')
        return regex.test(String(frontmatterValue))
    }

    getSummary(): string {
        return `Frontmatter: ${this.key} = ${this.value}`
    }

    serialize(): SerializedCriterion {
        return { type: this.type, key: this.key, value: this.value }
    }

    static deserialize(data: SerializedCriterion): FrontmatterCriterion {
        return new FrontmatterCriterion(data.key as string, data.value as string)
    }
}

@RegisterCriterion
export class FolderCriterion extends Criterion {
    type = CriterionType.Folder

    constructor(public includeFolders: string[], public excludeFolders: string[]) {
        super()
    }

    async evaluate(file: TFile, _content: string, _metadata: CachedMetadata): Promise<boolean> {
        if (this.excludeFolders.some(folder => file.path.startsWith(folder + '/') || file.path === folder)) {
            return false
        }
        if (this.includeFolders.length > 0 && !this.includeFolders.some(folder => file.path.startsWith(folder + '/') || file.path === folder)) {
            return false
        }
        return true
    }

    getSummary(): string {
        return `Folder: Include [${this.includeFolders.join(', ') || 'all'}], Exclude [${this.excludeFolders.join(', ') || 'none'}]`
    }

    serialize(): SerializedCriterion {
        return {
            type: this.type,
            includeFolders: this.includeFolders,
            excludeFolders: this.excludeFolders,
        }
    }

    static deserialize(data: SerializedCriterion): FolderCriterion {
        return new FolderCriterion(data.includeFolders as string[], data.excludeFolders as string[])
    }
}

@RegisterCriterion
export class ContentCriterion extends Criterion {
    type = CriterionType.Content

    constructor(public regex: string) {
        super()
    }

    async evaluate(_file: TFile, content: string, _metadata: CachedMetadata): Promise<boolean> {
        return safeRegexTest(this.regex, content)
    }

    getSummary(): string {
        return `Content matches: ${this.regex}`
    }

    serialize(): SerializedCriterion {
        return { type: this.type, regex: this.regex }
    }

    static deserialize(data: SerializedCriterion): ContentCriterion {
        return new ContentCriterion(data.regex as string)
    }
}

@RegisterCriterion
export class TitleCriterion extends Criterion {
    type = CriterionType.Title

    constructor(public pattern: string = '', public isRegex: boolean) {
        super()
    }

    async evaluate(file: TFile, _content: string, _metadata: CachedMetadata): Promise<boolean> {
        if (this.isRegex) {
            return safeRegexTest(this.pattern, file.basename)
        }
        return file.basename.toLowerCase().includes(this.pattern.toLowerCase())
    }

    getSummary(): string {
        return `Title ${this.isRegex ? 'matches regex' : 'contains'}: ${this.pattern}`
    }

    serialize(): SerializedCriterion {
        return { type: this.type, pattern: this.pattern, isRegex: this.isRegex }
    }

    static deserialize(data: SerializedCriterion): TitleCriterion {
        return new TitleCriterion(data.pattern as string, data.isRegex as boolean)
    }
}

@RegisterCriterion
export class PathCriterion extends Criterion {
    type = CriterionType.Path

    constructor(public pattern: string, public isRegex: boolean) {
        super()
    }

    async evaluate(file: TFile, _content: string, _metadata: CachedMetadata): Promise<boolean> {
        if (this.isRegex) {
            return safeRegexTest(this.pattern, file.path)
        }
        return file.path.toLowerCase().replace(/\\/g, '/').includes(this.pattern.toLowerCase())
    }

    getSummary(): string {
        return `Path ${this.isRegex ? 'matches regex' : 'contains'}: ${this.pattern}`
    }

    serialize(): SerializedCriterion {
        return { type: this.type, pattern: this.pattern, isRegex: this.isRegex }
    }

    static deserialize(data: SerializedCriterion): PathCriterion {
        return new PathCriterion(data.pattern as string, data.isRegex as boolean)
    }
}

@RegisterCriterion
export class AndCriterion extends Criterion {
    type = CriterionType.And

    constructor(public criteria: Criterion[]) {
        super()
    }

    async evaluate(file: TFile, content: string, metadata: CachedMetadata): Promise<boolean> {
        for (const criterion of this.criteria) {
            if (!(await criterion.evaluate(file, content, metadata))) {
                return false
            }
        }
        return true
    }

    getSummary(): string {
        return `And(${this.criteria.map(c => c.getSummary()).join(', ')})`
    }

    serialize(): SerializedCriterion {
        return { type: this.type, criteria: this.criteria.map(c => c.serialize()) }
    }

    static deserialize(data: SerializedCriterion): AndCriterion {
        return new AndCriterion((data.criteria as SerializedCriterion[]).map(c => Criterion.deserialize(c)))
    }
}

@RegisterCriterion
export class OrCriterion extends Criterion {
    type = CriterionType.Or

    constructor(public criteria: Criterion[]) {
        super()
    }

    async evaluate(file: TFile, content: string, metadata: CachedMetadata): Promise<boolean> {
        for (const criterion of this.criteria) {
            if (await criterion.evaluate(file, content, metadata)) {
                return true
            }
        }
        return false
    }

    getSummary(): string {
        return `Or(${this.criteria.map(c => c.getSummary()).join(', ')})`
    }

    serialize(): SerializedCriterion {
        return { type: this.type, criteria: this.criteria.map(c => c.serialize()) }
    }

    static deserialize(data: SerializedCriterion): OrCriterion {
        return new OrCriterion((data.criteria as SerializedCriterion[]).map(c => Criterion.deserialize(c)))
    }
}

@RegisterCriterion
export class NotCriterion extends Criterion {
    type = CriterionType.Not

    constructor(public criterion: Criterion) {
        super()
    }

    async evaluate(file: TFile, content: string, metadata: CachedMetadata): Promise<boolean> {
        return !(await this.criterion.evaluate(file, content, metadata))
    }

    getSummary(): string {
        return `Not(${this.criterion.getSummary()})`
    }

    serialize(): SerializedCriterion {
        return { type: this.type, criterion: this.criterion.serialize() }
    }

    static deserialize(data: SerializedCriterion): NotCriterion {
        return new NotCriterion(Criterion.deserialize(data.criterion as SerializedCriterion))
    }
}

function extractTagsFromContent(content: string): string[] {
    const lines = content.split('\n')
    const tags: Set<string> = new Set()
    let inCodeBlock = false

    for (const line of lines) {
        if (line.trim().startsWith('```')) {
            inCodeBlock = !inCodeBlock
            continue
        }

        if (!inCodeBlock) {
            if (line.trim().startsWith('%%')) {
                continue
            }
            const contentTags = line.match(/#([\w-]+)/g)?.map(tag => tag.substring(1)) || []
            contentTags.forEach(tag => tags.add(tag))
        }
    }

    return Array.from(tags)
}

export async function getAllTagsFromFile(file: TFile, content: string, metadata: CachedMetadata): Promise<string[]> {
    const tagsFromFrontmatter = metadata?.frontmatter?.tags || []
    const tagsFromContent = extractTagsFromContent(content)
    return [...new Set([...tagsFromFrontmatter, ...tagsFromContent])]
}

@RegisterCriterion
export class TagCriterion extends Criterion {
    type = CriterionType.Tag
    tag: string

    constructor(tag: string) {
        super()
        this.tag = tag.toLowerCase()
    }

    async evaluate(file: TFile, content: string, metadata: CachedMetadata): Promise<boolean> {
        const tags = await getAllTagsFromFile(file, content, metadata)
        return tags.some(tag => {
            const normalizedTag = tag.toLowerCase()
            // match exact tag or hierarchical subtags (e.g., "foo" matches "foo", "foo/bar", "foo/bar/baz")
            return normalizedTag === this.tag || normalizedTag.startsWith(this.tag + '/')
        })
    }

    getSummary(): string {
        return `Tag: ${this.tag}`
    }

    serialize(): SerializedCriterion {
        return { type: this.type, tag: this.tag }
    }

    static deserialize(data: SerializedCriterion): TagCriterion {
        return new TagCriterion(data.tag as string)
    }
}
