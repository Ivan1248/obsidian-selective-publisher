import { App, TFile } from 'obsidian'
import * as fs from 'fs/promises'
import * as path from 'path'

export enum FileUpdateStatus {
    New = 'new',
    Modified = 'modified',
    Unmodified = 'unmodified',
    Deleted = 'deleted',
}

export interface FileWithStatus {
    path: string
    status: FileUpdateStatus
}

export class PublishingService {
    constructor(private app: App, private repoPath: string) { }

    public async getPublishingStatuses(publishableFiles: TFile[]): Promise<FileWithStatus[]> {
        // Get statuses for publishable files
        const fileStatuses: FileWithStatus[] = await Promise.all(
            publishableFiles.map(async (file) => ({
                path: file.path,
                status: await this.getFileStatus(file, path.join(this.repoPath, file.path)),
            }))
        )

        // Find files that would be deleted (exist in repo but not publishable)
        const publishablePaths = new Set(publishableFiles.map(f => f.path))
        const publishedPaths = await this.getPublishedMarkdownFiles()
        const deletedStatuses: FileWithStatus[] = publishedPaths
            .filter(publishedPath => !publishablePaths.has(publishedPath))
            .map(publishedPath => ({ path: publishedPath, status: FileUpdateStatus.Deleted }))

        return [...fileStatuses, ...deletedStatuses]
    }

    public async updateFilesInRepo(publishableFiles: TFile[]): Promise<void> {
        await this.cleanupRepo(publishableFiles)
        await this.copyFilesToRepo(publishableFiles)
    }

    private async getFileStatus(srcFile: TFile, destPath: string): Promise<FileUpdateStatus> {
        try {
            const stats = await fs.stat(destPath)
            if (srcFile.stat.mtime > stats.mtimeMs) {  // Obsidian mtime is in ms
                return FileUpdateStatus.Modified
            }
        } catch {
            return FileUpdateStatus.New
        }
        return FileUpdateStatus.Unmodified
    }

    private async getPublishedMarkdownFiles(): Promise<string[]> {
        try {
            const publishedFiles: string[] = []
            const repoPath = this.repoPath

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
            console.error('Failed to scan publishing repo:', error)
            return []
        }
    }

    private static processContent(content: string, file: TFile): string {
        // Here could be a transformation for publishing if needed
        return content
    }

    private async cleanupRepo(publishableFiles: TFile[]) {
        try {
            // Get set of paths that should be published
            const publishablePaths = new Set(publishableFiles.map(f => f.path))
            const publishedPaths = await this.getPublishedMarkdownFiles()

            // Remove files that shouldn't be there
            for (const publishedPath of publishedPaths) {
                if (!publishablePaths.has(publishedPath)) {
                    await this.deleteFileFromRepo(publishedPath)
                }
            }
        } catch (error) {
            console.error('Cleanup failed:', error)
        }
    }

    private async copyFilesToRepo(files: TFile[]) {
        for (const file of files) {
            await this.copyFileToRepo(file)
        }
    }

    private async copyFileToRepo(file: TFile) {
        const content = await this.app.vault.read(file)
        const destPath = path.join(this.repoPath, file.path)

        // Process content (modify links, etc. if needed)
        const processedContent = PublishingService.processContent(content, file)

        await fs.mkdir(path.dirname(destPath), { recursive: true })
        await fs.writeFile(destPath, processedContent)
    }

    private async deleteFileFromRepo(relativePath: string) {
        try {
            const destPath = path.join(this.repoPath, relativePath)
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
}
