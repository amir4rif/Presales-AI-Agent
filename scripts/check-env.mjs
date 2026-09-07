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
const provider = process.env.AI_PROVIDER?.trim() === 'anthropic' ? 'anthropic' : 'gemini';
const aiKey = provider === 'gemini' ? 'GEMINI_API_KEY' : 'ANTHROPIC_API_KEY';
const aiMissing = [aiKey].filter((name) => !present(name));
const supabaseMissing = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
].filter((name) => !present(name));
const researchMissing = ['RESEARCH_GEMINI_API_KEY'].filter((name) => !present(name));
const larkMissing = ['LARK_APP_ID', 'LARK_APP_SECRET', 'LARK_APP_TOKEN', 'LARK_TABLE_ID'].filter(
  (name) => !present(name)
);

console.log('Offline integration readiness (values are never printed)');
console.log(`Data source: ${source === 'supabase' ? 'supabase' : 'seed'}`);
line(`AI (${provider})`, aiMissing);
line('Supabase', supabaseMissing);
line('Gemini grounded research (optional, separate key)', researchMissing);
line('Lark archive (inactive)', larkMissing);

if (!process.env.DATA_SOURCE && process.env.NEXT_PUBLIC_DATA_SOURCE) {
  console.warn('Warning: rename NEXT_PUBLIC_DATA_SOURCE to server-only DATA_SOURCE.');
}

if (!['seed', 'supabase'].includes(source)) {
  console.warn(`Warning: DATA_SOURCE=${source} is unsupported and will fall back to seed.`);
}

const activeMissing = source === 'supabase'
  ? [...new Set([...aiMissing, ...supabaseMissing])]
  : [];
const requiredMissing = strict
  ? [...new Set([...aiMissing, ...supabaseMissing])]
  : activeMissing;

const isVercelProduction = process.env.VERCEL === '1' && process.env.VERCEL_ENV === 'production';
if (isVercelProduction && source !== 'supabase') {
  console.error(
    'Readiness check failed. This is a Vercel production build but DATA_SOURCE is not "supabase" ' +
      '(it defaults to seed mode, which skips authentication entirely). ' +
      'Set DATA_SOURCE=supabase and the Supabase env vars in the Vercel project before deploying.'
  );
  process.exitCode = 1;
} else if (requiredMissing.length) {
  console.error(`Readiness check failed. Missing: ${requiredMissing.join(', ')}`);
  process.exitCode = 1;
} else if (strict) {
  console.log('Strict readiness check passed. No network connection was attempted.');
} else {
  console.log('Current-mode readiness check passed. No network connection was attempted.');
}
