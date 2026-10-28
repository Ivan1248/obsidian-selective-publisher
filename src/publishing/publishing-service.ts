import { App, FileSystemAdapter, TFile } from 'obsidian'
import * as fs from 'fs/promises'
import * as path from 'path'
import { Buffer } from "buffer"
import { GitHelper } from './git-helper'
import { FileDiff } from './diff-parser'
import { SelectivePublisherSettings } from '../settings'

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

export interface PublishingBranch {
    name: string
    /** Whether the branch was checked out by the switch, rather than checked out already */
    isNewlyCheckedOut: boolean
}

export class PublishingService {
    constructor(private app: App, private settings: SelectivePublisherSettings) { }

    private get repoPath(): string {
        return this.settings.repo
    }

    /**
     * Checks out the branch set in the settings and returns it.
     * If no branch is set, returns the checked-out branch, or undefined if there is none.
     */
    public async switchToPublishingBranch(): Promise<PublishingBranch | undefined> {
        const currentBranch = await GitHelper.getCurrentBranch(this.repoPath)
        const name = this.settings.repoBranch || currentBranch
        if (!name) return undefined
        const isNewlyCheckedOut = name !== currentBranch
        if (isNewlyCheckedOut) await GitHelper.switchBranch(this.repoPath, name)
        return { name, isNewlyCheckedOut }
    }

    public async getPublishingStatuses(publishableFiles: TFile[]): Promise<FileWithStatus[]> {
        // Statuses of the publishable files
        const fileStatuses: FileWithStatus[] = await Promise.all(
            publishableFiles.map(async (file) => ({
                path: file.path,
                status: await this.getFileStatus(file, this.resolveRepoPath(file.path)),
            }))
        )

        // Published files that are no longer publishable
        const publishablePaths = new Set(publishableFiles.map(f => f.path))
        const publishedPaths = await this.getPublishedFiles()
        const deletedStatuses: FileWithStatus[] = publishedPaths
            .filter(publishedPath => !publishablePaths.has(publishedPath))
            .map(publishedPath => ({ path: publishedPath, status: FileUpdateStatus.Deleted }))

        return [...fileStatuses, ...deletedStatuses]
    }

    public async hasUncommittedChanges(): Promise<boolean> {
        return GitHelper.hasUncommittedChanges(this.repoPath)
    }

    /**
     * Updates the published files on `branch` and commits them.
     * Unless `commitOnly` is set, also pulls before and pushes after.
     */
    public async publishFiles(
        publishableFiles: TFile[], branch: string, { commitOnly = false } = {},
    ): Promise<void> {
        // Pulling first avoids conflicts with changes made to the publishing branch elsewhere
        if (!commitOnly) await this.pullFromRemote(branch)
        await this.cleanupRepo(publishableFiles)
        await this.copyFilesToRepo(publishableFiles)
        await this.commitAndPush(commitOnly, branch)
    }

    private async pullFromRemote(branch: string) {
        try {
            await GitHelper.pull(this.repoPath, branch)
        } catch (error) {
            throw new Error(`Cannot sync with remote: ${(error as Error).message}`)
        }
    }

    private async commitAndPush(commitOnly: boolean, branch: string) {
        try {
            await GitHelper.add(this.repoPath)
            await GitHelper.commit(this.repoPath, this.settings.commitMessage)
            if (!commitOnly) {
                await GitHelper.push(this.repoPath, branch)
            }
        } catch (error) {
            console.error('Git operation failed:', error)
            throw new Error(`Git operation failed: ${(error as Error).message}`)
        }
    }

    /** Returns the diff between the published copy of a file and its current vault version. */
    public async getFileDiff(filePath: string): Promise<FileDiff> {
        const adapter = this.app.vault.adapter
        if (!(adapter instanceof FileSystemAdapter)) throw new Error('Diffs require a file system vault.')
        return GitHelper.diffFiles(this.repoPath, this.resolveRepoPath(filePath), adapter.getFullPath(filePath))
    }

    /** Returns the absolute path of a vault file's published copy. */
    private resolveRepoPath(relativePath: string): string {
        return path.join(this.repoPath, relativePath)
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

    private async getPublishedFiles(): Promise<string[]> {
        try {
            const publishedFiles: string[] = []
            const repoPath = this.repoPath

            async function scanDirectory(dir: string) {
                const entries = await fs.readdir(dir, { withFileTypes: true })
                for (const entry of entries) {
                    const fullPath = path.join(dir, entry.name)
                    // Dot-files and dot-directories, such as .git and .obsidian, are not published files
                    if (entry.isDirectory() && !entry.name.startsWith('.')) {
                        await scanDirectory(fullPath)
                    } else if (entry.isFile() && !entry.name.startsWith('.')) {
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
        return content
    }

    private async cleanupRepo(publishableFiles: TFile[]) {
        try {
            const publishablePaths = new Set(publishableFiles.map(f => f.path))
            const publishedPaths = await this.getPublishedFiles()

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
        const destPath = this.resolveRepoPath(file.path)
        await fs.mkdir(path.dirname(destPath), { recursive: true })

        // Notes pass through processContent, other files are copied as binary
        if (file.extension === 'md') {
            const content = await this.app.vault.read(file)
            const processedContent = PublishingService.processContent(content, file)
            await fs.writeFile(destPath, processedContent)
        } else {
            const buffer = await this.app.vault.readBinary(file)
            await fs.writeFile(destPath, Buffer.from(buffer))
        }
    }

    private async deleteFileFromRepo(relativePath: string) {
        try {
            const destPath = this.resolveRepoPath(relativePath)
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
