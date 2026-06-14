/**
 * Pop a page open, boot the agent in BENCHPRESS_MODE so the full SCM
 * composition is loaded, then dump:
 *   - The per-module token estimate (scm.analyze())
 *   - The assembled system prompt length + first 400 chars per section
 *   - The function-definitions section length
 *
 * Read-only diagnostic. No LLM calls. ~5s wall time.
 */
import { chromium } from '@playwright/test';

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext();
await ctx.addInitScript(() => {
  (window as unknown as { __DISABLE_ONBOARDING__: boolean }).__DISABLE_ONBOARDING__ = true;
  try { localStorage.setItem('appdata::smartchats::__backend_mode__', 'local'); } catch { /* ignore */ }
});
const page = await ctx.newPage();
await page.goto('http://localhost:3000/app', { waitUntil: 'networkidle', timeout: 60_000 });
await page.waitForFunction(() => (window as unknown as { COR?: unknown }).COR !== undefined, null, { timeout: 30_000 });

const dump = await page.evaluate(() => {
  const cor = (window as unknown as { COR: any }).COR;
  // Discover the SCM accessor and what's on it.
  const scm = cor.scm ?? cor.systemContextManager ?? cor._scm;
  if (!scm) {
    return { error: `no scm on COR. keys: ${Object.keys(cor).join(', ')}` };
  }
  const scmKeys = Object.keys(scm).concat(Object.getOwnPropertyNames(Object.getPrototypeOf(scm) ?? {}));
  if (!scm.build) {
    return { error: `scm has no .build(); methods: ${scmKeys.join(', ')}` };
  }
  const built = scm.build();
  // Compute per-module sizes manually if analyze() isn't available.
  const modules = (scm.list_modules ? scm.list_modules() : (scm.modules ?? [])) as any[];
  const modStats = modules.map((m: any) => {
    let chars = 0;
    if (m.system_msg) chars += m.system_msg.length;
    if (m.functions) {
      for (const f of m.functions) {
        chars += JSON.stringify({ description: f.description, name: f.name, parameters: f.parameters, return_type: f.return_type }).length;
      }
    }
    if (m.output_instructions) chars += m.output_instructions.length;
    return { id: m.id, chars, has_system_msg: !!m.system_msg, function_count: m.functions?.length ?? 0 };
  });
  const totalCharsEstimate = modStats.reduce((s, m) => s + m.chars, 0);
  const system_prompt = built.system_prompt;
  const fnIdx = system_prompt.indexOf('AVAILABLE FUNCTIONS');
  const outIdx = system_prompt.indexOf('OUTPUT FORMAT');
  return {
    error: null,
    modStats,
    totalCharsEstimate,
    system_prompt_length: system_prompt.length,
    system_prompt_chars_before_fn: fnIdx >= 0 ? fnIdx : -1,
    fn_section_length: fnIdx >= 0 && outIdx >= 0 ? (outIdx - fnIdx) : -1,
    output_section_length: outIdx >= 0 ? (system_prompt.length - outIdx) : -1,
    function_count: built.functions.length,
    system_msg_head: system_prompt.slice(0, 600),
    fn_section_head: fnIdx >= 0 ? system_prompt.slice(fnIdx, fnIdx + 600) : '',
    output_section_head: outIdx >= 0 ? system_prompt.slice(outIdx, outIdx + 600) : '',
  };
});

if ((dump as any).error) {
  console.error('error:', (dump as any).error);
  await browser.close();
  process.exit(2);
}

