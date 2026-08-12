---
name: dark-theme
description: Use when adding or modifying CSS styles for the app. Triggers on "style", "CSS", "theme", "color", "dark mode", or visual design changes. Enforces Catppuccin Mocha palette and BEM naming conventions.
---

# Dark Theme Skill

Use this skill whenever CSS styles are added or modified for the Media Markdown Converter.

## Palette — Catppuccin Mocha

| Token | Hex | Usage |
|---|---|---|
| `base` | `#1e1e2e` | Background |
| `mantle` | `#181825` | Outer background, overlays |
| `crust` | `#11111b` | Bottom bar, modals |
| `surface0` | `#313244` | Input backgrounds, cards |
| `surface1` | `#45475a` | Borders, dividers |
| `overlay0` | `#585b70` | Muted text, placeholders |
| `text` | `#cdd6f4` | Primary text |
| `subtext` | `#a6adc8` | Secondary text, labels |
| `blue` | `#89b4fa` | Primary buttons, links, focus |
| `red` | `#f38ba8` | Errors, danger buttons |
| `green` | `#a6e3a1` | Success states |
| `yellow` | `#f9e2af` | Warnings |
| `mauve` | `#cba6f7` | Accents, highlights |

## Rules

### 1. BEM Naming

```
.component-name          /* Block */
.component-name__element  /* Element */
.component-name--modifier /* Modifier */
```

- Hyphens, not camelCase
- Two underscores for elements, two dashes for modifiers
- Component name matches the React component name (kebab-case)

### 2. CSS Location

All component styles go in `src/styles.css`. No CSS-in-JS, no inline styles (except dynamic values like `transform: scale()`).

### 3. Variables

Use CSS custom properties for theme colors:

```css
:root {
  --bg: #1e1e2e;
  --surface: #313244;
  --border: #45475a;
  --text: #cdd6f4;
  --text-muted: #a6adc8;
  --accent: #89b4fa;
  --error: #f38ba8;
  --success: #a6e3a1;
}
```

### 4. Typography

- Font: `system-ui, -apple-system, sans-serif`
- Monospace for code/markdown: `ui-monospace, 'Cascadia Code', 'Fira Code', monospace`
- Base size: `14px`
- Headings: `1.25rem` (h2), `1.1rem` (h3)

### 5. Spacing

Use rem units:
- Tight: `0.25rem`, `0.5rem`
- Normal: `0.75rem`, `1rem`
- Wide: `1.5rem`, `2rem`

### 6. Interactive States

Every interactive element needs:
```css
.btn { cursor: pointer; transition: background 0.15s, opacity 0.15s; }
.btn:hover { opacity: 0.85; }
.btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.btn:disabled { opacity: 0.4; cursor: not-allowed; }
```

### 7. Scrollbars

Dark-themed custom scrollbars:
```css
::-webkit-scrollbar { width: 8px; height: 8px; }
::-webkit-scrollbar-track { background: var(--bg); }
::-webkit-scrollbar-thumb { background: var(--border); border-radius: 4px; }
::-webkit-scrollbar-thumb:hover { background: var(--overlay0); }
```

### 8. Layout

- Flexbox for most layouts
- Grid only for complex 2D layouts
- `gap` for spacing, no margin hacks
- Responsive: panels stack vertically below `768px`

## Adding New Styles

When adding styles for a new component:

1. Define the block class (`.component-name`)
2. Define element classes (`.component-name__element`)
3. Define modifier classes if needed (`.component-name--active`)
4. Use theme variables, not hardcoded colors
5. Include `:focus-visible` for keyboard accessibility
6. Include `:disabled` state for interactive elements

## Anti-Patterns

- Hardcoded hex colors not from the palette
- `!important` overrides
- Inline styles for non-dynamic values
- Nested selectors deeper than 3 levels
- Margin-based spacing (use `gap` or padding)
- px units for responsive values (use `rem` or `em`)
