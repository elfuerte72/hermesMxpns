import { spawnSync } from 'node:child_process';
import {
  POST_INSTALL_MAX_BYTES,
  generatePostInstallScript,
  type PostInstallScriptParams,
} from './script-generator';

const PARAMS: PostInstallScriptParams = {
  backendUrl: 'https://api.hermes.example.com',
  deployId: 'ckdeploy123',
  bootstrapToken: 'a'.repeat(64),
};

describe('generatePostInstallScript', () => {
  it('is a bash script that logs to /post_install.log', () => {
    const script = generatePostInstallScript(PARAMS);
    expect(script.startsWith('#!/usr/bin/env bash')).toBe(true);
    expect(script).toContain('set -euo pipefail');
    expect(script).toContain('/post_install.log');
  });

  it('embeds the one-time bootstrap pull URL and the deploy-ready webhook', () => {
    const script = generatePostInstallScript(PARAMS);
    expect(script).toContain('/bootstrap/${DEPLOY_ID}?token=${BOOTSTRAP_TOKEN}');
    expect(script).toContain('BACKEND_URL=\'https://api.hermes.example.com\'');
    expect(script).toContain('DEPLOY_ID=\'ckdeploy123\'');
    expect(script).toContain(`BOOTSTRAP_TOKEN='${'a'.repeat(64)}'`);
    expect(script).toContain('/webhooks/deploy-ready');
    expect(script).toContain('docker compose up -d');
  });

  it('never contains a bot token or LLM key — only the bootstrap token', () => {
    // Even if a caller mistakenly had secrets nearby, the generator takes none.
    const script = generatePostInstallScript(PARAMS);
    expect(script).not.toContain('TELEGRAM_BOT_TOKEN');
    expect(script).not.toContain('_API_KEY');
    // Secrets are pulled at runtime into files, not baked in.
    expect(script).toContain('jq -er \'.env\'');
    expect(script).toContain('jq -er \'.config_yaml\'');
    expect(script).toContain('jq -er \'.compose\'');
  });

  it('strips a trailing slash from the backend URL', () => {
    const script = generatePostInstallScript({ ...PARAMS, backendUrl: 'https://api.example.com/' });
    expect(script).toContain("BACKEND_URL='https://api.example.com'");
  });

  it('honours a custom hermes dir', () => {
    const script = generatePostInstallScript({ ...PARAMS, hermesDir: '/opt/hermes' });
    expect(script).toContain("HERMES_DIR='/opt/hermes'");
  });

  it('safely single-quote-escapes injected values', () => {
    const script = generatePostInstallScript({ ...PARAMS, deployId: "evil'; rm -rf /; '" });
    // The single quote is escaped as '\'' so the shell string stays intact.
    expect(script).toContain("DEPLOY_ID='evil'\\''; rm -rf /; '\\'''");
    // The adversarial value must not break bash parsing (stays one literal token).
    const res = spawnSync('bash', ['-n'], { input: script, encoding: 'utf8' });
    expect(res.status).toBe(0);
  });

  it('stays within the 48KB Hostinger limit', () => {
    const script = generatePostInstallScript(PARAMS);
    expect(Buffer.byteLength(script, 'utf8')).toBeLessThanOrEqual(POST_INSTALL_MAX_BYTES);
  });

  it('produces syntactically valid bash (bash -n)', () => {
    const script = generatePostInstallScript(PARAMS);
    const res = spawnSync('bash', ['-n'], { input: script, encoding: 'utf8' });
    expect(res.status).toBe(0);
  });
});