console.log('per-module size (chars; ~tokens = chars / 4):');
const sorted = [...(dump as any).modStats].sort((a: any, b: any) => b.chars - a.chars);
const total = (dump as any).totalCharsEstimate;
for (const m of sorted) {
  const pct = ((m.chars / total) * 100).toFixed(1);
  console.log(`  ${m.chars.toString().padStart(7)}  ~${Math.round(m.chars/4).toString().padStart(6)}t  ${pct.padStart(5)}%  ${m.id}  (system_msg=${m.has_system_msg}, fns=${m.function_count})`);
}
console.log(`  ${'─'.repeat(40)}`);
console.log(`  ${total.toString().padStart(7)}  ~${Math.round(total/4)}t total across ${sorted.length} modules`);
console.log();
console.log(`assembled system_prompt:`);
console.log(`  total chars      : ${dump.system_prompt_length.toLocaleString()}`);
console.log(`  ~tokens (÷4)     : ${Math.round(dump.system_prompt_length / 4).toLocaleString()}`);
console.log(`  chars before "AVAILABLE FUNCTIONS" : ${dump.system_prompt_chars_before_fn.toLocaleString()}`);
console.log(`  "AVAILABLE FUNCTIONS" section size : ${dump.fn_section_length.toLocaleString()} chars`);
console.log(`  "OUTPUT FORMAT" section size       : ${dump.output_section_length.toLocaleString()} chars`);
console.log(`  function_count                    : ${dump.function_count}`);
console.log();
// Dump build_messages([]) to expose module-state bloat (trailing system msg)
const second = await page.evaluate(() => {
  const cor = (window as unknown as { COR: any }).COR;
  const scm = cor.scm ?? cor.systemContextManager ?? cor._scm;
  if (!scm?.build_messages) return { error: 'no build_messages' };
  const msgs = scm.build_messages([]);
  // Per-module state sizes
  const modules = (scm.list_modules ? scm.list_modules() : (scm.modules ?? [])) as any[];
  const stateStats = modules
    .filter((m: any) => m.state !== undefined && m.state !== null && m.state !== '')
    .map((m: any) => ({
      id: m.id,
      state_chars: typeof m.state === 'string' ? m.state.length : JSON.stringify(m.state).length,
      state_type: typeof m.state,
    }))
    .sort((a: any, b: any) => b.state_chars - a.state_chars);
  return {
    error: null,
    msg_count: msgs.length,
    msg_sizes: msgs.map((m: any) => ({ role: m.role, chars: (m.content ?? '').length })),
    total_chars: msgs.reduce((s: number, m: any) => s + (m.content?.length ?? 0), 0),
    stateStats,
    state_msg_head: msgs.length > 1 ? (msgs[msgs.length - 1].content ?? '').slice(0, 1500) : '',
  };
});

console.log('\nbuild_messages([]) (empty conversation, post-boot):');
if ((second as any).error) {
  console.log(' ', (second as any).error);
} else {
  const s = second as any;
  console.log(`  message count: ${s.msg_count}`);
  for (const m of s.msg_sizes) {
    console.log(`    ${m.role.padEnd(10)} ${m.chars.toLocaleString().padStart(8)} chars  (~${Math.round(m.chars/4).toLocaleString()} tokens)`);
  }
  console.log(`    total      ${s.total_chars.toLocaleString().padStart(8)} chars  (~${Math.round(s.total_chars/4).toLocaleString()} tokens)`);
  console.log('\nper-module STATE size (the trailing-system-message bloat):');
  for (const m of s.stateStats) {
    console.log(`  ${m.state_chars.toString().padStart(7)} chars  ~${Math.round(m.state_chars/4).toString().padStart(6)}t   ${m.id}  (type=${m.state_type})`);
  }
  if (s.state_msg_head) {
    console.log('\n--- trailing state message head (1500 chars) ---');
    console.log(s.state_msg_head);
  }
}

// Show what each background loader injects.
const loaderDump = await page.evaluate(async () => {
  const w = window as any;
  const sl = w.getStartupLoaders ? w.getStartupLoaders() : undefined;
  if (!sl) return { error: `no getStartupLoaders on window. relevant keys: ${Object.keys(w).filter(k => /loader|smart/i.test(k)).join(', ')}` };
  const ids = Object.keys(sl);
  const out: Array<{ id: string; bytes: number; sample: string }> = [];
  for (const id of ids) {
    try {
      const v = await sl[id].get();
      const s = JSON.stringify(v);
      out.push({ id, bytes: s.length, sample: s.slice(0, 300) });
    } catch (e: any) {
      out.push({ id, bytes: -1, sample: `error: ${e.message}` });
    }
  }
  return { loaders: out };
});

console.log('\nbackground_loaders.get() output sizes:');
if ((loaderDump as any).error) console.log(' ', (loaderDump as any).error);
else {
  for (const l of (loaderDump as any).loaders) {
    console.log(`  ${l.bytes.toString().padStart(8)} bytes  ~${Math.round(l.bytes/4).toString().padStart(6)}t   ${l.id}`);
  }
  console.log('\n--- sample of each loader value ---');
  for (const l of (loaderDump as any).loaders) {
    console.log(`[${l.id}] ${l.sample}${l.sample.length>=300?'…':''}`);
    console.log();
  }
}

await browser.close();
