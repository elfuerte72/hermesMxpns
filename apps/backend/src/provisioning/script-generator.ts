export interface PostInstallScriptParams {
  /** Publicly reachable backend base URL (https), no trailing slash. */
  backendUrl: string;
  /** Deploy id — path segment of the bootstrap + webhook URLs. */
  deployId: string;
  /** One-time bootstrap token (plaintext). Safe to embed: IP-checked + burns
   * after first use, and grants only the pull endpoint — no real secrets. */
  bootstrapToken: string;
  /** Where Hermes config/data live on the VPS. Defaults to /root/.hermes. */
  hermesDir?: string;
}

const DEFAULT_HERMES_DIR = '/root/.hermes';

/** Wrap a value in single quotes, safely escaping embedded single quotes. */
function sq(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Generate the Hostinger post-install script (`/post_install`, run once as root
 * after VM install). It contains NO secrets — only the one-time bootstrap URL.
 * The script pulls the rendered Hermes files, writes them, brings Hermes up via
 * Docker (template 1121 ships Docker), and reports back to the backend.
 */
export function generatePostInstallScript(params: PostInstallScriptParams): string {
  const { backendUrl, deployId, bootstrapToken } = params;
  const hermesDir = params.hermesDir ?? DEFAULT_HERMES_DIR;
  const base = backendUrl.replace(/\/+$/, '');

  return `#!/usr/bin/env bash
# Hermes deployer post-install script. Contains NO secrets — pulls them once
# from the backend over a one-time, IP-checked bootstrap token.
set -euo pipefail

LOG=/post_install.log
exec >>"$LOG" 2>&1
echo "[hermes] $(date -u +%FT%TZ) post-install starting"

BACKEND_URL=${sq(base)}
DEPLOY_ID=${sq(deployId)}
BOOTSTRAP_TOKEN=${sq(bootstrapToken)}
HERMES_DIR=${sq(hermesDir)}

# jq parses the bootstrap payload; install it if the image lacks it.
if ! command -v jq >/dev/null 2>&1; then
  echo "[hermes] installing jq"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y
  apt-get install -y jq
fi

install -d -m 700 "$HERMES_DIR"

echo "[hermes] pulling bootstrap payload"
PAYLOAD="$(curl -fsSL --retry 5 --retry-delay 5 --retry-connrefused \\
  "\${BACKEND_URL}/bootstrap/\${DEPLOY_ID}?token=\${BOOTSTRAP_TOKEN}")"

# Write the rendered files; secrets flow payload -> disk, never via this script.
umask 077
jq -er '.env'         <<<"$PAYLOAD" > "\${HERMES_DIR}/.env"
jq -er '.config_yaml' <<<"$PAYLOAD" > "\${HERMES_DIR}/config.yaml"
jq -er '.compose'     <<<"$PAYLOAD" > "\${HERMES_DIR}/docker-compose.yml"
WEBHOOK_SECRET="$(jq -er '.webhook_secret' <<<"$PAYLOAD")"

echo "[hermes] starting containers"
cd "$HERMES_DIR"
docker compose up -d

echo "[hermes] notifying backend that the deploy is ready"
curl -fsSL --retry 5 --retry-delay 5 -X POST \\
  -H 'Content-Type: application/json' \\
  -H "Authorization: Bearer \${WEBHOOK_SECRET}" \\
  -d "{\\"deploy_id\\":\\"\${DEPLOY_ID}\\"}" \\
  "\${BACKEND_URL}/webhooks/deploy-ready"

echo "[hermes] $(date -u +%FT%TZ) post-install done"
`;
}

/** Hostinger caps post-install scripts at 48 KB. */
export const POST_INSTALL_MAX_BYTES = 48 * 1024;
