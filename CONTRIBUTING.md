# COBOL Bridge — Developer & Designer Guide

> **Repository:** [github.com/CSGA-GLOBAL/cobol-bridge](https://github.com/CSGA-GLOBAL/cobol-bridge)
> **Live Site:** [cobol-bridge.vercel.app](https://cobol-bridge.vercel.app)
> **Domain:** cobolbridge.ai (Namecheap — pending DNS config)

---

## Quick Start (Local Development)

```bash
# 1. Clone the repo
git clone https://github.com/CSGA-GLOBAL/cobol-bridge.git
cd cobol-bridge

# 2. Install dependencies
npm install

# 3. Start the server
npm start
# → Server runs at http://localhost:3000

# 4. Open any page in your browser
# http://localhost:3000           → Homepage (index.html)
# http://localhost:3000/banking   → Banking sector page
# http://localhost:3000/pricing   → Pricing page
# etc.
```

**Requirements:** Node.js 18+ (repo specifies 24.x but 18+ works fine)

---

## Project Architecture

```
cobol-bridge/
├── server.js          ← Express server + MCP endpoints
├── package.json       ← Dependencies (express, cors, @modelcontextprotocol/sdk)
├── vercel.json        ← Vercel routing config (clean URLs)
├── index.html         ← Homepage
├── platform.html      ← Platform overview
├── sectors.html       ← All 6 sectors overview + SVG dashboard
├── pricing.html       ← Pricing tiers + Stripe payment links
├── docs.html          ← Documentation
├── about.html         ← About CSGA
├── contact.html       ← Contact form
├── banking.html       ← Banking sector landing page
├── government.html    ← Government sector landing page
├── healthcare.html    ← Healthcare sector landing page
├── insurance.html     ← Insurance sector landing page
├── defence.html       ← Defence sector landing page
├── finance.html       ← Finance sector landing page
└── README.md          ← Product overview
```

### Key Architecture Decisions

- **Each HTML page is fully self-contained** — all CSS, JS, and SVG are inline. No external stylesheets or script files.
- **No build step required** — edit HTML directly, save, and refresh.
- **Express server** handles MCP API endpoints (`/mcp/sse`, `/mcp/messages`, `/health`) and serves static HTML for everything else.
- **Clean URLs** — `/banking` serves `banking.html`, `/pricing` serves `pricing.html`, etc. This is handled by `vercel.json` on Vercel, or by Express fallback routing on a VPS.

---

## For Designers — How to Edit

### What You Can Safely Change

Every page is a standalone HTML file. You can:

1. **Edit any visual elements** — colours, fonts, spacing, layout, images, icons
2. **Restructure sections** — move content blocks, add new sections, change grid layouts
3. **Add images/assets** — create an `assets/` or `images/` folder and reference them
4. **Update copy** — change any text content
5. **Add animations** — the site uses scroll-reveal animations via IntersectionObserver (look for `.reveal` classes)

### What NOT to Change (Without Consulting Dev)

- **Stripe payment links** — the `href` values on pricing/subscribe buttons connect to live Stripe checkout
- **MCP endpoint references** — any URLs containing `/mcp/` are API endpoints
- **The `server.js` file** — this runs the backend MCP server
- **The `vercel.json` routes** — these map clean URLs to HTML files

### Workflow for Designers

**Option A: Edit directly on GitHub (simplest)**
1. Go to [github.com/CSGA-GLOBAL/cobol-bridge](https://github.com/CSGA-GLOBAL/cobol-bridge)
2. Click any `.html` file → Click the pencil (edit) icon
3. Make changes in the browser editor
4. Click "Commit changes" → changes auto-deploy to Vercel in ~30 seconds

**Option B: Clone locally (recommended for larger changes)**
```bash
git clone https://github.com/CSGA-GLOBAL/cobol-bridge.git
cd cobol-bridge
npm install
npm start
# Edit files, preview at http://localhost:3000
# When happy:
git add .
git commit -m "Design update: [description]"
git push origin main
# Auto-deploys to Vercel
```

**Option C: Use a branch (safest for big redesigns)**
```bash
git checkout -b design/visual-refresh
# Make all changes
git push origin design/visual-refresh
# Create a Pull Request on GitHub for review before merging
```

### Design System Reference

Current visual language used across all pages:

| Element | Value |
|---------|-------|
| Primary colour | `#00D4AA` (teal/cyan accent) |
| Background | `#0a0f1c` → `#1a1f2e` (dark gradient) |
| Cards | `rgba(255,255,255,0.05)` with `backdrop-filter: blur` |
| Text primary | `#ffffff` |
| Text secondary | `#94a3b8` |
| Font | System font stack (`-apple-system, BlinkMacSystemFont, 'Segoe UI'...`) |
| Border radius | `12px` (cards), `8px` (buttons) |
| Animations | Scroll-reveal with `IntersectionObserver`, 0.6s ease transitions |
| Grid | CSS Grid, typically `repeat(auto-fit, minmax(350px, 1fr))` |

---

## Deploying to Cobalt VPS

### Prerequisites on the VPS

```bash
# Install Node.js 18+ (if not already)
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install PM2 for process management
sudo npm install -g pm2

# Install Nginx as reverse proxy
sudo apt-get install -y nginx
```

### Deploy Steps

```bash
# 1. Clone on the VPS
cd /var/www
git clone https://github.com/CSGA-GLOBAL/cobol-bridge.git
cd cobol-bridge

# 2. Install dependencies
npm install --production

# 3. Start with PM2 (keeps it running)
pm2 start server.js --name cobol-bridge
pm2 save
pm2 startup  # Follow the output command to enable auto-start on reboot

# 4. Verify it's running
curl http://localhost:3000/health
# Should return: {"status":"healthy","version":"1.0.0","tools":5}
```

### Nginx Configuration

Create `/etc/nginx/sites-available/cobolbridge.ai`:

```nginx
server {
    listen 80;
    server_name cobolbridge.ai www.cobolbridge.ai;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    # SSE support for MCP endpoint
    location /mcp/sse {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Connection '';
        proxy_set_header Cache-Control 'no-cache';
        proxy_set_header X-Accel-Buffering 'no';
        chunked_transfer_encoding off;
        proxy_buffering off;
    }
}
```

Then enable and get SSL:

```bash
# Enable the site
sudo ln -s /etc/nginx/sites-available/cobolbridge.ai /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx

# Get free SSL with Let's Encrypt
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d cobolbridge.ai -d www.cobolbridge.ai
# Follow the prompts — auto-renews
```

### Important: Server.js Needs a Static File Fix for VPS

The current `server.js` serves MCP endpoints but relies on `vercel.json` for HTML routing. For VPS deployment, you need to add static file serving. Add these lines to `server.js` before the `app.listen()` call:

```javascript
const path = require('path');

// Serve static HTML files
app.use(express.static(path.join(__dirname)));

// Clean URL routing (matches vercel.json behaviour)
const pages = ['platform','about','sectors','pricing','docs','contact',
               'banking','government','healthcare','insurance','defence','finance'];

pages.forEach(page => {
  app.get('/' + page, (req, res) => {
    res.sendFile(path.join(__dirname, page + '.html'));
  });
});

// Fallback to index
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});
```

---

## Namecheap DNS Configuration (cobolbridge.ai)

### Option A: Point to Cobalt VPS

In Namecheap → Domain List → cobolbridge.ai → Advanced DNS:

| Type | Host | Value | TTL |
|------|------|-------|-----|
| A Record | @ | `YOUR_VPS_IP` | Automatic |
| A Record | www | `YOUR_VPS_IP` | Automatic |

Replace `YOUR_VPS_IP` with your Cobalt VPS IP address.

### Option B: Point to Vercel (alternative)

In Namecheap → Domain List → cobolbridge.ai → Advanced DNS:

| Type | Host | Value | TTL |
|------|------|-------|-----|
| CNAME | @ | `cname.vercel-dns.com` | Automatic |
| CNAME | www | `cname.vercel-dns.com` | Automatic |

Then in Vercel Dashboard → Project Settings → Domains → Add `cobolbridge.ai`.

---

## Auto-Deploy from GitHub (VPS)

To get automatic deploys on git push (like Vercel does):

```bash
# On VPS: Set up a webhook listener or use a simple git pull cron
# Option 1: Cron job (checks every minute)
crontab -e
# Add: * * * * * cd /var/www/cobol-bridge && git pull origin main && pm2 restart cobol-bridge

# Option 2: GitHub webhook with a small listener (more advanced)
# See: https://github.com/adnanh/webhook
```

---

## Stripe Payment Links Reference

These are the live Stripe checkout links used across the site:

| Tier | Link |
|------|------|
| Basic ($999/mo) | `https://buy.stripe.com/28EfZj1Il5fGf42gpfdMI0A` |
| Professional ($2,499/mo) | `https://buy.stripe.com/28E8wRaeRfUk1dca0RdMI0B` |
| Enterprise ($4,999/mo) | `https://buy.stripe.com/cNi9AV72F7nObRQeh7dMI0C` |
| Banking Sector | `https://buy.stripe.com/7sY14pfzb37yaNM6OFdMI0D` |
| Government Sector | `https://buy.stripe.com/bJeeVf3Qt7nObRQ2ypdMI0E` |
| Healthcare Sector | `https://buy.stripe.com/7sYcN7gDffUkf42eh7dMI0F` |
| Insurance Sector | `https://buy.stripe.com/14A9AVfzbeQg3lk6OFdMI0G` |

---

## Contact

- **Nick Templeman** — Founder, CSGA AI Research Institute
- **Repository:** [github.com/CSGA-GLOBAL/cobol-bridge](https://github.com/CSGA-GLOBAL/cobol-bridge)
- **Live Site:** [cobol-bridge.vercel.app](https://cobol-bridge.vercel.app)
