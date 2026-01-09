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
                this.handleGitError(error, 'validate repository')
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
            this.handleGitError(error, 'fetch branches')
            return []
        }
    }

    static async add(repoPath: string): Promise<void> {
        try {
            await execFileAsync('git', ['add', '.'], { cwd: repoPath })
        } catch (error) {
            this.handleGitError(error, 'stage changes')
            throw error
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
            this.handleGitError(error, 'commit changes')
            throw error
        }
    }

    static async push(repoPath: string, branch: string): Promise<void> {
        try {
            await execFileAsync('git', ['push', 'origin', branch], { cwd: repoPath })
        } catch (error) {
            this.handleGitError(error, 'push changes')
            throw error
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
            this.handleGitError(error, 'pull from remote')
            throw error
        }
    }

    private static handleGitError(error: any, action: string) {
        console.error(`Git error during ${action}:`, error)
        // ENOENT specifically means the git executable was not found 
        // (or less commonly that the cwd directory does not exist)
        if ((error as any).code === 'ENOENT') {
            throw new Error('Git is not found.')
        }
    }
}
