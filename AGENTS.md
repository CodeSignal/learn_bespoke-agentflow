# BESPOKE GENERALIZED COMPONENTS - IMPLEMENTATION CONTEXT

This document provides precise implementation instructions for creating embedded applications using the Bespoke generalized components. Follow these instructions exactly to ensure consistency across all applications.

## REQUIRED FILES STRUCTURE

Every application MUST include these files in the following order:

1. bespoke.css (core styling framework)
2. help-modal.js (help system)
3. app.js (application logic)
4. server.js (server)

## HTML TEMPLATE IMPLEMENTATION

1. REPLACE the following placeholders in index.html EXACTLY as specified:

   a) `<!-- APP_TITLE -->`
      Replace with your application's page title
      Example: "Database Designer" or "Task Manager"

   b) `<!-- APP_NAME -->`
      Replace with your application's display name (appears in header)
      Example: "Database Designer" or "Task Manager"

   c) `<!-- APP_SPECIFIC_MAIN_CONTENT -->`
      Add your application's main content area
      Example: `<div id="canvas"></div>` or `<div id="editor"></div>`

   d) `<!-- APP_SPECIFIC_CSS -->`
      Add links to your application-specific CSS files
      Example: `<link rel="stylesheet" href="./my-app.css" />`

   e) `<!-- APP_SPECIFIC_SCRIPTS -->`
      Add links to your application-specific JavaScript files
      Example: `<script src="./my-app-logic.js"></script>`

3. DO NOT modify the core structure (header, script loading order, etc.)

## CSS IMPLEMENTATION

1. ALWAYS use the `.bespoke` class on the body element
2. USE ONLY the provided CSS custom properties for styling:
   - Colors: `--bespoke-bg`, `--bespoke-fg`, `--bespoke-accent`, etc.
   - Spacing: `--bespoke-space-xs` through `--bespoke-space-2xl`
   - Typography: `--bespoke-font-size-*`, `--bespoke-font-weight-*`
   - Borders: `--bespoke-radius-*`, `--bespoke-stroke`
   - Shadows: `--bespoke-shadow-*`

3. FOR custom styling, create app-specific CSS files
4. OVERRIDE variables in your app-specific CSS, not in bespoke.css
5. FOLLOW the existing naming conventions for consistency

## JAVASCRIPT IMPLEMENTATION

1. HELP MODAL SETUP:
   a) Create help content using help-content-template.html as reference
   b) Initialize HelpModal with:
      - triggerSelector: `'#btn-help'`
      - content: your help content (string or loaded from file)
      - theme: `'auto'`

2. STATUS MANAGEMENT:
   a) Use the provided setStatus() function for status updates
   b) Update status for: loading, saving, errors, user actions
   c) Keep status messages concise and informative

## ERROR HANDLING REQUIREMENTS

1. WRAP all async operations in try-catch blocks
2. PROVIDE meaningful error messages to users
3. LOG errors to console for debugging
4. IMPLEMENT retry logic for network operations
5. HANDLE localStorage quota exceeded errors
6. VALIDATE data before saving operations

## STATUS MESSAGE CONVENTIONS

Use these EXACT status messages for consistency:

- "Ready" - Application loaded successfully
- "Loading..." - Data is being loaded
- "Saving..." - Data is being saved
- "Changes saved" - Auto-save completed successfully
- "Save failed (will retry)" - Server save failed, will retry
- "Failed to load data" - Data loading failed
- "Auto-save initialized" - Auto-save system started

## FILE NAMING CONVENTIONS

1. CSS files: kebab-case (e.g., my-app.css, task-manager.css)
2. JavaScript files: kebab-case (e.g., my-app.js, task-manager.js)
3. Data files: kebab-case (e.g., solution.json, initial-data.json)
4. Image files: kebab-case (e.g., overview.png, help-icon.svg)

---

# BESPOKE CSS SELECTOR GUIDELINES

This section explains how to use the Bespoke CSS framework for embedded applications.

## OVERVIEW
The Bespoke CSS framework provides a scoped, reusable set of components that can be embedded in any website without conflicts. All styles are scoped under the `.bespoke` class to prevent interference with parent site styles.

## BASIC USAGE

### 1. Include the CSS
```html
<link rel="stylesheet" href="./generalised/bespoke.css" />
```

### 2. Wrap Your Application
```html
<div class="bespoke">
  <!-- Your embedded application content goes here -->
</div>
```

### 3. Use the Component Classes
```html
<div class="bespoke">
  <header class="header">
    <h1>My App</h1>
    <div class="status">Ready</div>
  </header>

  <main class="main-layout">
    <aside class="sidebar">
      <section class="card">
        <h2>Settings</h2>
        <form>
          <label>Name
            <input type="text" placeholder="Enter name" />
          </label>
          <button type="submit">Save</button>
        </form>
      </section>
    </aside>

    <div class="content-area">
      <!-- Main content -->
    </div>
  </main>
</div>
```

## COMPONENT REFERENCE

### LAYOUT COMPONENTS

#### Header
```html
<header class="header">
  <h1>App Title</h1>
  <div class="status">Status message</div>
  <button class="as-button ghost">Help</button>
</header>
```

