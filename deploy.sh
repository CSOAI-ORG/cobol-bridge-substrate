#!/bin/bash
# ──────────────────────────────────────────────
# COBOL Bridge — Cobalt VPS Deployment Script
# CSGA AI Research Institute
# ──────────────────────────────────────────────
# Run as root or with sudo on your Cobalt VPS:
#   chmod +x deploy.sh && sudo ./deploy.sh
# ──────────────────────────────────────────────

set -e

APP_DIR="/var/www/cobol-bridge"
APP_NAME="cobol-bridge"
DOMAIN="cobolbridge.ai"
PORT=3000

echo ""
echo "  COBOL Bridge — VPS Deployment"
echo "  ─────────────────────────────"
echo ""

# ── Step 1: System packages ──
echo "[1/7] Installing system packages..."
apt-get update -qq
apt-get install -y -qq nginx certbot python3-certbot-nginx git curl

# ── Step 2: Node.js 18 LTS ──
if ! command -v node &> /dev/null || [[ $(node -v | cut -d. -f1 | tr -d 'v') -lt 18 ]]; then
  echo "[2/7] Installing Node.js 18 LTS..."
  curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
  apt-get install -y -qq nodejs
else
  echo "[2/7] Node.js $(node -v) already installed"
fi

# ── Step 3: PM2 ──
if ! command -v pm2 &> /dev/null; then
  echo "[3/7] Installing PM2..."
  npm install -g pm2
else
  echo "[3/7] PM2 already installed"
fi

# ── Step 4: Clone or pull the repo ──
if [ -d "$APP_DIR" ]; then
  echo "[4/7] Pulling latest from GitHub..."
  cd "$APP_DIR"
  git pull origin main
else
  echo "[4/7] Cloning from GitHub..."
  git clone https://github.com/CSGA-GLOBAL/cobol-bridge.git "$APP_DIR"
  cd "$APP_DIR"
fi

# ── Step 5: Install dependencies and start ──
echo "[5/7] Installing dependencies..."
npm install --production

echo "[5/7] Starting with PM2..."
pm2 delete "$APP_NAME" 2>/dev/null || true
NODE_ENV=production pm2 start server.js --name "$APP_NAME" --max-memory-restart 256M
pm2 save
pm2 startup systemd -u root --hp /root 2>/dev/null || true

# ── Step 6: Nginx config ──
echo "[6/7] Configuring Nginx..."
cat > /etc/nginx/sites-available/$DOMAIN << 'NGINX'
server {
    listen 80;
    server_name cobolbridge.ai www.cobolbridge.ai;

    # Security headers
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

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

        # Timeouts
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
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
        proxy_read_timeout 86400s;
    }

    # Block dotfiles
    location ~ /\. {
        deny all;
        return 404;
    }
}
NGINX

# Enable site
ln -sf /etc/nginx/sites-available/$DOMAIN /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true
nginx -t && systemctl reload nginx

# ── Step 7: Health check ──
echo "[7/7] Running health check..."
sleep 2
HEALTH=$(curl -s http://localhost:$PORT/health)
echo ""
echo "  Health check response:"
echo "  $HEALTH"
echo ""

echo "  ✓ COBOL Bridge deployed successfully!"
echo ""
echo "  Next steps:"
echo "  1. Point DNS: In Namecheap, set A records for"
echo "     cobolbridge.ai and www.cobolbridge.ai to this VPS IP"
echo ""
echo "  2. Get SSL (after DNS propagates):"
echo "     sudo certbot --nginx -d cobolbridge.ai -d www.cobolbridge.ai"
echo ""
echo "  3. Test: curl http://localhost:$PORT/health"
echo "  4. Test: curl http://localhost:$PORT/mcp/sse (SSE stream)"
echo ""
echo "  Useful commands:"
echo "  pm2 logs $APP_NAME     — View logs"
echo "  pm2 restart $APP_NAME  — Restart server"
echo "  pm2 monit              — Live monitoring"
echo ""
