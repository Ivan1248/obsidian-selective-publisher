# Selective Publisher for Obsidian

A plugin for Obsidian that selectively publishes notes to a Git repository based on customizable criteria.

## Features
<!-- ![Screenshot of Plugin](path/to/screenshot.png) -->

- **Selective publishing**: Filtering of notes based on tags, frontmatter, paths, or content.
- **Git integration**: Committing and pushing to a target repository.
- **Publishing preview**: Review of changed files (new, modified, or deleted files) before publishing.

## Requirements

- Obsidian v0.15.0+
- Git installed and configured locally.
- A local clone of target remote repository.

## Installation

1. Search for "Selective Publisher" in Obsidian's Community Plugins.
2. Click "Install" and then "Enable".
3. Configure the plugin settings (see below).

## Setup

1. Clone your target repository (e.g., GitHub Pages) to a local folder.
2. In the plugin settings:
   - Set "Publishing directory" to the local clone's absolute path or a directory within it.
   - Optionally, set "Publishing branch" (e.g., `main`).
   - Configure "Publishing criterion" (see below).

## Usage

### Publishing criterion

The plugin evaluates each markdown file against a tree combining criteria:

- **Tag**: Matches exact Obsidian tag or hierarchical subtags (e.g., `public` matches `#public/blog`).
- **Frontmatter**: Matches a specific key and value in YAML frontmatter, with support for regex in the value field.
- **Folder**: Includes or excludes specific directories.
- **Title**: Matches the file basename (without extension). Supports substring or regex.
- **Path**: Matches the relative path from vault root. Supports substring or regex.
- **Content**: Matches body text based on a regex search.

Criteria can be combined using:
- **AND**: All child criteria must be true.
- **OR**: At least one child criterion must be true.
- **NOT**: Inverts the result of the child criterion.

### Publishing

There are two ways to publish notes:
- Click the ribbon button with a paper plane icon. By default, this opens a preview modal before publishing.
- Run the command `Publish notes`. This publishes the changes.

The preview modal displays the matching files and their status (new, modified, deleted, unmodified) relative to the target repository.

You can choose to publish (commit and push) or just commit (local only).

### Commands

- **Publish notes**: Publish all matching notes. Shows preview first if enabled in settings.
- **Preview publishable notes**: Preview files that match the criteria with their status (new, modified, deleted, unmodified).
- **Ribbon button** (paper plane icon): Quick shortcut to publish notes.

## Privacy

- All Git operations are executed locally.
- No data is sent to external servers except via the configured Git remote.

## Related projects

- [Enveloppe](https://github.com/Enveloppe/obsidian-enveloppe)