#### Main Layout (Sidebar + Content)
```html
<main class="main-layout">
  <aside class="sidebar">
    <!-- Sidebar content -->
  </aside>
  <div class="content-area">
    <!-- Main content area -->
  </div>
</main>
```

#### Cards
```html
<section class="card">
  <h2>Card Title</h2>
  <h3>Subtitle</h3>
  <p>Card content goes here</p>
</section>
```

### FORM COMPONENTS

#### Labels
```html
<!-- Vertical label -->
<label>Field Name
  <input type="text" />
</label>

<!-- Horizontal label -->
<label class="row">
  <input type="checkbox" />
  Checkbox Label
</label>
```

#### Input Fields
```html
<!-- Text input -->
<input type="text" placeholder="Enter text" />

<!-- Select dropdown -->
<select>
  <option>Option 1</option>
  <option>Option 2</option>
</select>

<!-- Checkbox -->
<input type="checkbox" />

<!-- Radio buttons -->
<div class="radio-group">
  <label class="row">
    <input type="radio" name="option" value="a" />
    Option A
  </label>
  <label class="row">
    <input type="radio" name="option" value="b" />
    Option B
  </label>
</div>

<!-- Horizontal radio group -->
<div class="radio-group horizontal">
  <label class="row">
    <input type="radio" name="size" value="small" />
    Small
  </label>
  <label class="row">
    <input type="radio" name="size" value="large" />
    Large
  </label>
</div>

<!-- Textarea -->
<textarea placeholder="Enter your message here..."></textarea>

<!-- Toggle switch -->
<label class="row">
  <div class="toggle">
    <input type="checkbox" class="toggle-input" />
    <span class="toggle-slider"></span>
  </div>
  <span class="toggle-label">Enable notifications</span>
</label>
```

#### Buttons
```html
<!-- Default button -->
<button>Click Me</button>

<!-- Button variants -->
<button class="primary">Primary Action</button>
<button class="danger">Delete</button>
<button class="ghost">Secondary</button>

<!-- Button as link -->
<a href="#" class="as-button">Link Button</a>
```

### MODAL COMPONENTS

#### Basic Modal
```html
<div class="modal">
  <div class="modal-backdrop"></div>
  <div class="modal-content">
    <div class="modal-header">
      <h2>Modal Title</h2>
      <button class="modal-close">&times;</button>
    </div>
    <div class="modal-body">
      <p>Modal content goes here</p>
    </div>
  </div>
</div>
```

## CUSTOMIZATION

### CSS Custom Properties
You can override any CSS custom property to customize the appearance:

```css
.bespoke {
  /* Override colors */
  --bespoke-bg: #f0f0f0;
  --bespoke-fg: #333333;
  --bespoke-accent: #ff6b6b;

  /* Override spacing */
  --bespoke-space-lg: 1.5rem;

  /* Override border radius */
  --bespoke-radius-lg: 12px;
}
```

### Available Custom Properties

#### Colors
- `--bespoke-bg`: Background color
- `--bespoke-fg`: Text color
- `--bespoke-muted`: Muted text color
- `--bespoke-box`: Container/surface background
- `--bespoke-stroke`: Border color
- `--bespoke-danger`: Error/danger color
- `--bespoke-accent`: Accent/primary color
- `--bespoke-control-bg`: Input/button background
- `--bespoke-control-border`: Input/button border
- `--bespoke-control-focus`: Focus ring color

#### Spacing
- `--bespoke-space-xs`: 0.25rem
- `--bespoke-space-sm`: 0.5rem
- `--bespoke-space-md`: 0.75rem
- `--bespoke-space-lg`: 1rem
- `--bespoke-space-xl`: 1.5rem
- `--bespoke-space-2xl`: 2rem

#### Border Radius
- `--bespoke-radius-sm`: 4px
- `--bespoke-radius-md`: 6px
- `--bespoke-radius-lg`: 8px
- `--bespoke-radius-xl`: 12px

#### Shadows
- `--bespoke-shadow-sm`: Small shadow
- `--bespoke-shadow-md`: Medium shadow
- `--bespoke-shadow-lg`: Large shadow
- `--bespoke-shadow-xl`: Extra large shadow

## THEME SUPPORT

### Automatic Dark Mode
The framework automatically detects the user's system preference and switches between light and dark themes. No additional configuration is needed.

## INTEGRATION EXAMPLES

### Database Designer
```html
<div class="bespoke">
  <header class="header">
    <h1>DB Schema Designer</h1>
    <button id="btn-save">Save</button>
    <div class="status">Ready</div>
    <button class="as-button ghost">Help</button>
  </header>

  <main class="main-layout">
    <aside class="sidebar">
      <section class="card">
        <h2>New Table</h2>
        <form>
          <label>Table name
            <input type="text" placeholder="users" />
          </label>
          <button type="submit">Add Table</button>
        </form>
      </section>
    </aside>

    <div class="content-area">
      <!-- Diagram area -->
    </div>
  </main>
</div>
```
## BEST PRACTICES

1. **Always wrap in `.bespoke`**: This prevents style conflicts with the parent site
2. **Use semantic HTML**: Combine with proper HTML elements for accessibility
3. **Customize via CSS variables**: Don't modify the core CSS file
4. **Test in both themes**: Ensure your app works in light and dark modes
