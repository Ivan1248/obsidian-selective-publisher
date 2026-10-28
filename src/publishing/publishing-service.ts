import { App, FileSystemAdapter, TFile } from 'obsidian'
import * as fs from 'fs/promises'
import * as path from 'path'
import { Buffer } from "buffer"
import { GitHelper } from './git-helper'
import { FileDiff } from './diff-parser'
import { SelectivePublisherSettings } from '../settings'

/** Pathspec of the published files: all files except dot-files and the contents of dot-folders */
const PUBLISHED_PATHSPEC = ['.', ':(exclude,glob)**/.*', ':(exclude,glob)**/.*/**']

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
        const publishedPaths = await GitHelper.listFiles(this.repoPath, PUBLISHED_PATHSPEC)
        const publishedPathSet = new Set(publishedPaths)

        // Statuses of the publishable files
        // The Git listing decides whether a file is new, as the file system may ignore case
        const fileStatuses: FileWithStatus[] = await Promise.all(
            publishableFiles.map(async (file) => ({
                path: file.path,
                status: publishedPathSet.has(file.path)
                    ? await this.getFileStatus(file, this.resolveRepoPath(file.path))
                    : FileUpdateStatus.New,
            }))
        )

        // Published files that are no longer publishable
        const publishablePaths = new Set(publishableFiles.map(f => f.path))
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
        if (!commitOnly) await GitHelper.pull(this.repoPath, branch)
        // Without the index entries, `git add` records the vault's paths, also case-only renames
        await GitHelper.removeFiles(this.repoPath, PUBLISHED_PATHSPEC)
        await this.copyFilesToRepo(publishableFiles)
        await GitHelper.add(this.repoPath)
        await GitHelper.commit(this.repoPath, this.settings.commitMessage)
        if (!commitOnly) await GitHelper.push(this.repoPath, branch)
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

    private static processContent(content: string, file: TFile): string {
        return content
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
}
