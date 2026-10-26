import { execFile } from 'child_process'
import { isAbsolute } from 'path'
import { promisify } from 'util'
import { FileDiff, parseDiff } from './diff-parser'

const execFileAsync = promisify(execFile)

interface ExecFileError extends Error {
    code?: string | number
    cmd?: string
    stdout?: string
    stderr?: string
}

function toExecFileError(error: unknown): ExecFileError {
    return error instanceof Error ? error : new Error(String(error))
}

export interface BranchListResult {
    branches: string[]
    current?: string
    error?: string
}

export class GitHelper {
    /**
     * Returns the branches of the repository at `repoPath`.
     * Also validates the path, since listing branches fails outside a repository.
     */
    static async listBranches(repoPath: string): Promise<BranchListResult> {
        // Git would otherwise run in Obsidian's working folder
        if (!isAbsolute(repoPath)) return { branches: [], error: 'Enter the absolute path of a folder.' }
        try {
            // %(HEAD) prints "*" for the checked-out branch and a space for the others
            const { stdout } = await execFileAsync('git', ['for-each-ref', '--format=%(HEAD)%(refname:short)', 'refs/heads'], { cwd: repoPath })
            const lines = stdout.split('\n').filter(line => line.trim().length > 0)
            return {
                branches: lines.map(line => line.slice(1).trim()),
                current: lines.find(line => line.startsWith('*'))?.slice(1).trim(),
            }
        } catch (error) {
            this.logGitError(repoPath, error, 'list branches')
            return { branches: [], error: 'Could not list branches. Check that the path is a folder in a Git repository and that Git is installed.' }
        }
    }

    /** Returns the checked-out branch, or undefined if no branch is checked out. */
    static async getCurrentBranch(repoPath: string): Promise<string | undefined> {
        try {
            // Prints "HEAD" if no branch is checked out
            const { stdout } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repoPath })
            const branch = stdout.trim()
            return branch === 'HEAD' ? undefined : branch
        } catch (error) {
            this.handleGitError(repoPath, error, 'get current branch')
        }
    }

    static async switchBranch(repoPath: string, branch: string): Promise<void> {
        try {
            await execFileAsync('git', ['switch', branch], { cwd: repoPath })
        } catch (error) {
            this.handleGitError(repoPath, error, 'switch branch')
        }
    }

    static async add(repoPath: string): Promise<void> {
        try {
            await execFileAsync('git', ['add', '.'], { cwd: repoPath })
        } catch (error) {
            this.handleGitError(repoPath, error, 'stage changes')
        }
    }

    static async commit(repoPath: string, message: string): Promise<void> {
        try {
            try {
                await execFileAsync('git', ['commit', '-m', message], { cwd: repoPath })
            } catch (err) {
                const execError = toExecFileError(err)
                if (!execError.stdout?.includes('nothing to commit') && !execError.stderr?.includes('nothing to commit')) {
                    throw err
                }
            }
        } catch (error) {
            this.handleGitError(repoPath, error, 'commit changes')
        }
    }

    static async push(repoPath: string, branch: string): Promise<void> {
        try {
            await execFileAsync('git', ['push', 'origin', branch], { cwd: repoPath })
        } catch (error) {
            this.handleGitError(repoPath, error, 'push changes')
        }
    }

    static async pull(repoPath: string, branch: string): Promise<void> {
        try {
            await execFileAsync('git', ['pull', 'origin', branch], { cwd: repoPath })
        } catch (error) {
            const execError = toExecFileError(error)
            if (execError.stderr?.includes('CONFLICT') || execError.message.includes('CONFLICT')) {
                throw new Error('Merge conflict detected. Please resolve conflicts manually in your repository.')
            }
            this.handleGitError(repoPath, error, 'pull from remote')
        }
    }

    private static formatGitError(repoPath: string, error: ExecFileError, action: string): string {
        let help = ''
        if (error.code === 'ENOENT') {
            help = '\nGit could not be run. Check that Git is installed and on PATH, and that the publishing folder exists.\n'
        }

        const dir = `Publishing path: ${repoPath}\n`
        const cmd = error.cmd ? `Command: ${error.cmd}` : ''
        const stdout = error.stdout ? `\nStdout: ${error.stdout}` : ''
        const stderr = error.stderr ? `\nStderr: ${error.stderr}` : ''

        return `Git error during action "${action}":\n${dir}${cmd}${stdout}${stderr}\nMessage: ${error.message}${help}`
    }

    private static logGitError(repoPath: string, error: unknown, action: string) {
        console.error(`Git error during ${action} in path ${repoPath}:`, error)
    }

    private static handleGitError(repoPath: string, error: unknown, action: string): never {
        this.logGitError(repoPath, error, action)
        throw new Error(this.formatGitError(repoPath, toExecFileError(error), action))
    }

    static async hasUncommittedChanges(repoPath: string): Promise<boolean> {
        try {
            // git status --porcelain returns empty string if no changes
            const { stdout } = await execFileAsync('git', ['status', '--porcelain'], { cwd: repoPath })
            return stdout.trim().length > 0
        } catch (error) {
            this.handleGitError(repoPath, error, 'check status')
        }
    }

    static async diffFiles(repoPath: string, oldPath: string, newPath: string): Promise<FileDiff> {
        try {
            const { stdout } = await execFileAsync('git', ['diff', '--no-index', '--no-color', '--', oldPath, newPath], { cwd: repoPath })
            return parseDiff(stdout)
        } catch (error) {
            // git diff --no-index exits with code 1 when the files differ
            const execError = toExecFileError(error)
            if (execError.code !== 1 || execError.stdout === undefined) this.handleGitError(repoPath, error, 'diff files')
            return parseDiff(execError.stdout)
        }
    }
}
