# Bespoke Generalised Components

This directory contains reusable components for creating embedded applications that share a consistent design system and user experience.

## Components

### 1. `client/bespoke.css`
The core CSS framework providing:
- Consistent design tokens (colors, spacing, typography)
- Light and dark theme support
- Reusable component styles (buttons, forms, modals, cards)
- Responsive design utilities

### 2. `client/index.html`
A base HTML template that includes:
- Navigation header with app name and help button
- Main layout structure (sidebar + content area)
- Help modal integration
- Proper CSS and JavaScript loading

### 3. `client/help-modal.js`
A dependency-free JavaScript module for the help modal system:
- Consistent modal behavior across all apps
- Keyboard navigation (ESC to close)
- Focus management
- Custom event system

### 4. `client/help-content-template.html`
A template for creating consistent help content:
- Table of contents navigation
- Standardized section structure
- FAQ with collapsible details
- Image integration guidelines

## Usage Instructions

### Setting Up a New Application

1. **Fork the repository**
2. **Customize the HTML template** by replacing placeholders:
   - `<!-- APP_TITLE -->` - Your application title
   - `<!-- APP_NAME -->` - Your application name (appears in header)
   - `<!-- APP_SPECIFIC_HEADER_CONTENT -->` - Any additional header elements
   - `<!-- APP_SPECIFIC_MAIN_CONTENT -->` - Your main content area
   - `<!-- APP_SPECIFIC_CSS -->` - Links to your app-specific CSS files
   - `<!-- APP_SPECIFIC_SCRIPTS -->` - Links to your app-specific JavaScript files

3. **Implement your application logic**. You can use Cursor or other agents for it. There is a file called `AGENTS.md` that contains context LLM can use.
4. **Customise your help content** using the help content template

### Customizing Help Content

Use the `help-content-template.html` as a starting point:

1. **Replace placeholders** like `<!-- APP_NAME -->` with your actual content
2. **Add sections** as needed for your application
3. **Include images** by placing them in a `help/img/` directory
4. **Use the provided structure** for consistency across applications

### CSS Customization

The `bespoke.css` file uses CSS custom properties for easy theming:

```css
.bespoke {
  --bespoke-accent: #1062fb;        /* Primary accent color */
  --bespoke-bg: #ffffff;            /* Background color */
  --bespoke-fg: rgb(24, 33, 57);   /* Text color */
  /* ... many more variables */
}
```

You can override these variables in your app-specific CSS:

```css
.my-app {
  --bespoke-accent: #ff6b6b;  /* Custom accent color */
  --bespoke-bg: #f8f9fa;     /* Custom background */
}
```

### Help Modal API

The `HelpModal` class provides several methods:

```javascript
// Initialize
const modal = HelpModal.init({
  triggerSelector: '#btn-help',
  content: helpContent,
  theme: 'auto'
});

// Update content dynamically
modal.updateContent(newHelpContent);

// Destroy the modal
modal.destroy();
```

## Server

This template includes a local development server (`server.js`) that provides:
- Static file serving for your application
- WebSocket support for real-time messaging
- A REST API for triggering client-side alerts

### Starting the Server

```bash
node server.js
```

The server will start on `http://localhost:3000` by default.

### WebSocket Messaging API

The server provides a `POST /message` endpoint that allows you to send real-time messages to connected clients. This can be used to signal changes in the client during events like "Run" or "Submit". When a message is sent, the preview window with the application open will display an alert with the message.

It uses the `ws` package, so if you want to use it, install the packages (but this is optional).

```
npm install
```

#### Endpoint: `POST /message`

**Request Format:**
```json
{
  "message": "Your message here"
}
```

**Example using curl:**
```bash
curl -X POST http://localhost:3000/message \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello from the server!"}'
```
