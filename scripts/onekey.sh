#!/usr/bin/env bash
set -Eeuo pipefail

APP_NAME="${APP_NAME:-chatgpt-session-forge}"
REPO_URL="${REPO_URL:-}"
BRANCH="${BRANCH:-master}"
if [ -z "${INSTALL_DIR:-}" ]; then
  if [ "$(id -u)" -eq 0 ]; then
    INSTALL_DIR="/opt/${APP_NAME}"
  else
    INSTALL_DIR="${HOME}/${APP_NAME}"
  fi
fi
PORT="${PORT:-3000}"
SETUP_NGINX="${SETUP_NGINX:-1}"
DOMAIN="${DOMAIN:-_}"
ENABLE_BASIC_AUTH="${ENABLE_BASIC_AUTH:-1}"
BASIC_AUTH_USER="${BASIC_AUTH_USER:-admin}"
BASIC_AUTH_PASS="${BASIC_AUTH_PASS:-}"

log() {
  printf '\n\033[1;36m==>\033[0m %s\n' "$*"
}

die() {
  printf '\n\033[1;31mERROR:\033[0m %s\n' "$*" >&2
  exit 1
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1
}

as_root() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
  elif need_cmd sudo; then
    sudo "$@"
  else
    die "This command needs root permission. Please run as root or install sudo."
  fi
}

detect_apt() {
  need_cmd apt-get || die "This script currently supports Debian/Ubuntu servers with apt-get."
}

install_base_packages() {
  detect_apt
  log "Installing base packages"
  as_root apt-get update
  as_root apt-get install -y ca-certificates curl git openssl
}

node_major() {
  if ! need_cmd node; then
    echo 0
    return
  fi
  node -v | sed -E 's/^v([0-9]+).*/\1/'
}

install_node_if_needed() {
  local major
  major="$(node_major)"
  if [ "${major:-0}" -ge 20 ]; then
    log "Node.js $(node -v) is ready"
    return
  fi

  log "Installing Node.js 20"
  curl -fsSL https://deb.nodesource.com/setup_20.x | as_root bash -
  as_root apt-get install -y nodejs
}

install_pm2_if_needed() {
  if need_cmd pm2; then
    log "PM2 is ready"
    return
  fi

  log "Installing PM2"
  as_root npm install -g pm2
}

clone_or_update_repo() {
  log "Preparing app directory: ${INSTALL_DIR}"
  as_root mkdir -p "$(dirname "$INSTALL_DIR")"

  if [ -d "$INSTALL_DIR/.git" ]; then
    log "Existing install found, upgrading from git"
    git -C "$INSTALL_DIR" fetch origin "$BRANCH"
    git -C "$INSTALL_DIR" checkout "$BRANCH"
    git -C "$INSTALL_DIR" pull --ff-only origin "$BRANCH"
  elif [ -e "$INSTALL_DIR" ] && [ "$(find "$INSTALL_DIR" -mindepth 1 -maxdepth 1 2>/dev/null | wc -l)" -gt 0 ]; then
    die "${INSTALL_DIR} exists but is not a git checkout. Move it away or set INSTALL_DIR."
  else
    [ -n "$REPO_URL" ] || die "Please set REPO_URL, for example: REPO_URL=https://github.com/your-user/your-repo.git"
    log "Cloning ${REPO_URL}"
    git clone --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
  fi
}

ensure_runtime_data() {
  log "Ensuring runtime data files"
  mkdir -p "$INSTALL_DIR/data" "$INSTALL_DIR/logs"
  if [ ! -f "$INSTALL_DIR/data/accounts.json" ]; then
    printf '[]\n' > "$INSTALL_DIR/data/accounts.json"
  fi

  if [ -s "$INSTALL_DIR/data/accounts.json" ]; then
    local backup_dir backup_file
    backup_dir="$INSTALL_DIR/data/backups"
    backup_file="$backup_dir/accounts-$(date +%Y%m%d-%H%M%S).json"
    mkdir -p "$backup_dir"
    cp "$INSTALL_DIR/data/accounts.json" "$backup_file"
    log "Backed up accounts.json to ${backup_file}"
  fi
}

install_dependencies() {
  log "Installing npm dependencies"
  cd "$INSTALL_DIR"
  if [ -f package-lock.json ]; then
    npm ci --omit=dev
  else
    npm install --omit=dev
  fi
}

