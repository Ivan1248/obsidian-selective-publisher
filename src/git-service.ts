import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

interface ExecFileError extends Error {
    code?: string | number;
    cmd?: string;
    stdout?: string;
    stderr?: string;
}

export interface RepoValidationResult {
    isValid: boolean
    error?: string
}

export class GitHelper {
    static async validateRepo(repoPath: string): Promise<RepoValidationResult> {
        try {
            // Check if it's a git repository by running git rev-parse
            await execFileAsync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: repoPath })
            return { isValid: true }
        } catch (error) {
            const execError = error as ExecFileError
            const errorMessage = execError.message.includes('not a git repository')
                ? 'Path is not a valid Git repository.'
                : this.formatGitError(repoPath, execError, 'validate repository')
            return { isValid: false, error: errorMessage }
        }
    }

    static async getBranches(repoPath: string): Promise<string[]> {
        try {
            const { stdout } = await execFileAsync('git', ['branch', '--format=%(refname:short)'], { cwd: repoPath })
            return stdout.split('\n').map(b => b.trim()).filter(b => b.length > 0)
        } catch (error) {
            this.handleGitError(repoPath, error, 'fetch branches')
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
                const execError = err as ExecFileError
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
            // Check if it's a merge conflict
            const execError = error as ExecFileError
            if (execError.stderr?.includes('CONFLICT') || execError.message.includes('CONFLICT')) {
                throw new Error('Merge conflict detected. Please resolve conflicts manually in your repository.')
            }
            this.handleGitError(repoPath, error, 'pull from remote')
        }
    }

    private static formatGitError(repoPath: string, error: ExecFileError, action: string): string {
        let help = ''
        if (error.code === 'ENOENT') {
            help = '\nThe path does not correspond to a directory inside a valid Git repository.\n'
        }

        const dir = `Publishing path: ${repoPath}\n`
        const cmd = error.cmd ? `Command: ${error.cmd}` : ''
        const stdout = error.stdout ? `\nStdout: ${error.stdout}` : ''
        const stderr = error.stderr ? `\nStderr: ${error.stderr}` : ''

        return `Git error during action "${action}":\n${dir}${cmd}${stdout}${stderr}\nMessage: ${error.message}${help}`
    }

    private static handleGitError(repoPath: string, error: unknown, action: string): never {
        console.error(`Git error during ${action} in path ${repoPath}:`, error)
        throw new Error(this.formatGitError(repoPath, error as ExecFileError, action))
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
}
