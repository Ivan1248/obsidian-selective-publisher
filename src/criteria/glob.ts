import picomatch from 'picomatch'

const GLOB_OPTIONS = { dot: true, contains: true }
// Without debug, picomatch hides syntax errors by turning the invalid pattern into one that matches nothing
const GLOB_VALIDATION_OPTIONS = { ...GLOB_OPTIONS, debug: true }

// Compiled lines of each multi-line pattern, as matching is repeated for every vault file
const compiledPatterns = new Map<string, { isNegated: boolean, isMatch: picomatch.Matcher }[]>()

/**
 * Parses a line of a .gitignore-style glob pattern, handling trimming and negation (!).
 * Returns undefined for a line without a pattern, such as an empty line or a comment (#).
 */
function parseGlobLine(line: string): { isNegated: boolean, glob: string } | undefined {
    const trimmed = line.trim()
    const isNegated = trimmed.startsWith('!')
    const glob = isNegated ? trimmed.slice(1) : trimmed
    return glob === '' || trimmed.startsWith('#') ? undefined : { isNegated, glob }
}

/** Returns true if the given line has no pattern or a valid .gitignore-style glob pattern. */
function isValidGlobLine(line: string): boolean {
    const parsed = parseGlobLine(line)
    if (!parsed) return true
    try {
        picomatch(parsed.glob, GLOB_VALIDATION_OPTIONS)
        return true
    } catch {
        return false
    }
}

/**
 * Validates line-separated .gitignore-style glob patterns.
 * Supports: * ** ? [chars] ! (negate) # (comment) leading / (anchor)
 * Returns an error message listing the invalid lines, or undefined if all are valid.
 */
export function validateGlobPatterns(value: string): string | undefined {
    const invalidLineNumbers = value.split('\n').flatMap((line, i) => isValidGlobLine(line) ? [] : [i + 1])
    if (invalidLineNumbers.length === 0) return undefined
    return invalidLineNumbers.length === 1
        ? `Invalid glob pattern on line ${invalidLineNumbers[0]}`
        : `Invalid glob patterns on lines ${invalidLineNumbers.join(', ')}`
}

/**
 * Tests a value against line-separated .gitignore-style glob patterns.
 * Supports # comments, ! negation, and last-match-wins semantics.
 */
export function matchesGlobPatterns(multiLinePattern: string, input: string): boolean {
    let compiled = compiledPatterns.get(multiLinePattern)
    if (!compiled) {
        // An invalid pattern matches nothing, as it is already reported where it is edited
        compiled = multiLinePattern.split('\n').flatMap((line) => {
            const parsed = parseGlobLine(line)
            return parsed ? [{ isNegated: parsed.isNegated, isMatch: picomatch(parsed.glob, GLOB_OPTIONS) }] : []
        })
        compiledPatterns.set(multiLinePattern, compiled)
    }

    let inputIsMatched = false
    for (const { isNegated, isMatch } of compiled) {
        if (isMatch(input)) {
            inputIsMatched = !isNegated
        }
    }
    return inputIsMatched
}
