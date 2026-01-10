import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

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
            try {
                this.handleGitError(repoPath, error, 'validate repository')
            } catch (err) {
                return { isValid: false, error: (err as Error).message }
            }

            return {
                isValid: false,
                error: (error as Error).message.includes('not a git repository')
                    ? 'Path is not a valid Git repository.'
                    : 'Failed to access repository: ' + (error as Error).message
            }
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
            // Check if there are changes to commit
            try {
                await execFileAsync('git', ['commit', '-m', message], { cwd: repoPath })
            } catch (err) {
                // If nothing to commit, it might fail with exit code 1
                if (!(err as any).stdout?.includes('nothing to commit') && !(err as any).stderr?.includes('nothing to commit')) {
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
            if ((error as any).stderr?.includes('CONFLICT') || (error as any).message?.includes('CONFLICT')) {
                throw new Error('Merge conflict detected. Please resolve conflicts manually in your repository.')
            }
            this.handleGitError(repoPath, error, 'pull from remote')
        }
    }

    private static handleGitError(repoPath: string, error: any, action: string): never {
        console.error(`Git error during ${action} in path ${repoPath}:`, error)

        let help = ''
        if ((error as any).code === 'ENOENT') {
            help = '\nThe path does not correspond to a directory inside a valid Git repository.\n'
        }

        const dir = `Publishing path: ${repoPath}\n`
        const cmd = (error as any).cmd ? `Command: ${(error as any).cmd}` : ''
        const stdout = (error as any).stdout ? `\nStdout: ${(error as any).stdout}` : ''
        const stderr = (error as any).stderr ? `\nStderr: ${(error as any).stderr}` : ''

        throw new Error(`Git error during action "${action}":\n${dir}${cmd}${stdout}${stderr}\nMessage: ${(error as Error).message}${help}`)
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
