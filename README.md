# Placeholder Snippets

An Obsidian plugin for reusable snippets with clickable placeholders that can be replaced by typing.

This local Obsidian plugin adds Word-style placeholders for reusable snippets.

## Placeholder format

Write placeholders as:

```markdown
{{ph:Title}}
```

In Live Preview they display as clickable tokens such as `[Title]`. Click a token and start typing to replace the whole placeholder.

`{{placeholder:Title}}` also works.

Rendered Markdown blocks, including callouts, are also processed. Clicking a rendered placeholder selects the matching source token in the active note so it can be replaced by typing.

## Commands

- `Placeholder Snippets: Insert placeholder`
- `Placeholder Snippets: Insert title placeholder`
- `Placeholder Snippets: Insert snippet`
- `Placeholder Snippets: Select next placeholder`

## Managing snippets

Go to `Settings -> Community plugins -> Placeholder Snippets` to add, edit, delete, or restore snippets.

Snippets can contain normal Markdown plus any number of placeholders:

```markdown
# {{ph:Title}}

{{ph:Body}}
```
