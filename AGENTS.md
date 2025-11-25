# CodeSignal Design System - Agent Reference Guide

This document provides comprehensive information for agentic code generators to effectively use the CodeSignal Design System.

## Table of Contents

1. [System Overview](#system-overview)
2. [Installation & Setup](#installation--setup)
3. [Design Tokens](#design-tokens)
4. [Components](#components)
5. [Usage Patterns](#usage-patterns)
6. [Best Practices](#best-practices)
7. [File Structure](#file-structure)

---

## System Overview

The CodeSignal Design System is a CSS-based design system organized into **Foundations** (design tokens) and **Components** (reusable UI elements). All components are built using CSS custom properties (CSS variables) for theming and consistency.

### Key Principles

- **Semantic over Primitive**: Always prefer semantic tokens (e.g., `--Colors-Text-Body-Default`) over base scale tokens
- **Dark Mode Support**: All components automatically adapt to dark mode via `@media (prefers-color-scheme: dark)`
- **CSS-First**: Components are primarily CSS-based with minimal JavaScript (only Dropdown requires JS)
- **Accessibility**: Components follow WCAG guidelines and support keyboard navigation

---

## Installation & Setup

### Required CSS Files (Load in Order)

```html
<!-- 1. Fonts (Work Sans) -->
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Work+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">

<!-- 2. Foundations (Required for all components) -->
<link rel="stylesheet" href="/design-system/colors/colors.css">
<link rel="stylesheet" href="/design-system/spacing/spacing.css">
<link rel="stylesheet" href="/design-system/typography/typography.css">

<!-- 3. Components (Include only what you need) -->
<link rel="stylesheet" href="/design-system/components/button/button.css">
<link rel="stylesheet" href="/design-system/components/boxes/boxes.css">
<link rel="stylesheet" href="/design-system/components/dropdown/dropdown.css">
<link rel="stylesheet" href="/design-system/components/icons/icons.css">
<link rel="stylesheet" href="/design-system/components/input/input.css">
<link rel="stylesheet" href="/design-system/components/tags/tags.css">
```

### Alternative: CSS Import

```css
@import url('/design-system/colors/colors.css');
@import url('/design-system/spacing/spacing.css');
@import url('/design-system/typography/typography.css');
@import url('/design-system/components/button/button.css');
```

### JavaScript (Only for Dropdown)

```html
<script type="module">
  import Dropdown from '/design-system/components/dropdown/dropdown.js';
</script>
```

---

## Design Tokens

### Colors

#### Base Scales (Primitive Tokens)
**Avoid using these directly** - use semantic tokens instead for theming support.

Pattern: `--Colors-Base-[Family]-[Step]`

**Families:**
- `Primary`: Brand blue colors (20-1400 scale)
- `Neutral`: Grays, white, black (00-1400 scale)
- `Accent-Green`: Success states
- `Accent-Sky-Blue`: Info states
- `Accent-Yellow`: Warning states
- `Accent-Orange`: Warning states
- `Accent-Red`: Error/Danger states

**Example:**
```css
--Colors-Base-Primary-700: #1062FB;
--Colors-Base-Neutral-600: #ACB4C7;
--Colors-Base-Accent-Green-600: #10B981;
```

#### Semantic Tokens (Preferred)
**Always use these** for automatic dark mode support and consistency.

**Categories:**

1. **Primary Colors**
   - `--Colors-Primary-Default`
   - `--Colors-Primary-Medium`
   - `--Colors-Primary-Strong`

2. **Backgrounds**
   - `--Colors-Backgrounds-Main-Default`
   - `--Colors-Backgrounds-Main-Top`
   - `--Colors-Backgrounds-Main-Medium`
   - `--Colors-Backgrounds-Main-Strong`

3. **Text Colors**
   - `--Colors-Text-Body-Default`
   - `--Colors-Text-Body-Secondary`
   - `--Colors-Text-Body-Medium`
   - `--Colors-Text-Body-Strong`
   - `--Colors-Text-Body-Strongest`

4. **Icon Colors**
   - `--Colors-Icon-Default`
   - `--Colors-Icon-Primary`
   - `--Colors-Icon-Secondary`

5. **Stroke/Border Colors**
   - `--Colors-Stroke-Default`
   - `--Colors-Stroke-Strong`
   - `--Colors-Stroke-Strongest`

6. **Alert Colors**
   - `--Colors-Alert-Success-Default`, `--Colors-Alert-Success-Medium`
   - `--Colors-Alert-Error-Default`, `--Colors-Alert-Error-Medium`
   - `--Colors-Alert-Warning-Default`, `--Colors-Alert-Warning-Medium`
   - `--Colors-Alert-Info-Default`, `--Colors-Alert-Info-Medium`

### Spacing

Pattern: `--UI-Spacing-spacing-[size]`

**Available Sizes:**
- `none`: 0
- `min`: 2px
- `xxs`: 4px
- `xs`: 6px
- `s`: 8px
- `mxs`: 12px
- `ms`: 16px
- `m`: 18px
- `ml`: 20px
- `mxl`: 24px
- `l`: 28px
- `xl`: 32px
- `xxl`: 36px
- `xxxl`: 48px
- `4xl`: 60px
- `max`: 90px

**Usage:**
```css
padding: var(--UI-Spacing-spacing-m);
margin: var(--UI-Spacing-spacing-s);
gap: var(--UI-Spacing-spacing-mxl);
```

### Border Radius

Pattern: `--UI-Radius-radius-[size]`

**Available Sizes:**
- `none`: 0
- `min`: 2px
- `xxs`: 4px
- `xs`: 6px
- `s`: 8px
- `m`: 12px
- `ml`: 16px
- `mxl`: 20px
- `l`: 24px
- `xl`: 32px

**Usage:**
```css
border-radius: var(--UI-Radius-radius-m);
```

### Input Heights

Pattern: `--UI-Input-[size]`

**Available Sizes:**
- `min`: 26px
- `xs`: 32px
- `sm`: 40px
- `md`: 48px (default)
- `lg`: 60px

**Usage:**
```css
height: var(--UI-Input-md);
```

### Typography

#### Font Families
- **Body & Labels**: `Work Sans` (sans-serif) - Must be loaded from Google Fonts
- **Headings**: `Founders Grotesk` (sans-serif) - Included via `@font-face`
- **Code**: `JetBrains Mono` (monospace) - Included via `@font-face`

#### Typography Classes

**Body Text** (Work Sans):
- `.body-xxsmall` (13px)
- `.body-xsmall` (14px)
- `.body-small` (15px)
- `.body-medium` (16px)
- `.body-large` (17px)
- `.body-xlarge` (19px)
- `.body-xxlarge` (21px)
- `.body-xxxlarge` (24px)

**Body Elegant** (Founders Grotesk):
- `.body-elegant-xxsmall` (22px)
- `.body-elegant-xsmall` (26px)
- `.body-elegant-small` (32px)
- `.body-elegant-medium` (38px)

**Headings** (Founders Grotesk, 500 weight):
- `.heading-xxxsmall` (16px)
- `.heading-xxsmall` (22px)
- `.heading-xsmall` (22px)
- `.heading-small` (24px)
- `.heading-medium` (32px)
- `.heading-large` (38px)
- `.heading-xlarge` (48px)
- `.heading-xxlarge` (64px)

**Labels** (Work Sans, 600 weight, uppercase):
- `.label-small` (10px)
- `.label-medium` (11px)
- `.label-large` (14px)

**Label Numbers** (Work Sans, 500 weight):
- `.label-number-xsmall` (11px)
- `.label-number-small` (12px)
- `.label-number-medium` (14px)
- `.label-number-large` (15px)

---

## Components

### Button

**Base Class:** `.button` (required)

**Variants:**
- `.button-primary`: Primary action (Brand Blue background)
- `.button-secondary`: Secondary action (Outlined style)
- `.button-tertiary`: Tertiary/Ghost (Subtle background)
- `.button-danger`: Destructive action (Red)
- `.button-success`: Positive action (Green)
- `.button-text`: Text button (Neutral text, no background)
- `.button-text-primary`: Primary text button (Brand color text)

**Sizes:**
- `.button-xsmall`: 32px height
- `.button-small`: 40px height
- Default: 48px height (medium)
- `.button-large`: 60px height

**States:**
- Standard pseudo-classes: `:hover`, `:focus`, `:active`, `:disabled`
- Utility classes: `.hover`, `.focus`, `.active`, `.disabled`

**Example:**
```html
<button class="button button-primary button-large">Submit</button>
<button class="button button-secondary button-small">Cancel</button>
<button class="button button-danger" disabled>Delete</button>
```

**Dependencies:** colors.css, spacing.css, typography.css

---

### Box

**Base Class:** `.box` (required)

**Variants:**
- `.box.selected`: Selected state (Primary border)
- `.box.emphasized`: Emphasized state (Neutral border)
- `.box.shadowed`: Soft shadow
- `.box.card`: Card-style shadow

**States:**
- Standard pseudo-classes: `:hover`, `:focus`, `:active`
- Utility classes: `.hover`, `.focus`, `.selected`

**Example:**
```html
<div class="box">Default content</div>
<div class="box selected">Selected content</div>
<div class="box card">Card content</div>
```

**Dependencies:** colors.css, spacing.css

---

### Input

**Base Class:** `.input` (required)

**Input Types:**
- `type="text"`: Standard text input (default)
- `type="number"`: Numeric input with styled spinner buttons

**States:**
- Standard pseudo-classes: `:hover`, `:focus`, `:disabled`
- Utility classes: `.hover`, `.focus`

**Features:**
- Automatic focus ring (primary color with reduced opacity)
- Styled number input spinners
- Dark mode support

**Example:**
```html
<input type="text" class="input" placeholder="Enter text...">
<input type="number" class="input" placeholder="Enter number...">
<input type="text" class="input" disabled placeholder="Disabled">
```

**Dependencies:** colors.css, spacing.css, typography.css

---

### Tag

**Base Class:** `.tag` or `.tag.default` (required)

**Variants:**
- `.tag` / `.tag.default`: Primary tag (Brand Blue background)
- `.tag.secondary`: Secondary tag (Neutral gray background)
- `.tag.outline`: Outline tag (Transparent with border)
- `.tag.success`: Success tag (Green background)
- `.tag.error`: Error tag (Red background)
- `.tag.warning`: Warning tag (Yellow background)
- `.tag.info`: Info tag (Sky Blue background)

**States:**
- Standard pseudo-classes: `:hover`, `:focus`, `:active`
- Utility classes: `.hover`, `.focus`, `.active`

**Example:**
```html
<div class="tag">Default</div>
<div class="tag success">Completed</div>
<div class="tag error">Failed</div>
<div class="tag outline">Filter</div>
```

**Dependencies:** colors.css, spacing.css, typography.css

---

### Icon

**Base Class:** `.icon` (required)

**Icon Names:**
Use `.icon-[name]` where `[name]` is derived from SVG filename (e.g., `Icon=Academy.svg` → `.icon-academy`)

**Available Icons** (80+ icons):
- `.icon-academy`
- `.icon-assessment`
- `.icon-interview`
- `.icon-jobs`
- `.icon-course`
- ... (see `icons.css` for full list)

**Sizes:**
- `.icon-small`: 16px
- `.icon-medium`: 24px (default)
- `.icon-large`: 32px
- `.icon-xlarge`: 48px

**Colors:**
- Default: Uses `currentColor` (inherits text color)
- `.icon-primary`: Primary brand color
- `.icon-secondary`: Secondary neutral color
- `.icon-success`: Success green color
- `.icon-danger`: Danger red color
- `.icon-warning`: Warning yellow color

**Implementation Note:**
Icons use `mask-image` with `background-color` for color control. SVGs in data URIs use black fills (black = visible in mask).

**Example:**
```html
<span class="icon icon-jobs"></span>
<span class="icon icon-jobs icon-large icon-primary"></span>
<span class="icon icon-academy icon-small icon-success"></span>
```

**Dependencies:** colors.css, spacing.css

---

### Dropdown (JavaScript Component)

**Import:**
```javascript
import Dropdown from '/design-system/components/dropdown/dropdown.js';
```

**Initialization:**
```javascript
const dropdown = new Dropdown(selector, options);
```

**Configuration Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `items` | Array | `[]` | Array of `{value, label}` objects |
| `placeholder` | String | `'Select option'` | Placeholder text |
| `selectedValue` | String | `null` | Initial selected value |
| `width` | String/Number | `'auto'` | Fixed width (ignored if `growToFit` is true) |
| `growToFit` | Boolean | `false` | Auto-resize to fit content |
| `onSelect` | Function | `null` | Callback `(value, item)` on selection |

**API Methods:**
- `getValue()`: Returns current selected value
- `setValue(value)`: Sets selected value programmatically
- `open()`: Opens dropdown menu
- `close()`: Closes dropdown menu
- `toggleOpen()`: Toggles open state
- `destroy()`: Removes event listeners and clears container

**Example:**
```javascript
const dropdown = new Dropdown('#my-dropdown', {
  placeholder: 'Choose an option',
  items: [
    { value: '1', label: 'Option 1' },
    { value: '2', label: 'Option 2' },
    { value: '3', label: 'Option 3' }
  ],
  onSelect: (value, item) => {
    console.log('Selected:', value, item);
  }
});

// Later...
dropdown.setValue('2');
const currentValue = dropdown.getValue();
```

**Dependencies:** colors.css, spacing.css, typography.css

---

## Usage Patterns

### Component Composition

Components can be combined and nested:

```html
<!-- Button with icon -->
<button class="button button-primary">
  <span class="icon icon-jobs icon-small"></span>
  Submit
</button>

<!-- Tag with icon -->
<div class="tag success">
  <span class="icon icon-check icon-small"></span>
  Completed
</div>

<!-- Box with input and button -->
<div class="box">
  <input type="text" class="input" placeholder="Search...">
  <button class="button button-primary button-small">Search</button>
</div>
```

### Custom Styling

You can extend components using CSS custom properties:

```css
.my-custom-button {
  /* Inherit button styles */
  composes: button button-primary;
  
  /* Override with custom properties */
  --Colors-Base-Primary-700: #custom-color;
}
```

### Responsive Design

Use standard CSS media queries with design tokens:

```css
@media (max-width: 768px) {
  .responsive-box {
    padding: var(--UI-Spacing-spacing-s);
  }
}
```

---

## Best Practices

### 1. Token Usage

✅ **DO:**
```css
color: var(--Colors-Text-Body-Default);
padding: var(--UI-Spacing-spacing-m);
border-radius: var(--UI-Radius-radius-m);
```

❌ **DON'T:**
```css
color: #333;
padding: 16px;
border-radius: 8px;
```

### 2. Component Classes

✅ **DO:**
```html
<button class="button button-primary">Click</button>
```

❌ **DON'T:**
```html
<button class="btn btn-primary">Click</button>
```

### 3. Dark Mode

✅ **DO:** Use semantic tokens (automatic dark mode)
```css
background: var(--Colors-Backgrounds-Main-Default);
```

❌ **DON'T:** Use hardcoded colors
```css
background: #ffffff;
```

### 4. File Loading Order

✅ **DO:** Load foundations before components
```html
<!-- Foundations first -->
<link rel="stylesheet" href="colors/colors.css">
<link rel="stylesheet" href="spacing/spacing.css">
<link rel="stylesheet" href="typography/typography.css">

<!-- Then components -->
<link rel="stylesheet" href="components/button/button.css">
```

### 5. Icon Usage

✅ **DO:**
```html
<span class="icon icon-jobs icon-large icon-primary"></span>
```

❌ **DON'T:** Use inline SVG or img tags for icons
```html
<img src="icon.svg" alt="icon">
```

### 6. Accessibility

- Always include proper `alt` text for images
- Use semantic HTML (`<button>`, `<input>`, etc.)
- Ensure keyboard navigation works
- Test with screen readers

---

## File Structure

```
design-system/
├── colors/
│   ├── colors.css          # Color tokens (base + semantic)
│   ├── README.md
│   └── test.html
├── spacing/
│   ├── spacing.css          # Spacing, radius, input height tokens
│   ├── README.md
│   └── test.html
├── typography/
│   ├── typography.css        # Typography classes and font definitions
│   ├── README.md
│   └── test.html
├── fonts/
│   └── FoundersGrotesk-*.woff2
├── components/
│   ├── button/
│   │   ├── button.css
│   │   ├── README.md
│   │   └── test.html
│   ├── boxes/
│   │   ├── boxes.css
│   │   ├── README.md
│   │   └── test.html
│   ├── dropdown/
│   │   ├── dropdown.css
│   │   ├── dropdown.js
│   │   ├── README.md
│   │   └── test.html
│   ├── icons/
│   │   ├── icons.css         # 80+ icon definitions
│   │   ├── README.md
│   │   └── test.html
│   ├── input/
│   │   ├── input.css
│   │   ├── README.md
│   │   └── test.html
│   └── tags/
│       ├── tags.css
│       ├── README.md
│       └── test.html
├── test.html                 # Test bed navigation
├── README.md
├── llms.txt                  # Quick reference for LLMs
└── agents.md                 # This file
```

---

## Testing

Each component includes a `test.html` file demonstrating usage. The main test bed is available at:

```
http://[your-server]/design-system/test.html
```

This provides:
- Sidebar navigation to all components
- Interactive examples
- Code snippets
- Visual regression testing

---

## Version Information

- **Design System Version**: Current
- **Browser Support**: Modern browsers (Chrome, Firefox, Safari, Edge)
- **CSS Features Used**: CSS Custom Properties, CSS Grid, Flexbox, CSS Masks
- **JavaScript**: ES6 Modules (Dropdown component only)

---

## Additional Resources

- **Main README**: See `README.md` for overview
- **Component READMEs**: Each component has detailed documentation
- **Test Files**: See `test.html` files for examples
- **Demo Site**: https://codesignal.github.io/learn_bespoke-design-system/test.html

---

## Support & Contribution

For questions or issues:
1. Check component-specific README files
2. Review test.html examples
3. Inspect CSS files for available tokens and classes