start_or_restart_pm2() {
  log "Starting app with PM2 on port ${PORT}"
  cd "$INSTALL_DIR"

  if pm2 describe "$APP_NAME" >/dev/null 2>&1; then
    PORT="$PORT" pm2 restart "$APP_NAME" --update-env
  else
    PORT="$PORT" pm2 start server.js --name "$APP_NAME"
  fi

  pm2 save

  if need_cmd systemctl; then
    as_root env PATH="$PATH" pm2 startup systemd -u "$(whoami)" --hp "$HOME" >/tmp/${APP_NAME}-pm2-startup.log 2>&1 || true
  fi
}

write_nginx_config() {
  [ "$SETUP_NGINX" = "1" ] || return 0

  log "Configuring Nginx reverse proxy"
  as_root apt-get install -y nginx apache2-utils

  local auth_lines auth_file auth_changed
  auth_lines=""
  auth_changed=0
  if [ "$ENABLE_BASIC_AUTH" = "1" ]; then
    auth_file="/etc/nginx/.htpasswd-${APP_NAME}"
    if [ -z "$BASIC_AUTH_PASS" ]; then
      if [ -f "$auth_file" ]; then
        BASIC_AUTH_PASS=""
      else
        BASIC_AUTH_PASS="$(openssl rand -base64 18 | tr -d '\n')"
        auth_changed=1
      fi
    else
      auth_changed=1
    fi

    if [ "$auth_changed" = "1" ]; then
      as_root htpasswd -bc "$auth_file" "$BASIC_AUTH_USER" "$BASIC_AUTH_PASS" >/dev/null
    fi
    auth_lines="        auth_basic \"${APP_NAME}\";
        auth_basic_user_file ${auth_file};"
  fi

  local tmp_conf
  tmp_conf="$(mktemp)"
  cat > "$tmp_conf" <<EOF
server {
    listen 80 default_server;
    server_name ${DOMAIN};

    client_max_body_size 20m;

    location / {
${auth_lines}
        proxy_pass http://127.0.0.1:${PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_buffering off;
        proxy_read_timeout 3600s;
    }
}
EOF

  as_root mv "$tmp_conf" "/etc/nginx/sites-available/${APP_NAME}"
  as_root ln -sf "/etc/nginx/sites-available/${APP_NAME}" "/etc/nginx/sites-enabled/${APP_NAME}"
  if [ -L /etc/nginx/sites-enabled/default ]; then
    as_root rm -f /etc/nginx/sites-enabled/default
  fi

  as_root nginx -t
  as_root systemctl enable nginx >/dev/null 2>&1 || true
  as_root systemctl reload nginx || as_root systemctl restart nginx

  if need_cmd ufw && as_root ufw status | grep -qi '^Status: active'; then
    as_root ufw allow 80/tcp >/dev/null || true
  fi

  if [ "$ENABLE_BASIC_AUTH" = "1" ] && [ "$auth_changed" = "1" ]; then
    log "Nginx Basic Auth enabled"
    printf 'User: %s\nPassword: %s\n' "$BASIC_AUTH_USER" "$BASIC_AUTH_PASS"
  elif [ "$ENABLE_BASIC_AUTH" = "1" ]; then
    log "Nginx Basic Auth enabled, existing password kept"
  fi
}

print_result() {
  local public_url
  if [ "$SETUP_NGINX" = "1" ]; then
    public_url="http://${DOMAIN}"
    if [ "$DOMAIN" = "_" ]; then
      public_url="http://YOUR_SERVER_IP"
    fi
  else
    public_url="http://YOUR_SERVER_IP:${PORT}"
  fi

  cat <<EOF

Done.

App directory: ${INSTALL_DIR}
PM2 app name: ${APP_NAME}
Local URL: http://127.0.0.1:${PORT}
Public URL: ${public_url}

Common commands:
  pm2 logs ${APP_NAME}
  pm2 restart ${APP_NAME}
  pm2 stop ${APP_NAME}

Run this same script again to upgrade.
EOF
}

main() {
  install_base_packages
  install_node_if_needed
  install_pm2_if_needed
  clone_or_update_repo
  ensure_runtime_data
  install_dependencies
  start_or_restart_pm2
  write_nginx_config
  print_result
}

main "$@"
