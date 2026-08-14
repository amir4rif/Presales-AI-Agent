import nextEnv from '@next/env';

const { loadEnvConfig } = nextEnv;

loadEnvConfig(process.cwd());

const strict = process.argv.includes('--strict');
const placeholder = /^(?:paste|replace|your|todo|changeme|example|<|\{)/i;

function present(name) {
  const value = process.env[name]?.trim();
  return Boolean(value && !placeholder.test(value));
}

function line(label, missing) {
  const state = missing.length ? `pending (${missing.join(', ')})` : 'ready';
  console.log(`${label}: ${state}`);
}

const source = process.env.DATA_SOURCE?.trim() || process.env.NEXT_PUBLIC_DATA_SOURCE?.trim() || 'seed';
const aiMissing = ['ANTHROPIC_API_KEY'].filter((name) => !present(name));
const larkMissing = ['LARK_APP_ID', 'LARK_APP_SECRET', 'LARK_APP_TOKEN', 'LARK_TABLE_ID'].filter(
  (name) => !present(name)
);

console.log('Offline integration readiness (values are never printed)');
console.log(`Data source: ${source === 'lark' ? 'lark' : 'seed'}`);
line('Anthropic', aiMissing);
line('Lark Base', larkMissing);

if (!process.env.DATA_SOURCE && process.env.NEXT_PUBLIC_DATA_SOURCE) {
  console.warn('Warning: rename NEXT_PUBLIC_DATA_SOURCE to server-only DATA_SOURCE.');
}

const activeMissing = source === 'lark' ? larkMissing : [];
const requiredMissing = strict ? [...new Set([...aiMissing, ...larkMissing])] : activeMissing;

if (requiredMissing.length) {
  console.error(`Readiness check failed. Missing: ${requiredMissing.join(', ')}`);
  process.exitCode = 1;
} else if (strict) {
  console.log('Strict readiness check passed. No network connection was attempted.');
} else {
  console.log('Current-mode readiness check passed. No network connection was attempted.');
}
