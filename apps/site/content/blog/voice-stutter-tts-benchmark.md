# We Tracked a Voice-Agent Stutter to OpenAI. Then We Benchmarked 7 TTS Providers.

> **TL;DR.** Our voice agent at [SmartChats](https://smartchats.ai) was stuttering mid-utterance. We thought we'd fixed it three weeks ago. We hadn't. Building per-utterance telemetry let us isolate the cause down to a single timing pattern in OpenAI's `gpt-4o-mini-tts` — and a falsifiable test (Pearson r = 0.878 across 50 production utterances) proved the gap was upstream of our server, not in our network. So we built a 7-provider benchmark harness, ran 105 trials, and ranked them. Azure wins by a wide margin. OpenAI is genuinely the worst of the seven.
>
> Both tools are open source. Skip to [the benchmark](#5-what-105-trials-told-us) if you just want the data.

## Hear it first

Same sentence — "Hello, this is a test." — captured from two providers, then reconstructed the way the listener would actually have heard them. (The "realistic" track inserts silence wherever the player's buffer would have run out waiting for the next chunk to arrive. Not a synthetic effect — it's what your user heard.)

<div style="margin: 20px 0; padding: 18px 22px; border-radius: 8px; background: var(--blog-card-bad-bg); border: 1px solid var(--blog-card-border); border-left: 4px solid var(--blog-card-label-bad); box-shadow: var(--blog-card-shadow)">
<div style="display: flex; justify-content: space-between; margin-bottom: 10px; align-items: baseline"><strong style="color: var(--blog-card-label-bad); font-size: 15px">OpenAI · gpt-4o-mini-tts</strong><span style="font-size: 11px; color: var(--blog-card-meta); font-family: ui-monospace, monospace">561ms stutter</span></div>
<audio controls preload="metadata" style="width:100%" src="/blog/voice-stutter/openai_short_realistic.wav"></audio>
<div style="margin-top: 8px; font-size: 12px; color: var(--blog-callout-text); font-style: italic">You'll hear "Hello", then ~half a second of silence, then "this is a test" resume.</div>
</div>

<div style="margin: 20px 0; padding: 18px 22px; border-radius: 8px; background: var(--blog-card-good-bg); border: 1px solid var(--blog-card-border); border-left: 4px solid var(--blog-card-label-good); box-shadow: var(--blog-card-shadow)">
<div style="display: flex; justify-content: space-between; margin-bottom: 10px; align-items: baseline"><strong style="color: var(--blog-card-label-good); font-size: 15px">Azure · en-US-AvaMultilingualNeural</strong><span style="font-size: 11px; color: var(--blog-card-meta); font-family: ui-monospace, monospace">no stutter</span></div>
<audio controls preload="metadata" style="width:100%" src="/blog/voice-stutter/azure_short_realistic.wav"></audio>
<div style="margin-top: 8px; font-size: 12px; color: var(--blog-callout-text); font-style: italic">Same sentence, same player. No gap to insert — audio flows straight through.</div>
</div>

The rest of this post is how we tracked that gap down, what the telemetry data looks like, and what 105 trials told us about the other five providers. Full A/B for all four providers (clean + realistic) is at the [bottom](#8-what-we-skipped-and-whats-next).

---

## 1. The Stutter Is Back

A real bug, reported by a real user: voice replies sometimes had an audible silence inside them. Not at the start — mid-utterance. Like the agent was thinking partway through its own sentence.

We were surprised because we'd already shipped a fix for this kind of thing on 2026-05-28. That fix lives in `packages/tivi/src/lib/tts_queue.ts` and is the smallest possible change — bumping a single constant called `DEFAULT_SNAP_LOOKAHEAD_S` from 0.15 seconds to 0.333 (commit `81bca1c`). For four weeks, no complaints. Then suddenly: complaints.

A bit of background on what that constant does. Our voice playback layer (built on Web Audio) receives PCM chunks from the TTS provider as they're generated, and schedules each chunk to play immediately after the previous one ends. If chunk N+1 hasn't arrived yet when chunk N is about to finish, the scheduler "snaps" — it artificially extends chunk N's playback by up to `snap_lookahead_ms` to give chunk N+1 more time to arrive. The bump from 150ms → 333ms gave the snap a bigger budget. We thought this had ended the audible-stutter class of bugs forever.

So when reports came back, we didn't immediately reach for "OpenAI changed something." We reached for "did we regress somewhere?" The answer turned out to be neither. The bug had been there the whole time, in a slightly different shape, and our existing telemetry wasn't sharp enough to see it.

This post is how we made the telemetry sharper, what we found, and how we then benchmarked seven different TTS providers to figure out where to move next.

## 2. The Telemetry Stack That Made It Visible

Every utterance the agent speaks fires a `tts_playback_timing` insights event when playback completes. The relevant slice of the payload looks like this:

```json
{
  "utterance_id": "utt_mqg1ew6dzvp52",
  "snap_lookahead_ms": 333,
  "stream_duration_ms": 10327,
  "total_chunks": 19,
  "chunks": [
    { "arrival_ms": 2485, "duration_ms": 144, "snapped_forward": true,  "schedule_slack_ms": 333 },
    { "arrival_ms": 10324, "duration_ms": 141, "snapped_forward": true,  "schedule_slack_ms": 333 },
    { "arrival_ms": 10324, "duration_ms": 143, "snapped_forward": false, "schedule_slack_ms": 472 },
    { "arrival_ms": 10324, "duration_ms": 142, "snapped_forward": false, "schedule_slack_ms": 615 },
    ...
  ]
}
```

When we first looked at production data, our analyzer rolled this up into a single metric per session: the total `snap_forward_count`. The thinking was: a high snap count means the player was struggling. After the 2026-05-28 bump, snap counts dropped dramatically. We called it done.

But snap-count is the wrong metric. The snap is the fix, not the symptom. A snapping chunk is one the scheduler successfully *rescued*. What we actually care about is whether the rescue succeeded — and how big the *gap* was that needed rescuing. Counting rescues without measuring the gaps they tried to absorb is like counting how often your airbag deployed without measuring how fast the cars were going. A successful airbag rescue doesn't mean the crash wasn't bad.

This was the broader mistake we'd been making for weeks before this bug came back: treating *the act of the scheduler intervening* as the proxy for *user-experienced quality*. They're not the same thing. A scheduler that snaps every chunk could be hiding catastrophic underlying gaps; a scheduler that never snaps could be doing nothing at all. The only metric that actually tracks user experience is whether the audio reaches the player early enough to play continuously, and snap-count tells you neither side of that.

So we wrote a new analyzer in `packages/smartchats-sessions/src/analysis_db/tts_timing.ts` that derives the real metric: **the gap between chunk 0 finishing and chunk 1 arriving**, computed per utterance as `chunks[1].arrival_ms - chunks[0].arrival_ms - chunks[0].duration_ms`. We named the verb `sm audit tts-timing` and started running it against our cloud database.

The first chart we built was a histogram of those gaps across 50 utterances from the last seven days of production:

<p align="center">
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 760 370" font-family="system-ui, -apple-system, sans-serif">
<rect width="760" height="370" fill="white"/>
<text x="380.0" y="26" text-anchor="middle" font-size="17" font-weight="600" fill="#222">Chunk-0→1 gap distribution (50 prod utterances, 7 days)</text>
<g transform="translate(0,40)">
<line x1="60" y1="250" x2="60" y2="20" stroke="#222" stroke-width="1"/>
<line x1="56" y1="250.0" x2="60" y2="250.0" stroke="#222" stroke-width="1"/>
<line x1="60" y1="250.0" x2="70" y2="250.0" stroke="#e5e7eb" stroke-width="1" stroke-dasharray="2,3"/>
<text x="52" y="254.0" text-anchor="end" font-size="11" fill="#6b7280">0</text>
<line x1="56" y1="204.0" x2="60" y2="204.0" stroke="#222" stroke-width="1"/>
<line x1="60" y1="204.0" x2="70" y2="204.0" stroke="#e5e7eb" stroke-width="1" stroke-dasharray="2,3"/>
<text x="52" y="208.0" text-anchor="end" font-size="11" fill="#6b7280">3</text>
<line x1="56" y1="158.0" x2="60" y2="158.0" stroke="#222" stroke-width="1"/>
<line x1="60" y1="158.0" x2="70" y2="158.0" stroke="#e5e7eb" stroke-width="1" stroke-dasharray="2,3"/>
<text x="52" y="162.0" text-anchor="end" font-size="11" fill="#6b7280">6</text>
<line x1="56" y1="112.0" x2="60" y2="112.0" stroke="#222" stroke-width="1"/>
<line x1="60" y1="112.0" x2="70" y2="112.0" stroke="#e5e7eb" stroke-width="1" stroke-dasharray="2,3"/>
<text x="52" y="116.0" text-anchor="end" font-size="11" fill="#6b7280">9</text>
<line x1="56" y1="66.0" x2="60" y2="66.0" stroke="#222" stroke-width="1"/>
<line x1="60" y1="66.0" x2="70" y2="66.0" stroke="#e5e7eb" stroke-width="1" stroke-dasharray="2,3"/>
<text x="52" y="70.0" text-anchor="end" font-size="11" fill="#6b7280">12</text>
<line x1="56" y1="20.0" x2="60" y2="20.0" stroke="#222" stroke-width="1"/>
<line x1="60" y1="20.0" x2="70" y2="20.0" stroke="#e5e7eb" stroke-width="1" stroke-dasharray="2,3"/>
<text x="52" y="24.0" text-anchor="end" font-size="11" fill="#6b7280">15</text>
<text x="20" y="135.0" transform="rotate(-90 20 135.0)" text-anchor="middle" font-size="12" fill="#222"># utterances</text>
<line x1="60" y1="250" x2="730" y2="250" stroke="#222" stroke-width="1"/>
<line x1="60.0" y1="250" x2="60.0" y2="254" stroke="#222" stroke-width="1"/>
<text x="60.0" y="268" text-anchor="middle" font-size="11" fill="#6b7280">0</text>
<line x1="171.66666666666669" y1="250" x2="171.66666666666669" y2="254" stroke="#222" stroke-width="1"/>
<text x="171.66666666666669" y="268" text-anchor="middle" font-size="11" fill="#6b7280">200</text>
<line x1="283.33333333333337" y1="250" x2="283.33333333333337" y2="254" stroke="#222" stroke-width="1"/>
<text x="283.33333333333337" y="268" text-anchor="middle" font-size="11" fill="#6b7280">400</text>
<line x1="395.0" y1="250" x2="395.0" y2="254" stroke="#222" stroke-width="1"/>
<text x="395.0" y="268" text-anchor="middle" font-size="11" fill="#6b7280">600</text>
<line x1="506.6666666666667" y1="250" x2="506.6666666666667" y2="254" stroke="#222" stroke-width="1"/>
<text x="506.6666666666667" y="268" text-anchor="middle" font-size="11" fill="#6b7280">800</text>
<line x1="618.3333333333334" y1="250" x2="618.3333333333334" y2="254" stroke="#222" stroke-width="1"/>
<text x="618.3333333333334" y="268" text-anchor="middle" font-size="11" fill="#6b7280">1000</text>
<line x1="730.0" y1="250" x2="730.0" y2="254" stroke="#222" stroke-width="1"/>
<text x="730.0" y="268" text-anchor="middle" font-size="11" fill="#6b7280">1200</text>
<text x="395.0" y="288" text-anchor="middle" font-size="12" fill="#222">chunk-0→1 gap (ms)</text>
<line x1="245.925" y1="20" x2="245.925" y2="250" stroke="#dc2626" stroke-width="2" stroke-dasharray="6,4" opacity="0.6"/>
<text x="251.925" y="34" font-size="11" fill="#dc2626" font-weight="600">snap budget (333ms)</text>
<text x="251.925" y="48" font-size="10" fill="#dc2626">↑ stutter audible past here</text>
<rect x="356.8" y="81.3" width="22.8" height="168.7" fill="#dc2626" opacity="0.8"/>
<rect x="383.6" y="81.3" width="22.8" height="168.7" fill="#dc2626" opacity="0.8"/>
<rect x="410.4" y="96.7" width="22.8" height="153.3" fill="#dc2626" opacity="0.8"/>
<rect x="437.2" y="142.7" width="22.8" height="107.3" fill="#dc2626" opacity="0.8"/>
<rect x="464.0" y="204.0" width="22.8" height="46.0" fill="#dc2626" opacity="0.8"/>
<rect x="490.8" y="188.7" width="22.8" height="61.3" fill="#dc2626" opacity="0.8"/>
<rect x="544.4" y="219.3" width="22.8" height="30.7" fill="#dc2626" opacity="0.8"/>
<rect x="571.2" y="234.7" width="22.8" height="15.3" fill="#dc2626" opacity="0.8"/>
<rect x="678.4" y="234.7" width="22.8" height="15.3" fill="#dc2626" opacity="0.8"/>
<text x="730" y="34" text-anchor="end" font-size="11" fill="#222">n = 50 utterances · 50 (100%) past snap budget</text>
</g>
<text x="380.0" y="360" text-anchor="middle" font-size="12" fill="#6b7280" font-style="italic">Anything past 333ms (dashed line) exceeds the player's ability to hide the silence — users hear stutter.</text>
</svg>
</p>

The dashed red line at 333ms is the snap budget — the maximum silence the player can hide. Anything past that is audible to the user. **More than half the production utterances had chunk-0→1 gaps exceeding the snap budget.** The bump from 0.15s to 0.333s had hidden the easy cases; the hard cases were still leaking through, and that's what users were hearing.

The other detail from the production data: the gap pattern was *intrinsic to the chunk-0 to chunk-1 transition specifically*. Gaps between chunks 2 and 3, or 5 and 6, or 10 and 11, were almost always negligible — single-digit milliseconds. The first inter-chunk transition was where every single problem lived. That's a structural clue. If the gaps were uniformly distributed across the stream we'd suspect our scheduling or our network. They weren't. They were concentrated at exactly one position.

We had the symptom localized. Now we needed to find the cause.

## 3. Is It Us or Them?

A 500ms gap between chunk 0 and chunk 1 can land anywhere in the pipeline:

- **OpenAI side**: they generate the first batch of audio, send it, then have to generate the next batch and there's a quiet period
- **Our server side**: bytes arrive from OpenAI fine, but our Cloud Function writes them with backpressure or proxy buffering
- **Network**: byte-flow stalls between Google Cloud Run and the user's browser
- **Browser side**: our NDJSON read loop is starved because cortex is doing heavy work in the same tick

These four hypotheses have very different fixes. We needed to disambiguate.

The key was that we already had server-side telemetry: `tts_server_timing` events fire from our Cloud Function for each batch yielded out of OpenAI's stream, with a high-resolution `ts` field measured from the request start. By comparing the server-side inter-batch delta against the client-side inter-arrival delta for the *same* utterance, we'd see immediately where the gap was injected.

The falsifiable test:

> If `client_delta ≈ server_ts_delta` across many utterances (Pearson correlation near 1, residual near 0), the gap exists upstream of `writeLine` — it's in OpenAI or before. If `client_delta >> server_ts_delta` consistently, the gap is downstream — network, proxy, or read loop.

We added a third mode to the analyzer: `sm audit tts-timing --chunk01-attribution`. It pulls every utterance with both events available, pairs them by session and timestamp window, computes both deltas, and reports per-utterance + aggregate stats including a Pearson coefficient.

Run on 50 utterances from production:

<p align="center">
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 580 550" font-family="system-ui, -apple-system, sans-serif">
<rect width="580" height="550" fill="white"/>
<text x="290.0" y="26" text-anchor="middle" font-size="17" font-weight="600" fill="#222">Server-side vs client-side chunk-0→1 delta</text>
<g transform="translate(0,40)">
<line x1="60" y1="420" x2="60" y2="30" stroke="#222" stroke-width="1"/>
<line x1="56" y1="420.0" x2="60" y2="420.0" stroke="#222" stroke-width="1"/>
<line x1="60" y1="420.0" x2="70" y2="420.0" stroke="#e5e7eb" stroke-width="1" stroke-dasharray="2,3"/>
<text x="52" y="424.0" text-anchor="end" font-size="11" fill="#6b7280">0</text>
<line x1="56" y1="355.0" x2="60" y2="355.0" stroke="#222" stroke-width="1"/>
<line x1="60" y1="355.0" x2="70" y2="355.0" stroke="#e5e7eb" stroke-width="1" stroke-dasharray="2,3"/>
<text x="52" y="359.0" text-anchor="end" font-size="11" fill="#6b7280">200</text>
<line x1="56" y1="290.0" x2="60" y2="290.0" stroke="#222" stroke-width="1"/>
<line x1="60" y1="290.0" x2="70" y2="290.0" stroke="#e5e7eb" stroke-width="1" stroke-dasharray="2,3"/>
<text x="52" y="294.0" text-anchor="end" font-size="11" fill="#6b7280">400</text>
<line x1="56" y1="225.0" x2="60" y2="225.0" stroke="#222" stroke-width="1"/>
<line x1="60" y1="225.0" x2="70" y2="225.0" stroke="#e5e7eb" stroke-width="1" stroke-dasharray="2,3"/>
<text x="52" y="229.0" text-anchor="end" font-size="11" fill="#6b7280">600</text>
<line x1="56" y1="160.0" x2="60" y2="160.0" stroke="#222" stroke-width="1"/>
<line x1="60" y1="160.0" x2="70" y2="160.0" stroke="#e5e7eb" stroke-width="1" stroke-dasharray="2,3"/>
<text x="52" y="164.0" text-anchor="end" font-size="11" fill="#6b7280">800</text>
<line x1="56" y1="95.0" x2="60" y2="95.0" stroke="#222" stroke-width="1"/>
<line x1="60" y1="95.0" x2="70" y2="95.0" stroke="#e5e7eb" stroke-width="1" stroke-dasharray="2,3"/>
<text x="52" y="99.0" text-anchor="end" font-size="11" fill="#6b7280">1000</text>
<line x1="56" y1="30.0" x2="60" y2="30.0" stroke="#222" stroke-width="1"/>
<line x1="60" y1="30.0" x2="70" y2="30.0" stroke="#e5e7eb" stroke-width="1" stroke-dasharray="2,3"/>
<text x="52" y="34.0" text-anchor="end" font-size="11" fill="#6b7280">1200</text>
<text x="20" y="225.0" transform="rotate(-90 20 225.0)" text-anchor="middle" font-size="12" fill="#222">client_delta (ms)</text>
<line x1="60" y1="420" x2="550" y2="420" stroke="#222" stroke-width="1"/>
<line x1="60.0" y1="420" x2="60.0" y2="424" stroke="#222" stroke-width="1"/>
<text x="60.0" y="438" text-anchor="middle" font-size="11" fill="#6b7280">0</text>
<line x1="141.66666666666669" y1="420" x2="141.66666666666669" y2="424" stroke="#222" stroke-width="1"/>
<text x="141.66666666666669" y="438" text-anchor="middle" font-size="11" fill="#6b7280">200</text>
<line x1="223.33333333333334" y1="420" x2="223.33333333333334" y2="424" stroke="#222" stroke-width="1"/>
<text x="223.33333333333334" y="438" text-anchor="middle" font-size="11" fill="#6b7280">400</text>
<line x1="305.0" y1="420" x2="305.0" y2="424" stroke="#222" stroke-width="1"/>
<text x="305.0" y="438" text-anchor="middle" font-size="11" fill="#6b7280">600</text>
<line x1="386.6666666666667" y1="420" x2="386.6666666666667" y2="424" stroke="#222" stroke-width="1"/>
<text x="386.6666666666667" y="438" text-anchor="middle" font-size="11" fill="#6b7280">800</text>
<line x1="468.3333333333333" y1="420" x2="468.3333333333333" y2="424" stroke="#222" stroke-width="1"/>
<text x="468.3333333333333" y="438" text-anchor="middle" font-size="11" fill="#6b7280">1000</text>
<line x1="550.0" y1="420" x2="550.0" y2="424" stroke="#222" stroke-width="1"/>
<text x="550.0" y="438" text-anchor="middle" font-size="11" fill="#6b7280">1200</text>
<text x="305.0" y="458" text-anchor="middle" font-size="12" fill="#222">server_ts_delta (ms)</text>
<line x1="60" y1="420" x2="550" y2="30" stroke="#6b7280" stroke-width="1.5" stroke-dasharray="4,4" opacity="0.7"/>
<text x="542" y="48" text-anchor="end" font-size="11" fill="#6b7280" font-style="italic">y = x  (perfect upstream)</text>
<circle cx="369.1" cy="46.2" r="4" fill="#3b82f6" opacity="0.55" stroke="white" stroke-width="0.5"/>
<circle cx="401.8" cy="95.6" r="4" fill="#3b82f6" opacity="0.55" stroke="white" stroke-width="0.5"/>
<circle cx="351.1" cy="114.2" r="4" fill="#3b82f6" opacity="0.55" stroke="white" stroke-width="0.5"/>
<circle cx="356.9" cy="126.8" r="4" fill="#3b82f6" opacity="0.55" stroke="white" stroke-width="0.5"/>
<circle cx="363.8" cy="146.4" r="4" fill="#3b82f6" opacity="0.55" stroke="white" stroke-width="0.5"/>
<circle cx="308.7" cy="152.5" r="4" fill="#3b82f6" opacity="0.55" stroke="white" stroke-width="0.5"/>
<circle cx="342.6" cy="157.4" r="4" fill="#3b82f6" opacity="0.55" stroke="white" stroke-width="0.5"/>
<circle cx="360.9" cy="157.4" r="4" fill="#3b82f6" opacity="0.55" stroke="white" stroke-width="0.5"/>
<circle cx="231.9" cy="162.9" r="4" fill="#3b82f6" opacity="0.55" stroke="white" stroke-width="0.5"/>
<circle cx="335.6" cy="171.7" r="4" fill="#3b82f6" opacity="0.55" stroke="white" stroke-width="0.5"/>
<circle cx="369.9" cy="174.0" r="4" fill="#3b82f6" opacity="0.55" stroke="white" stroke-width="0.5"/>
<circle cx="438.1" cy="182.4" r="4" fill="#3b82f6" opacity="0.55" stroke="white" stroke-width="0.5"/>
<circle cx="350.7" cy="186.6" r="4" fill="#3b82f6" opacity="0.55" stroke="white" stroke-width="0.5"/>
<circle cx="311.5" cy="187.0" r="4" fill="#3b82f6" opacity="0.55" stroke="white" stroke-width="0.5"/>
<circle cx="365.8" cy="188.3" r="4" fill="#3b82f6" opacity="0.55" stroke="white" stroke-width="0.5"/>
<circle cx="341.3" cy="189.2" r="4" fill="#3b82f6" opacity="0.55" stroke="white" stroke-width="0.5"/>
<circle cx="259.3" cy="189.6" r="4" fill="#3b82f6" opacity="0.55" stroke="white" stroke-width="0.5"/>
<circle cx="349.1" cy="190.9" r="4" fill="#3b82f6" opacity="0.55" stroke="white" stroke-width="0.5"/>
<circle cx="343.0" cy="195.1" r="4" fill="#3b82f6" opacity="0.55" stroke="white" stroke-width="0.5"/>
<circle cx="343.4" cy="196.1" r="4" fill="#3b82f6" opacity="0.55" stroke="white" stroke-width="0.5"/>
<circle cx="345.0" cy="201.3" r="4" fill="#3b82f6" opacity="0.55" stroke="white" stroke-width="0.5"/>
<circle cx="261.3" cy="201.3" r="4" fill="#3b82f6" opacity="0.55" stroke="white" stroke-width="0.5"/>
<circle cx="338.9" cy="205.8" r="4" fill="#3b82f6" opacity="0.55" stroke="white" stroke-width="0.5"/>
<circle cx="283.0" cy="206.5" r="4" fill="#3b82f6" opacity="0.55" stroke="white" stroke-width="0.5"/>
<circle cx="283.8" cy="207.8" r="4" fill="#3b82f6" opacity="0.55" stroke="white" stroke-width="0.5"/>
<circle cx="334.4" cy="208.1" r="4" fill="#3b82f6" opacity="0.55" stroke="white" stroke-width="0.5"/>
<circle cx="315.2" cy="208.4" r="4" fill="#3b82f6" opacity="0.55" stroke="white" stroke-width="0.5"/>
<circle cx="309.5" cy="208.8" r="4" fill="#3b82f6" opacity="0.55" stroke="white" stroke-width="0.5"/>
<circle cx="255.6" cy="209.1" r="4" fill="#3b82f6" opacity="0.55" stroke="white" stroke-width="0.5"/>
<circle cx="267.8" cy="209.7" r="4" fill="#3b82f6" opacity="0.55" stroke="white" stroke-width="0.5"/>
<circle cx="337.3" cy="210.7" r="4" fill="#3b82f6" opacity="0.55" stroke="white" stroke-width="0.5"/>
<circle cx="312.8" cy="214.9" r="4" fill="#3b82f6" opacity="0.55" stroke="white" stroke-width="0.5"/>
<circle cx="289.1" cy="215.9" r="4" fill="#3b82f6" opacity="0.55" stroke="white" stroke-width="0.5"/>
<circle cx="313.2" cy="217.2" r="4" fill="#3b82f6" opacity="0.55" stroke="white" stroke-width="0.5"/>
<circle cx="280.1" cy="217.5" r="4" fill="#3b82f6" opacity="0.55" stroke="white" stroke-width="0.5"/>
<circle cx="274.0" cy="218.5" r="4" fill="#3b82f6" opacity="0.55" stroke="white" stroke-width="0.5"/>
<circle cx="295.6" cy="219.8" r="4" fill="#3b82f6" opacity="0.55" stroke="white" stroke-width="0.5"/>
<circle cx="289.5" cy="220.4" r="4" fill="#3b82f6" opacity="0.55" stroke="white" stroke-width="0.5"/>
<circle cx="302.1" cy="223.7" r="4" fill="#3b82f6" opacity="0.55" stroke="white" stroke-width="0.5"/>
<circle cx="293.2" cy="226.3" r="4" fill="#3b82f6" opacity="0.55" stroke="white" stroke-width="0.5"/>
<circle cx="277.2" cy="226.3" r="4" fill="#3b82f6" opacity="0.55" stroke="white" stroke-width="0.5"/>
<circle cx="297.2" cy="227.6" r="4" fill="#3b82f6" opacity="0.55" stroke="white" stroke-width="0.5"/>
<circle cx="344.6" cy="227.9" r="4" fill="#3b82f6" opacity="0.55" stroke="white" stroke-width="0.5"/>
<circle cx="278.5" cy="228.6" r="4" fill="#3b82f6" opacity="0.55" stroke="white" stroke-width="0.5"/>
<circle cx="297.6" cy="228.6" r="4" fill="#3b82f6" opacity="0.55" stroke="white" stroke-width="0.5"/>
<circle cx="345.0" cy="229.9" r="4" fill="#3b82f6" opacity="0.55" stroke="white" stroke-width="0.5"/>
<circle cx="291.5" cy="230.2" r="4" fill="#3b82f6" opacity="0.55" stroke="white" stroke-width="0.5"/>
<circle cx="247.8" cy="230.5" r="4" fill="#3b82f6" opacity="0.55" stroke="white" stroke-width="0.5"/>
<circle cx="287.4" cy="233.1" r="4" fill="#3b82f6" opacity="0.55" stroke="white" stroke-width="0.5"/>
<circle cx="296.0" cy="234.1" r="4" fill="#3b82f6" opacity="0.55" stroke="white" stroke-width="0.5"/>
<text x="72" y="46" font-size="14" font-weight="600" fill="#222">Pearson r = 0.878</text>
<text x="72" y="64" font-size="11" fill="#6b7280">n = 50 utterances · residual median = 4ms</text>
</g>
<text x="290.0" y="540" text-anchor="middle" font-size="12" fill="#6b7280" font-style="italic">Points clustered near y = x → the gap exists upstream of writeLine (OpenAI delivers bytes slowly).</text>
</svg>
</p>

The points cluster tightly along the y = x reference line. Correlation **0.878**. Median residual **4 milliseconds**. The 90% case is unambiguous: the gap is upstream of writeLine. By the time bytes left our server they'd already accumulated the delay we measured on the client.

Concretely: OpenAI delivers the first ~6700 bytes of audio (one batch's worth, ~133ms of playback) more or less immediately after their TTFB, then pauses 400–800ms before sending the next ~6700 bytes, then accelerates to full speed for the remainder. The first inter-batch gap *is* the chunk-0→1 stutter. Our snap budget hides the easy cases. The hard cases (gap > 333ms) leak through and become audible silences.

The intrinsic-to-the-first-transition pattern from the production data now makes sense too: if OpenAI's generator warms up over its first ~7KB of output then runs at steady-state for the remainder, the only place a multi-hundred-millisecond inter-batch gap *could* exist is between batch 0 and batch 1. After that the bytes are flowing continuously. The shape of the problem matches the shape of the cause.

We could keep tuning around this — increasing initial lookahead, decreasing batch size, pre-warming connections, all worth their own posts. Or we could ask a different question: *what if we tested whether other providers have this pattern at all?*

## 4. Plan B: Benchmark Everyone

We built [voicebench](https://github.com/sheunaluko/voicebench) — a small Node package whose purpose is one thing: run the same text through multiple TTS providers and produce apples-to-apples streaming-latency measurements.

The design centers on a single interface, deliberately matching the shape of what we already had in production:

```ts
export interface TtsProvider {
    name: string;
    connect(opts: ConnectOpts): Promise<TtsConnection>;
    estimateCost(opts: { text: string; outputBytes: number }): CostEstimate;
    listVoices(): string[];
}

export interface TtsConnection {
    stream(opts: StreamOpts): AsyncIterable<Buffer>;  // PCM16 24kHz mono
    close(): Promise<void>;
    readonly setup_ms: number;
    readonly is_cold: boolean;
}
```

Three deliberate design choices made the harness produce meaningful comparisons:

1. **`connect()` is split from `stream()`** so WebSocket-based providers can be pre-warmed in parallel with LLM token generation (the "speculative connect" pattern — fire the WS handshake at the top of the Cloud Function so it completes while the LLM is producing its first sentence). HTTP providers' `connect()` is a no-op.
2. **All adapters re-batch audio to ~6400 bytes** per yielded `Buffer` regardless of the provider's native chunk size. Otherwise inter-batch deltas wouldn't be comparable: a provider that yields 1KB chunks would look stutter-free purely because each chunk is shorter.
3. **The per-batch yield callbacks** that drive measurement live in the interface, not in the adapter, so every provider records the same metrics the same way.

That same interface plugs directly into our production handler. When a winner emerges, replacing OpenAI is a one-line import swap.

Seven providers in scope:

| Provider | Surface | Notes |
|---|---|---|
| **OpenAI** | HTTP/2 streaming (`gpt-4o-mini-tts`) | The baseline / current production |
| **Azure** | Speech SDK (WebSocket under the hood) | Neural TTS, `en-US-AvaMultilingualNeural` |
| **Google Cloud TTS** | gRPC bidirectional streaming | Chirp 3 HD voices, only voice family that supports streaming |
| **Gemini Live** | WebSocket via `@google/genai` Live API | New multimodal API positioned for real-time agents |
| **Gemini Flash 3.1** | `interactions.create({stream:true})` | The deferred TTS endpoint — Google positions it for podcast/audiobook generation |
| **Gemini Flash 2.5** | Same endpoint, older model | Testing model variance |
| **xAI** | WebSocket TTS with `optimize_streaming_latency: 1` | The one provider that explicitly advertises low first-byte |

Methodology: 3 scenarios × 5 trials × 7 providers = 105 trials. Scenarios were a short greeting (5 words), a typical agent response (30 words), and a long explanation (150 words). Sequential trials with a 500ms cooldown between (no concurrent calls — would muddy the latency numbers). One observer, one network path: a Mac on residential fiber on the US east coast. Numbers will differ from a Cloud Run instance to OpenAI's east-coast endpoint, but the *ordering* should hold.

## 5. What 105 Trials Told Us

### The headline: chunk-0→1 gap by provider

This is the actual stutter signal — the metric we spent two weeks chasing. Median chunk-0→1 inter-batch gap for each provider × scenario, sorted by their worst scenario:

<p align="center">
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 760 430" font-family="system-ui, -apple-system, sans-serif">
<rect width="760" height="430" fill="white"/>
<text x="380.0" y="26" text-anchor="middle" font-size="17" font-weight="600" fill="#222">Chunk-0→1 gap (median per scenario) — sorted by worst scenario</text>
<g transform="translate(0,40)">
<line x1="165" y1="305" x2="650" y2="305" stroke="#222" stroke-width="1"/>
<line x1="165.0" y1="305" x2="165.0" y2="309" stroke="#222" stroke-width="1"/>
<text x="165.0" y="323" text-anchor="middle" font-size="11" fill="#6b7280">0</text>
<line x1="286.25" y1="305" x2="286.25" y2="309" stroke="#222" stroke-width="1"/>
<text x="286.25" y="323" text-anchor="middle" font-size="11" fill="#6b7280">200</text>
<line x1="407.5" y1="305" x2="407.5" y2="309" stroke="#222" stroke-width="1"/>
<text x="407.5" y="323" text-anchor="middle" font-size="11" fill="#6b7280">400</text>
<line x1="528.75" y1="305" x2="528.75" y2="309" stroke="#222" stroke-width="1"/>
<text x="528.75" y="323" text-anchor="middle" font-size="11" fill="#6b7280">600</text>
<line x1="650.0" y1="305" x2="650.0" y2="309" stroke="#222" stroke-width="1"/>
<text x="650.0" y="323" text-anchor="middle" font-size="11" fill="#6b7280">800</text>
<text x="407.5" y="343" text-anchor="middle" font-size="12" fill="#222">chunk-0→1 gap median (ms)</text>
<line x1="165" y1="305" x2="165" y2="20" stroke="#222" stroke-width="1"/>
<line x1="366.88125" y1="20" x2="366.88125" y2="305" stroke="#dc2626" stroke-width="1.5" stroke-dasharray="4,3" opacity="0.55"/>
<text x="370.88125" y="31" font-size="10" fill="#dc2626">snap budget (333ms)</text>
<text x="155" y="44.35714285714286" text-anchor="end" font-size="12" fill="#222" font-weight="500">Azure</text>
<rect x="165" y="25.08928571428572" width="1" height="8.178571428571429" fill="#93c5fd"/>
<text x="169.0" y="31.267857142857146" font-size="10" fill="#222">0ms</text>
<rect x="165" y="35.267857142857146" width="1" height="8.178571428571429" fill="#3b82f6"/>
<text x="169.0" y="41.44642857142858" font-size="10" fill="#222">0ms</text>
<rect x="165" y="45.44642857142858" width="1" height="8.178571428571429" fill="#1e40af"/>
<text x="169.0" y="51.62500000000001" font-size="10" fill="#222">0ms</text>
<text x="155" y="85.07142857142857" text-anchor="end" font-size="12" fill="#222" font-weight="500">xAI</text>
<rect x="165" y="65.80357142857143" width="1" height="8.178571428571429" fill="#93c5fd"/>
<text x="169.0" y="71.98214285714286" font-size="10" fill="#222">0ms</text>
<rect x="165" y="75.98214285714286" width="1" height="8.178571428571429" fill="#3b82f6"/>
<text x="169.0" y="82.16071428571429" font-size="10" fill="#222">0ms</text>
<rect x="165" y="86.16071428571428" width="1" height="8.178571428571429" fill="#1e40af"/>
<text x="169.0" y="92.33928571428571" font-size="10" fill="#222">0ms</text>
<text x="155" y="125.78571428571429" text-anchor="end" font-size="12" fill="#222" font-weight="500">Gemini Flash 2.5</text>
<rect x="165" y="106.51785714285715" width="1" height="8.178571428571429" fill="#93c5fd"/>
<rect x="165" y="116.69642857142858" width="1" height="8.178571428571429" fill="#3b82f6"/>
<rect x="165" y="126.875" width="1" height="8.178571428571429" fill="#1e40af"/>
<text x="155" y="166.5" text-anchor="end" font-size="12" fill="#222" font-weight="500">GCP</text>
<rect x="165" y="147.23214285714286" width="18.1875" height="8.178571428571429" fill="#93c5fd"/>
<text x="187.1875" y="153.41071428571428" font-size="10" fill="#222">30ms</text>
<rect x="165" y="157.41071428571428" width="17.581249999999997" height="8.178571428571429" fill="#3b82f6"/>
<text x="186.58125" y="163.5892857142857" font-size="10" fill="#222">29ms</text>
<rect x="165" y="167.58928571428572" width="19.400000000000002" height="8.178571428571429" fill="#1e40af"/>
<text x="188.4" y="173.76785714285714" font-size="10" fill="#222">32ms</text>
<text x="155" y="207.21428571428572" text-anchor="end" font-size="12" fill="#222" font-weight="500">Gemini Flash 3.1</text>
<rect x="165" y="187.94642857142858" width="17.581249999999997" height="8.178571428571429" fill="#93c5fd"/>
<text x="186.58125" y="194.125" font-size="10" fill="#222">29ms</text>
<rect x="165" y="198.125" width="32.737500000000004" height="8.178571428571429" fill="#3b82f6"/>
<text x="201.7375" y="204.30357142857142" font-size="10" fill="#222">54ms</text>
<rect x="165" y="208.30357142857144" width="16.975" height="8.178571428571429" fill="#1e40af"/>
<text x="185.975" y="214.48214285714286" font-size="10" fill="#222">28ms</text>
<text x="155" y="247.92857142857144" text-anchor="end" font-size="12" fill="#222" font-weight="500">Gemini Live</text>
<rect x="165" y="228.6607142857143" width="34.55625" height="8.178571428571429" fill="#93c5fd"/>
<text x="203.55625" y="234.83928571428572" font-size="10" fill="#222">57ms</text>
<rect x="165" y="238.83928571428572" width="1" height="8.178571428571429" fill="#3b82f6"/>
<rect x="165" y="249.01785714285717" width="32.737500000000004" height="8.178571428571429" fill="#1e40af"/>
<text x="201.7375" y="255.1964285714286" font-size="10" fill="#222">54ms</text>
<text x="155" y="288.6428571428571" text-anchor="end" font-size="12" fill="#222" font-weight="500">OpenAI</text>
<rect x="165" y="269.37499999999994" width="207.94375000000002" height="8.178571428571429" fill="#93c5fd"/>
<text x="376.94375" y="275.5535714285714" font-size="10" fill="#222">343ms</text>
<rect x="165" y="279.5535714285714" width="232.19375" height="8.178571428571429" fill="#3b82f6"/>
<text x="401.19375" y="285.73214285714283" font-size="10" fill="#222">383ms</text>
<rect x="165" y="289.73214285714283" width="240.075" height="8.178571428571429" fill="#1e40af"/>
<text x="409.075" y="295.9107142857143" font-size="10" fill="#222">396ms</text>
<rect x="658" y="24" width="14" height="10" fill="#93c5fd"/>
<text x="678" y="33" font-size="11" fill="#222">short</text>
<rect x="658" y="44" width="14" height="10" fill="#3b82f6"/>
<text x="678" y="53" font-size="11" fill="#222">medium</text>
<rect x="658" y="64" width="14" height="10" fill="#1e40af"/>
<text x="678" y="73" font-size="11" fill="#222">long</text>
</g>
<text x="380.0" y="420" text-anchor="middle" font-size="12" fill="#6b7280" font-style="italic">Five providers stay under the snap budget at all sizes. OpenAI (gpt-4o-mini-tts) does not.</text>
</svg>
</p>

**Five providers stay safely under the snap budget. OpenAI does not.** OpenAI's median gap is 343–633ms across the three scenarios. The snap budget is 333ms. That means the *typical* OpenAI utterance produces a chunk-0→1 silence the player cannot fully hide — which is exactly what users were reporting.

Three providers (Azure, xAI, Gemini Flash 2.5) post 0ms across all scenarios. Two have a small but non-zero gap (~30-60ms) that stays well within budget. The result is unambiguous: this isn't a "Tivi configuration" problem, it's a provider problem.

### TTFB — first byte from request to client

The chunk-0→1 gap is the stutter signal, but it's not the only thing that matters. Time-to-first-byte governs how quickly the user hears *anything* after speaking:

<p align="center">
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 760 430" font-family="system-ui, -apple-system, sans-serif">
<rect width="760" height="430" fill="white"/>
<text x="380.0" y="26" text-anchor="middle" font-size="17" font-weight="600" fill="#222">Time to first byte (median per scenario)</text>
<g transform="translate(0,40)">
<line x1="165" y1="305" x2="650" y2="305" stroke="#222" stroke-width="1"/>
<line x1="165.0" y1="305" x2="165.0" y2="309" stroke="#222" stroke-width="1"/>
<text x="165.0" y="323" text-anchor="middle" font-size="11" fill="#6b7280">0</text>
<line x1="262.0" y1="305" x2="262.0" y2="309" stroke="#222" stroke-width="1"/>
<text x="262.0" y="323" text-anchor="middle" font-size="11" fill="#6b7280">4400</text>
<line x1="359.0" y1="305" x2="359.0" y2="309" stroke="#222" stroke-width="1"/>
<text x="359.0" y="323" text-anchor="middle" font-size="11" fill="#6b7280">8800</text>
<line x1="456.0" y1="305" x2="456.0" y2="309" stroke="#222" stroke-width="1"/>
<text x="456.0" y="323" text-anchor="middle" font-size="11" fill="#6b7280">13200</text>
<line x1="553.0" y1="305" x2="553.0" y2="309" stroke="#222" stroke-width="1"/>
<text x="553.0" y="323" text-anchor="middle" font-size="11" fill="#6b7280">17600</text>
<line x1="650.0" y1="305" x2="650.0" y2="309" stroke="#222" stroke-width="1"/>
<text x="650.0" y="323" text-anchor="middle" font-size="11" fill="#6b7280">22000</text>
<text x="407.5" y="343" text-anchor="middle" font-size="12" fill="#222">TTFB median (ms) — log-ish scale, watch the right side</text>
<line x1="165" y1="305" x2="165" y2="20" stroke="#222" stroke-width="1"/>
<text x="155" y="44.35714285714286" text-anchor="end" font-size="12" fill="#222" font-weight="500">GCP</text>
<rect x="165" y="25.08928571428572" width="4.6075" height="8.178571428571429" fill="#93c5fd"/>
<text x="173.6075" y="31.267857142857146" font-size="10" fill="#222">209ms</text>
<rect x="165" y="35.267857142857146" width="4.387045454545455" height="8.178571428571429" fill="#3b82f6"/>
<text x="173.38704545454544" y="41.44642857142858" font-size="10" fill="#222">199ms</text>
<rect x="165" y="45.44642857142858" width="4.563409090909091" height="8.178571428571429" fill="#1e40af"/>
<text x="173.5634090909091" y="51.62500000000001" font-size="10" fill="#222">207ms</text>
<text x="155" y="85.07142857142857" text-anchor="end" font-size="12" fill="#222" font-weight="500">xAI</text>
<rect x="165" y="65.80357142857143" width="8.575681818181817" height="8.178571428571429" fill="#93c5fd"/>
<text x="177.5756818181818" y="71.98214285714286" font-size="10" fill="#222">389ms</text>
<rect x="165" y="75.98214285714286" width="9.810227272727271" height="8.178571428571429" fill="#3b82f6"/>
<text x="178.81022727272727" y="82.16071428571429" font-size="10" fill="#222">445ms</text>
<rect x="165" y="86.16071428571428" width="8.44340909090909" height="8.178571428571429" fill="#1e40af"/>
<text x="177.44340909090909" y="92.33928571428571" font-size="10" fill="#222">383ms</text>
<text x="155" y="125.78571428571429" text-anchor="end" font-size="12" fill="#222" font-weight="500">Azure</text>
<rect x="165" y="106.51785714285715" width="13.05090909090909" height="8.178571428571429" fill="#93c5fd"/>
<text x="182.0509090909091" y="112.69642857142858" font-size="10" fill="#222">592ms</text>
<rect x="165" y="116.69642857142858" width="12.962727272727273" height="8.178571428571429" fill="#3b82f6"/>
<text x="181.96272727272728" y="122.87500000000001" font-size="10" fill="#222">588ms</text>
<rect x="165" y="126.875" width="12.499772727272727" height="8.178571428571429" fill="#1e40af"/>
<text x="181.49977272727273" y="133.05357142857142" font-size="10" fill="#222">567ms</text>
<text x="155" y="166.5" text-anchor="end" font-size="12" fill="#222" font-weight="500">Gemini Live</text>
<rect x="165" y="147.23214285714286" width="14.726363636363637" height="8.178571428571429" fill="#93c5fd"/>
<text x="183.72636363636363" y="153.41071428571428" font-size="10" fill="#222">668ms</text>
<rect x="165" y="157.41071428571428" width="14.549999999999999" height="8.178571428571429" fill="#3b82f6"/>
<text x="183.55" y="163.5892857142857" font-size="10" fill="#222">660ms</text>
<rect x="165" y="167.58928571428572" width="17.063181818181818" height="8.178571428571429" fill="#1e40af"/>
<text x="186.06318181818182" y="173.76785714285714" font-size="10" fill="#222">774ms</text>
<text x="155" y="207.21428571428572" text-anchor="end" font-size="12" fill="#222" font-weight="500">OpenAI</text>
<rect x="165" y="187.94642857142858" width="15.387727272727274" height="8.178571428571429" fill="#93c5fd"/>
<text x="184.38772727272726" y="194.125" font-size="10" fill="#222">698ms</text>
<rect x="165" y="198.125" width="17.305681818181817" height="8.178571428571429" fill="#3b82f6"/>
<text x="186.30568181818182" y="204.30357142857142" font-size="10" fill="#222">785ms</text>
<rect x="165" y="208.30357142857144" width="11.59590909090909" height="8.178571428571429" fill="#1e40af"/>
<text x="180.5959090909091" y="214.48214285714286" font-size="10" fill="#222">526ms</text>
<text x="155" y="247.92857142857144" text-anchor="end" font-size="12" fill="#222" font-weight="500">Gemini Flash 3.1</text>
<rect x="165" y="228.6607142857143" width="20.392045454545453" height="8.178571428571429" fill="#93c5fd"/>
<text x="189.39204545454544" y="234.83928571428572" font-size="10" fill="#222">925ms</text>
<rect x="165" y="238.83928571428572" width="20.50227272727273" height="8.178571428571429" fill="#3b82f6"/>
<text x="189.50227272727273" y="245.01785714285714" font-size="10" fill="#222">930ms</text>
<rect x="165" y="249.01785714285717" width="23.456363636363637" height="8.178571428571429" fill="#1e40af"/>
<text x="192.45636363636365" y="255.1964285714286" font-size="10" fill="#222">1064ms</text>
<text x="155" y="288.6428571428571" text-anchor="end" font-size="12" fill="#222" font-weight="500">Gemini Flash 2.5</text>
<rect x="165" y="269.37499999999994" width="43.29727272727273" height="8.178571428571429" fill="#93c5fd"/>
<text x="212.29727272727274" y="275.5535714285714" font-size="10" fill="#222">1964ms</text>
<rect x="165" y="279.5535714285714" width="125.32840909090909" height="8.178571428571429" fill="#3b82f6"/>
<text x="294.3284090909091" y="285.73214285714283" font-size="10" fill="#222">5685ms</text>
<rect x="165" y="289.73214285714283" width="453.49704545454546" height="8.178571428571429" fill="#1e40af"/>
<text x="622.4970454545455" y="295.9107142857143" font-size="10" fill="#222">20571ms</text>
<rect x="658" y="24" width="14" height="10" fill="#93c5fd"/>
<text x="678" y="33" font-size="11" fill="#222">short</text>
<rect x="658" y="44" width="14" height="10" fill="#3b82f6"/>
<text x="678" y="53" font-size="11" fill="#222">medium</text>
<rect x="658" y="64" width="14" height="10" fill="#1e40af"/>
<text x="678" y="73" font-size="11" fill="#222">long</text>
</g>
<text x="380.0" y="420" text-anchor="middle" font-size="12" fill="#6b7280" font-style="italic">Gemini Flash 2.5 TTFB scales linearly with text length — the smoking gun that it is secretly non-streaming.</text>
</svg>
</p>

Google Cloud TTS (warm) is fastest at ~210ms — although it eats a 3-second penalty on the first call per process to set up the gRPC channel. xAI is next at ~400ms. Azure follows at 600–800ms. OpenAI and Gemini Live cluster in the 700–1200ms range.

**Gemini Flash 2.5 deserves its own footnote.** Its TTFB scales *linearly* with text length: 2 seconds for short, 5.7 seconds for medium, 20 seconds for long. That's the signature of a non-streaming endpoint pretending to be one — it generates the entire audio file server-side and then bursts it to the client. The chunk-0→1 gap of 0ms is technically true and totally useless: there *is* no inter-batch gap because there is no inter-batch. Google's own documentation positions this endpoint "for podcast or audiobook generation" and they're right. It's the wrong tool for a real-time agent.

### End-to-end response time

Time from `stream()` call to last byte delivered:

<p align="center">
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 470" font-family="system-ui, -apple-system, sans-serif">
<rect width="720" height="470" fill="white"/>
<text x="360.0" y="26" text-anchor="middle" font-size="17" font-weight="600" fill="#222">End-to-end response time vs utterance length</text>
<g transform="translate(0,40)">
<line x1="70" y1="340" x2="70" y2="20" stroke="#222" stroke-width="1"/>
<line x1="66" y1="340.0" x2="70" y2="340.0" stroke="#222" stroke-width="1"/>
<line x1="70" y1="340.0" x2="80" y2="340.0" stroke="#e5e7eb" stroke-width="1" stroke-dasharray="2,3"/>
<text x="62" y="344.0" text-anchor="end" font-size="11" fill="#6b7280">0</text>
<line x1="66" y1="276.0" x2="70" y2="276.0" stroke="#222" stroke-width="1"/>
<line x1="70" y1="276.0" x2="80" y2="276.0" stroke="#e5e7eb" stroke-width="1" stroke-dasharray="2,3"/>
<text x="62" y="280.0" text-anchor="end" font-size="11" fill="#6b7280">4400</text>
<line x1="66" y1="212.0" x2="70" y2="212.0" stroke="#222" stroke-width="1"/>
<line x1="70" y1="212.0" x2="80" y2="212.0" stroke="#e5e7eb" stroke-width="1" stroke-dasharray="2,3"/>
<text x="62" y="216.0" text-anchor="end" font-size="11" fill="#6b7280">8800</text>
<line x1="66" y1="148.0" x2="70" y2="148.0" stroke="#222" stroke-width="1"/>
<line x1="70" y1="148.0" x2="80" y2="148.0" stroke="#e5e7eb" stroke-width="1" stroke-dasharray="2,3"/>
<text x="62" y="152.0" text-anchor="end" font-size="11" fill="#6b7280">13200</text>
<line x1="66" y1="84.0" x2="70" y2="84.0" stroke="#222" stroke-width="1"/>
<line x1="70" y1="84.0" x2="80" y2="84.0" stroke="#e5e7eb" stroke-width="1" stroke-dasharray="2,3"/>
<text x="62" y="88.0" text-anchor="end" font-size="11" fill="#6b7280">17600</text>
<line x1="66" y1="20.0" x2="70" y2="20.0" stroke="#222" stroke-width="1"/>
<line x1="70" y1="20.0" x2="80" y2="20.0" stroke="#e5e7eb" stroke-width="1" stroke-dasharray="2,3"/>
<text x="62" y="24.0" text-anchor="end" font-size="11" fill="#6b7280">22000</text>
<text x="20" y="180.0" transform="rotate(-90 20 180.0)" text-anchor="middle" font-size="12" fill="#222">total response (ms)</text>
<line x1="70" y1="340" x2="540" y2="340" stroke="#222" stroke-width="1"/>
<line x1="70.0" y1="340" x2="70.0" y2="344" stroke="#222" stroke-width="1"/>
<text x="70.0" y="358" text-anchor="middle" font-size="11" fill="#6b7280">0</text>
<line x1="187.5" y1="340" x2="187.5" y2="344" stroke="#222" stroke-width="1"/>
<text x="187.5" y="358" text-anchor="middle" font-size="11" fill="#6b7280">40</text>
<line x1="305.0" y1="340" x2="305.0" y2="344" stroke="#222" stroke-width="1"/>
<text x="305.0" y="358" text-anchor="middle" font-size="11" fill="#6b7280">80</text>
<line x1="422.5" y1="340" x2="422.5" y2="344" stroke="#222" stroke-width="1"/>
<text x="422.5" y="358" text-anchor="middle" font-size="11" fill="#6b7280">120</text>
<line x1="540.0" y1="340" x2="540.0" y2="344" stroke="#222" stroke-width="1"/>
<text x="540.0" y="358" text-anchor="middle" font-size="11" fill="#6b7280">160</text>
<text x="305.0" y="378" text-anchor="middle" font-size="12" fill="#222">utterance length (words)</text>
<path d="M84.7,323.9 L158.1,312.2 L510.6,226.6 " stroke="#10a37f" stroke-width="2" fill="none"/>
<circle cx="84.7" cy="323.9" r="4" fill="#10a37f"/>
<circle cx="158.1" cy="312.2" r="4" fill="#10a37f"/>
<circle cx="510.6" cy="226.6" r="4" fill="#10a37f"/>
<path d="M84.7,331.4 L158.1,328.5 L510.6,308.9 " stroke="#0078d4" stroke-width="2" fill="none"/>
<circle cx="84.7" cy="331.4" r="4" fill="#0078d4"/>
<circle cx="158.1" cy="328.5" r="4" fill="#0078d4"/>
<circle cx="510.6" cy="308.9" r="4" fill="#0078d4"/>
<path d="M84.7,325.8 L158.1,275.2 L510.6,52.8 " stroke="#1d1f21" stroke-width="2" fill="none"/>
<circle cx="84.7" cy="325.8" r="4" fill="#1d1f21"/>
<circle cx="158.1" cy="275.2" r="4" fill="#1d1f21"/>
<circle cx="510.6" cy="52.8" r="4" fill="#1d1f21"/>
<path d="M84.7,333.3 L158.1,318.9 L510.6,231.6 " stroke="#ea4335" stroke-width="2" fill="none"/>
<circle cx="84.7" cy="333.3" r="4" fill="#ea4335"/>
<circle cx="158.1" cy="318.9" r="4" fill="#ea4335"/>
<circle cx="510.6" cy="231.6" r="4" fill="#ea4335"/>
<path d="M84.7,274.9 L158.1,270.8 L510.6,60.4 " stroke="#f59e0b" stroke-width="2" fill="none"/>
<circle cx="84.7" cy="274.9" r="4" fill="#f59e0b"/>
<circle cx="158.1" cy="270.8" r="4" fill="#f59e0b"/>
<circle cx="510.6" cy="60.4" r="4" fill="#f59e0b"/>
<path d="M84.7,309.9 L158.1,277.1 L510.6,86.2 " stroke="#a855f7" stroke-width="2" fill="none"/>
<circle cx="84.7" cy="309.9" r="4" fill="#a855f7"/>
<circle cx="158.1" cy="277.1" r="4" fill="#a855f7"/>
<circle cx="510.6" cy="86.2" r="4" fill="#a855f7"/>
<path d="M84.7,305.6 L158.1,251.4 L510.6,40.3 " stroke="#ec4899" stroke-width="2" fill="none"/>
<circle cx="84.7" cy="305.6" r="4" fill="#ec4899"/>
<circle cx="158.1" cy="251.4" r="4" fill="#ec4899"/>
<circle cx="510.6" cy="40.3" r="4" fill="#ec4899"/>
<rect x="548" y="24" width="14" height="4" fill="#10a37f"/>
<text x="568" y="30" font-size="11" fill="#222">OpenAI</text>
<rect x="548" y="46" width="14" height="4" fill="#0078d4"/>
<text x="568" y="52" font-size="11" fill="#222">Azure</text>
<rect x="548" y="68" width="14" height="4" fill="#1d1f21"/>
<text x="568" y="74" font-size="11" fill="#222">xAI</text>
<rect x="548" y="90" width="14" height="4" fill="#ea4335"/>
<text x="568" y="96" font-size="11" fill="#222">GCP</text>
<rect x="548" y="112" width="14" height="4" fill="#f59e0b"/>
<text x="568" y="118" font-size="11" fill="#222">Gemini Live</text>
<rect x="548" y="134" width="14" height="4" fill="#a855f7"/>
<text x="568" y="140" font-size="11" fill="#222">Gemini Flash 3.1</text>
<rect x="548" y="156" width="14" height="4" fill="#ec4899"/>
<text x="568" y="162" font-size="11" fill="#222">Gemini Flash 2.5</text>
</g>
<text x="360.0" y="460" text-anchor="middle" font-size="12" fill="#6b7280" font-style="italic">Azure delivers the whole 150-word utterance in 2.2s wall time — about 23x faster than realtime.</text>
</svg>
</p>

Azure dominates. For the long (150-word) scenario, Azure delivers ~50 seconds of audio in 2.2 seconds of wall time — about **23x faster than realtime**. GCP comes second (7.5s for the same scenario). OpenAI's 8 seconds is in the middle of the pack. xAI, Gemini Live, and Gemini Flash 3.1 take 17–20 seconds — they stream closer to real-time playback rate, which is fine for the user (audio is playing during that window) but means the connection stays open longer.

### Visualizing the stutter: same text, two providers

Here's what the gap looks like when you draw every batch arrival as a tick mark on a timeline:

<p align="center">
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 760 390" font-family="system-ui, -apple-system, sans-serif">
<rect width="760" height="390" fill="white"/>
<text x="380.0" y="26" text-anchor="middle" font-size="17" font-weight="600" fill="#222">Batch arrival timeline — same text, two providers</text>
<g transform="translate(0,40)">
<line x1="80" y1="270" x2="730" y2="270" stroke="#222" stroke-width="1"/>
<line x1="80.0" y1="270" x2="80.0" y2="274" stroke="#222" stroke-width="1"/>
<text x="80.0" y="288" text-anchor="middle" font-size="11" fill="#6b7280">0</text>
<line x1="210.0" y1="270" x2="210.0" y2="274" stroke="#222" stroke-width="1"/>
<text x="210.0" y="288" text-anchor="middle" font-size="11" fill="#6b7280">400</text>
<line x1="340.0" y1="270" x2="340.0" y2="274" stroke="#222" stroke-width="1"/>
<text x="340.0" y="288" text-anchor="middle" font-size="11" fill="#6b7280">800</text>
<line x1="470.0" y1="270" x2="470.0" y2="274" stroke="#222" stroke-width="1"/>
<text x="470.0" y="288" text-anchor="middle" font-size="11" fill="#6b7280">1200</text>
<line x1="600.0" y1="270" x2="600.0" y2="274" stroke="#222" stroke-width="1"/>
<text x="600.0" y="288" text-anchor="middle" font-size="11" fill="#6b7280">1600</text>
<line x1="730.0" y1="270" x2="730.0" y2="274" stroke="#222" stroke-width="1"/>
<text x="730.0" y="288" text-anchor="middle" font-size="11" fill="#6b7280">2000</text>
<text x="405.0" y="308" text-anchor="middle" font-size="12" fill="#222">ms from stream() call</text>
<line x1="80" y1="270" x2="80" y2="30" stroke="#222" stroke-width="1"/>
<text x="70" y="94.0" text-anchor="end" font-size="13" font-weight="600" fill="#10a37f">OpenAI</text>
<line x1="80" y1="90.0" x2="730" y2="90.0" stroke="#e5e7eb" stroke-width="1"/>
<line x1="257.5" y1="76.0" x2="257.5" y2="104.0" stroke="#10a37f" stroke-width="2" opacity="0.85"/>
<line x1="381.9" y1="76.0" x2="381.9" y2="104.0" stroke="#10a37f" stroke-width="2" opacity="0.85"/>
<line x1="400.8" y1="76.0" x2="400.8" y2="104.0" stroke="#10a37f" stroke-width="2" opacity="0.85"/>
<line x1="439.5" y1="76.0" x2="439.5" y2="104.0" stroke="#10a37f" stroke-width="2" opacity="0.85"/>
<line x1="462.5" y1="76.0" x2="462.5" y2="104.0" stroke="#10a37f" stroke-width="2" opacity="0.85"/>
<line x1="475.5" y1="76.0" x2="475.5" y2="104.0" stroke="#10a37f" stroke-width="2" opacity="0.85"/>
<line x1="495.4" y1="76.0" x2="495.4" y2="104.0" stroke="#10a37f" stroke-width="2" opacity="0.85"/>
<line x1="510.3" y1="76.0" x2="510.3" y2="104.0" stroke="#10a37f" stroke-width="2" opacity="0.85"/>
<line x1="525.2" y1="76.0" x2="525.2" y2="104.0" stroke="#10a37f" stroke-width="2" opacity="0.85"/>
<line x1="571.4" y1="76.0" x2="571.4" y2="104.0" stroke="#10a37f" stroke-width="2" opacity="0.85"/>
<line x1="591.5" y1="76.0" x2="591.5" y2="104.0" stroke="#10a37f" stroke-width="2" opacity="0.85"/>
<line x1="621.4" y1="76.0" x2="621.4" y2="104.0" stroke="#10a37f" stroke-width="2" opacity="0.85"/>
<line x1="623.7" y1="76.0" x2="623.7" y2="104.0" stroke="#10a37f" stroke-width="2" opacity="0.85"/>
<line x1="646.1" y1="76.0" x2="646.1" y2="104.0" stroke="#10a37f" stroke-width="2" opacity="0.85"/>
<line x1="661.1" y1="76.0" x2="661.1" y2="104.0" stroke="#10a37f" stroke-width="2" opacity="0.85"/>
<line x1="694.2" y1="76.0" x2="694.2" y2="104.0" stroke="#10a37f" stroke-width="2" opacity="0.85"/>
<line x1="694.9" y1="76.0" x2="694.9" y2="104.0" stroke="#10a37f" stroke-width="2" opacity="0.85"/>
<line x1="696.5" y1="76.0" x2="696.5" y2="104.0" stroke="#10a37f" stroke-width="2" opacity="0.85"/>
<line x1="696.9" y1="76.0" x2="696.9" y2="104.0" stroke="#10a37f" stroke-width="2" opacity="0.85"/>
<line x1="700.1" y1="76.0" x2="700.1" y2="104.0" stroke="#10a37f" stroke-width="2" opacity="0.85"/>
<line x1="700.4" y1="76.0" x2="700.4" y2="104.0" stroke="#10a37f" stroke-width="2" opacity="0.85"/>
<line x1="701.1" y1="76.0" x2="701.1" y2="104.0" stroke="#10a37f" stroke-width="2" opacity="0.85"/>
<text x="726" y="72.0" text-anchor="end" font-size="10" fill="#6b7280">22 batches</text>
<text x="70" y="214.0" text-anchor="end" font-size="13" font-weight="600" fill="#0078d4">Azure</text>
<line x1="80" y1="210.0" x2="730" y2="210.0" stroke="#e5e7eb" stroke-width="1"/>
<line x1="271.1" y1="196.0" x2="271.1" y2="224.0" stroke="#0078d4" stroke-width="2" opacity="0.85"/>
<line x1="271.1" y1="196.0" x2="271.1" y2="224.0" stroke="#0078d4" stroke-width="2" opacity="0.85"/>
<line x1="271.1" y1="196.0" x2="271.1" y2="224.0" stroke="#0078d4" stroke-width="2" opacity="0.85"/>
<line x1="271.1" y1="196.0" x2="271.1" y2="224.0" stroke="#0078d4" stroke-width="2" opacity="0.85"/>
<line x1="271.1" y1="196.0" x2="271.1" y2="224.0" stroke="#0078d4" stroke-width="2" opacity="0.85"/>
<line x1="271.1" y1="196.0" x2="271.1" y2="224.0" stroke="#0078d4" stroke-width="2" opacity="0.85"/>
<line x1="271.1" y1="196.0" x2="271.1" y2="224.0" stroke="#0078d4" stroke-width="2" opacity="0.85"/>
<line x1="271.1" y1="196.0" x2="271.1" y2="224.0" stroke="#0078d4" stroke-width="2" opacity="0.85"/>
<line x1="271.1" y1="196.0" x2="271.1" y2="224.0" stroke="#0078d4" stroke-width="2" opacity="0.85"/>
<line x1="271.4" y1="196.0" x2="271.4" y2="224.0" stroke="#0078d4" stroke-width="2" opacity="0.85"/>
<line x1="271.4" y1="196.0" x2="271.4" y2="224.0" stroke="#0078d4" stroke-width="2" opacity="0.85"/>
<line x1="271.4" y1="196.0" x2="271.4" y2="224.0" stroke="#0078d4" stroke-width="2" opacity="0.85"/>
<line x1="271.4" y1="196.0" x2="271.4" y2="224.0" stroke="#0078d4" stroke-width="2" opacity="0.85"/>
<line x1="289.0" y1="196.0" x2="289.0" y2="224.0" stroke="#0078d4" stroke-width="2" opacity="0.85"/>
<line x1="289.0" y1="196.0" x2="289.0" y2="224.0" stroke="#0078d4" stroke-width="2" opacity="0.85"/>
<line x1="290.3" y1="196.0" x2="290.3" y2="224.0" stroke="#0078d4" stroke-width="2" opacity="0.85"/>
<line x1="290.3" y1="196.0" x2="290.3" y2="224.0" stroke="#0078d4" stroke-width="2" opacity="0.85"/>
<line x1="290.3" y1="196.0" x2="290.3" y2="224.0" stroke="#0078d4" stroke-width="2" opacity="0.85"/>
<line x1="290.3" y1="196.0" x2="290.3" y2="224.0" stroke="#0078d4" stroke-width="2" opacity="0.85"/>
<line x1="290.3" y1="196.0" x2="290.3" y2="224.0" stroke="#0078d4" stroke-width="2" opacity="0.85"/>
<line x1="290.3" y1="196.0" x2="290.3" y2="224.0" stroke="#0078d4" stroke-width="2" opacity="0.85"/>
<line x1="290.3" y1="196.0" x2="290.3" y2="224.0" stroke="#0078d4" stroke-width="2" opacity="0.85"/>
<line x1="290.3" y1="196.0" x2="290.3" y2="224.0" stroke="#0078d4" stroke-width="2" opacity="0.85"/>
<line x1="290.3" y1="196.0" x2="290.3" y2="224.0" stroke="#0078d4" stroke-width="2" opacity="0.85"/>
<line x1="308.5" y1="196.0" x2="308.5" y2="224.0" stroke="#0078d4" stroke-width="2" opacity="0.85"/>
<line x1="308.5" y1="196.0" x2="308.5" y2="224.0" stroke="#0078d4" stroke-width="2" opacity="0.85"/>
<line x1="308.5" y1="196.0" x2="308.5" y2="224.0" stroke="#0078d4" stroke-width="2" opacity="0.85"/>
<line x1="308.5" y1="196.0" x2="308.5" y2="224.0" stroke="#0078d4" stroke-width="2" opacity="0.85"/>
<line x1="308.5" y1="196.0" x2="308.5" y2="224.0" stroke="#0078d4" stroke-width="2" opacity="0.85"/>
<line x1="308.5" y1="196.0" x2="308.5" y2="224.0" stroke="#0078d4" stroke-width="2" opacity="0.85"/>
<line x1="308.5" y1="196.0" x2="308.5" y2="224.0" stroke="#0078d4" stroke-width="2" opacity="0.85"/>
<line x1="308.5" y1="196.0" x2="308.5" y2="224.0" stroke="#0078d4" stroke-width="2" opacity="0.85"/>
<line x1="308.5" y1="196.0" x2="308.5" y2="224.0" stroke="#0078d4" stroke-width="2" opacity="0.85"/>
<line x1="310.4" y1="196.0" x2="310.4" y2="224.0" stroke="#0078d4" stroke-width="2" opacity="0.85"/>
<line x1="310.4" y1="196.0" x2="310.4" y2="224.0" stroke="#0078d4" stroke-width="2" opacity="0.85"/>
<line x1="310.4" y1="196.0" x2="310.4" y2="224.0" stroke="#0078d4" stroke-width="2" opacity="0.85"/>
<line x1="310.4" y1="196.0" x2="310.4" y2="224.0" stroke="#0078d4" stroke-width="2" opacity="0.85"/>
<line x1="310.4" y1="196.0" x2="310.4" y2="224.0" stroke="#0078d4" stroke-width="2" opacity="0.85"/>
<line x1="310.4" y1="196.0" x2="310.4" y2="224.0" stroke="#0078d4" stroke-width="2" opacity="0.85"/>
<line x1="310.4" y1="196.0" x2="310.4" y2="224.0" stroke="#0078d4" stroke-width="2" opacity="0.85"/>
<line x1="310.4" y1="196.0" x2="310.4" y2="224.0" stroke="#0078d4" stroke-width="2" opacity="0.85"/>
<line x1="310.4" y1="196.0" x2="310.4" y2="224.0" stroke="#0078d4" stroke-width="2" opacity="0.85"/>
<line x1="310.4" y1="196.0" x2="310.4" y2="224.0" stroke="#0078d4" stroke-width="2" opacity="0.85"/>
<line x1="331.9" y1="196.0" x2="331.9" y2="224.0" stroke="#0078d4" stroke-width="2" opacity="0.85"/>
<line x1="331.9" y1="196.0" x2="331.9" y2="224.0" stroke="#0078d4" stroke-width="2" opacity="0.85"/>
<line x1="331.9" y1="196.0" x2="331.9" y2="224.0" stroke="#0078d4" stroke-width="2" opacity="0.85"/>
<line x1="331.9" y1="196.0" x2="331.9" y2="224.0" stroke="#0078d4" stroke-width="2" opacity="0.85"/>
<line x1="331.9" y1="196.0" x2="331.9" y2="224.0" stroke="#0078d4" stroke-width="2" opacity="0.85"/>
<line x1="331.9" y1="196.0" x2="331.9" y2="224.0" stroke="#0078d4" stroke-width="2" opacity="0.85"/>
<line x1="331.9" y1="196.0" x2="331.9" y2="224.0" stroke="#0078d4" stroke-width="2" opacity="0.85"/>
<line x1="331.9" y1="196.0" x2="331.9" y2="224.0" stroke="#0078d4" stroke-width="2" opacity="0.85"/>
<line x1="331.9" y1="196.0" x2="331.9" y2="224.0" stroke="#0078d4" stroke-width="2" opacity="0.85"/>
<line x1="332.2" y1="196.0" x2="332.2" y2="224.0" stroke="#0078d4" stroke-width="2" opacity="0.85"/>
<line x1="332.2" y1="196.0" x2="332.2" y2="224.0" stroke="#0078d4" stroke-width="2" opacity="0.85"/>
<line x1="332.2" y1="196.0" x2="332.2" y2="224.0" stroke="#0078d4" stroke-width="2" opacity="0.85"/>
<line x1="332.2" y1="196.0" x2="332.2" y2="224.0" stroke="#0078d4" stroke-width="2" opacity="0.85"/>
<line x1="335.5" y1="196.0" x2="335.5" y2="224.0" stroke="#0078d4" stroke-width="2" opacity="0.85"/>
<line x1="335.5" y1="196.0" x2="335.5" y2="224.0" stroke="#0078d4" stroke-width="2" opacity="0.85"/>
<line x1="335.5" y1="196.0" x2="335.5" y2="224.0" stroke="#0078d4" stroke-width="2" opacity="0.85"/>
<line x1="335.5" y1="196.0" x2="335.5" y2="224.0" stroke="#0078d4" stroke-width="2" opacity="0.85"/>
<line x1="335.5" y1="196.0" x2="335.5" y2="224.0" stroke="#0078d4" stroke-width="2" opacity="0.85"/>
<line x1="335.5" y1="196.0" x2="335.5" y2="224.0" stroke="#0078d4" stroke-width="2" opacity="0.85"/>
<line x1="335.5" y1="196.0" x2="335.5" y2="224.0" stroke="#0078d4" stroke-width="2" opacity="0.85"/>
<line x1="335.5" y1="196.0" x2="335.5" y2="224.0" stroke="#0078d4" stroke-width="2" opacity="0.85"/>
<line x1="335.5" y1="196.0" x2="335.5" y2="224.0" stroke="#0078d4" stroke-width="2" opacity="0.85"/>
<line x1="335.5" y1="196.0" x2="335.5" y2="224.0" stroke="#0078d4" stroke-width="2" opacity="0.85"/>
<line x1="335.8" y1="196.0" x2="335.8" y2="224.0" stroke="#0078d4" stroke-width="2" opacity="0.85"/>
<line x1="335.8" y1="196.0" x2="335.8" y2="224.0" stroke="#0078d4" stroke-width="2" opacity="0.85"/>
<line x1="336.1" y1="196.0" x2="336.1" y2="224.0" stroke="#0078d4" stroke-width="2" opacity="0.85"/>
<text x="726" y="192.0" text-anchor="end" font-size="10" fill="#6b7280">69 batches</text>
</g>
<text x="380.0" y="380" text-anchor="middle" font-size="12" fill="#6b7280" font-style="italic">OpenAI: gap then burst (the chunk-0→1 stutter). Azure: dense continuous stream.</text>
</svg>
</p>

The OpenAI track shows the smoking gun: the first batch arrives at ~550ms, then there's a clear gap until the second batch at ~930ms, then sparser tick marks tapering through to the end. The Azure track shows dense, clumped tick marks — bytes arriving almost continuously after first-byte, no quiet windows at all.

Same input text. Same client. Different providers. Completely different streaming behaviors. The two tracks together explain why a fix that worked for Azure-style streams (bumping the snap budget) couldn't ever fully solve the OpenAI case: there's no snap budget large enough to hide a gap whose worst case is open-ended, only one large enough to hide *most* of them. The hard cases were always going to bleed through. The only way to actually close the stutter class was to ensure the bytes are flowing continuously in the first place.

### Listen, again

The timeline shows the gap. The [audio at the top of this post](#hear-it-first) is the same pattern in your ears — the OpenAI track plays "Hello", goes silent for ~half a second, then resumes. The Azure track flows straight through with no gap to insert.

A note on perception worth landing here: the stutter's audibility depends on what the first chunk contains. Our medium scenario starts with "Sure" — a low-amplitude sibilant whose first 146ms registers as essentially silent, so the listener experiences the gap as "audio just started later" rather than as a pause. We use the "Hello" sample because its first batch contains a loud, recognizable syllable that the listener anchors on; *then* the gap is unmistakable. The provider-side timing pattern is the same in both cases — what changes is whether your brain has anchored on audio before the gap hits.

### Surprises worth flagging

Three things from the data that surprised us:

1. **Azure's continuous-stream profile is uniquely good.** Not "best" in the sense of "first by a little." Best in the sense of *qualitatively different* — p95 inter-batch gap of **1 millisecond**, meaning effectively every chunk after the first arrives immediately after the previous one. No other provider behaves this way.
2. **xAI's `optimize_streaming_latency: 1` query parameter actually does what it claims.** TTFB ~400ms is the second-fastest in the field, beating Azure on first-byte. The chunk-0→1 gap is 0. The headline weakness is end-to-end time for long content (~20s for the 150-word scenario) which suggests they stream closer to realtime rate.
3. **Google Cloud TTS warm-call performance is extraordinary** — 210ms TTFB across all scenarios. The cold-start penalty is brutal (3+ seconds for the first call after process start) but with a speculative-connect pattern that hides connection setup behind LLM generation, that penalty effectively disappears.

A fourth surprise was structural rather than numerical: the spread between the seven providers on the chunk-0→1 metric was *much* larger than any vendor benchmark or marketing page would suggest. OpenAI's median gap (343–633ms across scenarios) is more than ten times Azure's (0ms across the board). You don't get that kind of spread from "same problem space, different vendors solving it equally well." You get it from "fundamentally different streaming architectures, only some of which were designed for real-time interaction." Most TTS marketing material talks about voice quality or character pricing — neither of which gives you any signal on the streaming-architecture question.

## 6. What We're Shipping

Replacing OpenAI with Azure. Three reasons:

1. **It actually fixes the bug.** Median chunk-0→1 gap is 0ms across every scenario length we tested. The stutter class disappears.
2. **It doesn't trade off elsewhere.** TTFB is competitive, end-to-end is the fastest, cost is mid-pack, voice catalog is huge. There's no axis where Azure is meaningfully worse than OpenAI.
3. **Polish.** The Speech SDK has native PCM/MP3/Opus/μ-law output formats, well-documented streaming primitives, and built-in latency property reporting we can cross-check our wall-clock measurements against. The whole integration was about 220 lines of TypeScript.

The swap itself is small. Our `llm_tts_stream_http` Cloud Function currently imports `openaiTtsStream` and iterates over it. With the `TtsProvider` interface in place, that becomes:

```ts
// Was:
import { openaiTtsStream } from 'llm-service';

// Becomes:
import { AzureTtsProvider } from 'voicebench';
const provider = new AzureTtsProvider();
const conn = await provider.connect({ voice });
// for await (const pcm of conn.stream({ text, instructions })) { ... }
```

We'll ship it behind a feature flag and A/B against the OpenAI path in our existing /sail experimental harness before flipping defaults globally. The `chunk01-attribution` analyzer that diagnosed the original problem becomes the verification tool: if it shows correlation 0.878 against OpenAI and ~0 against Azure, the change worked.

Two patterns are also worth shipping alongside the provider swap:

**Speculative connect for WebSocket providers.** Our `llm_tts_stream_http` handler currently waits for the LLM to produce 8 words before kicking off the TTS call. With a WS-based provider (Azure, xAI, Gemini Live), we can open the connection at the *top* of the handler — in parallel with auth, billing, and the LLM stream starting. By the time the splitter fires and we need to send text, the WebSocket handshake has long completed. Net cost: zero added latency. Net savings: the 150–300ms WS setup is hidden behind LLM generation that was happening anyway.

**The analyzer stays in place.** The whole point of building `sm audit tts-timing` was to make this class of bug self-diagnosable. The chunk01-attribution test now runs as part of our weekly audit loop, so if any provider regresses or our network path changes character, the next loop run flags it without anyone needing to chase another user-reported stutter.

## 7. Try It Yourself

[voicebench is on GitHub](https://github.com/sheunaluko/voicebench). The whole thing is ~1500 lines of TypeScript across the harness and the seven adapters.

Running the same benchmark we did:

```bash
git clone https://github.com/sheunaluko/voicebench
cd voicebench && npm install

export OPENAI_API_KEY=...
export AZURE_SPEECH_KEY=... AZURE_SPEECH_REGION=eastus
export XAI_API_KEY=...
export GEMINI_API_KEY=...
export GOOGLE_APPLICATION_CREDENTIALS=~/.config/gcloud/application_default_credentials.json

npm run bench -- \
    --providers openai,azure,xai_ws,gcp_streaming,gemini_live \
    --scenarios short,medium,long \
    --trials 5 \
    --out results/run_$(date +%s).json
```

Adding a new provider is ~100–250 lines depending on whether you're wrapping an HTTP endpoint (smaller) or a WebSocket API (bigger). The interface is in `src/providers/_types.ts`; each existing adapter is a complete reference.

If your voice agent uses a streaming TTS provider, you almost certainly should benchmark. Vendor latency claims are aspirational. The bytes-on-the-wire that reach your specific client over your specific network path are the only numbers that matter, and you can measure them in an afternoon.

## 8. What We Skipped (And What's Next)

Three honest caveats before this becomes the canonical "Azure beats everyone" post:

- **Voice quality wasn't measured.** Latency is one axis; "does Ava sound better than Marin for my product's persona" is another. The benchmark says nothing about it. Plan to do a blind A/B listening test before the production flip.
- **One observer, one network path.** Numbers from your Cloud Run instance or your colo will differ. The *ordering* should hold (the chunk-0→1 gap is inherent to each provider's streaming pattern) but absolute TTFB shifts with network.
- **Two providers we didn't test.** Cartesia and ElevenLabs are both well-known for low first-byte. We have API keys for both but didn't include them in this round. The harness supports adding them in roughly a day each; planned for the next post.

A couple of follow-ups also got queued:

- **Per-provider speculative-connect savings**. With the interface designed for it, we want to measure exactly how much the WS handshake costs hide behind LLM generation in real production. Probably worth its own short post.
- **Cost calibration**. Several providers' cost models in voicebench are placeholders — Azure and OpenAI are accurate; xAI and Gemini Live use approximate per-character or per-second constants that will drift from actual billing. Worth a calibration pass before cost becomes a real decision factor.

### Full audio A/B — all four providers

For completeness, here's every provider we captured audio for in this round, in both "clean" (raw bytes concatenated, no playback simulation) and "realistic" (silence inserted wherever the buffer would have starved) form. Same sentence in every track.

<div style="margin: 24px 0">

<div style="margin: 14px 0; padding: 14px 18px; border-radius: 8px; background: var(--blog-card-bad-bg); border: 1px solid var(--blog-card-border); border-left: 4px solid var(--blog-card-label-bad); box-shadow: var(--blog-card-shadow)">
<div style="display: flex; justify-content: space-between; margin-bottom: 10px; align-items: baseline"><strong style="color: var(--blog-card-label-bad)">OpenAI · gpt-4o-mini-tts</strong><span style="font-size: 11px; color: var(--blog-card-meta); font-family: ui-monospace, monospace">TTFB 1561ms · chunk0→1 761ms · 561ms stutter inserted</span></div>
<div style="display: grid; grid-template-columns: 80px 1fr; gap: 10px; align-items: center; margin: 6px 0; padding: 6px 10px; border-radius: 4px; background: var(--blog-card-row-bg)"><span style="font-size: 11px; color: var(--blog-card-meta); font-weight: 600; letter-spacing: 0.04em">CLEAN</span><audio controls preload="metadata" style="width:100%" src="/blog/voice-stutter/openai_short_clean.wav"></audio></div>
<div style="display: grid; grid-template-columns: 80px 1fr; gap: 10px; align-items: center; margin: 6px 0; padding: 6px 10px; border-radius: 4px; background: var(--blog-card-row-bg)"><span style="font-size: 11px; color: var(--blog-card-meta); font-weight: 600; letter-spacing: 0.04em">REALISTIC</span><audio controls preload="metadata" style="width:100%" src="/blog/voice-stutter/openai_short_realistic.wav"></audio></div>
</div>

<div style="margin: 14px 0; padding: 14px 18px; border-radius: 8px; background: var(--blog-card-good-bg); border: 1px solid var(--blog-card-border); border-left: 4px solid var(--blog-card-label-good); box-shadow: var(--blog-card-shadow)">
<div style="display: flex; justify-content: space-between; margin-bottom: 10px; align-items: baseline"><strong style="color: var(--blog-card-label-good)">Azure · en-US-AvaMultilingualNeural</strong><span style="font-size: 11px; color: var(--blog-card-meta); font-family: ui-monospace, monospace">TTFB 1062ms · chunk0→1 0ms · no stutter</span></div>
<div style="display: grid; grid-template-columns: 80px 1fr; gap: 10px; align-items: center; margin: 6px 0; padding: 6px 10px; border-radius: 4px; background: var(--blog-card-row-bg)"><span style="font-size: 11px; color: var(--blog-card-meta); font-weight: 600; letter-spacing: 0.04em">CLEAN</span><audio controls preload="metadata" style="width:100%" src="/blog/voice-stutter/azure_short_clean.wav"></audio></div>
<div style="display: grid; grid-template-columns: 80px 1fr; gap: 10px; align-items: center; margin: 6px 0; padding: 6px 10px; border-radius: 4px; background: var(--blog-card-row-bg)"><span style="font-size: 11px; color: var(--blog-card-meta); font-weight: 600; letter-spacing: 0.04em">REALISTIC</span><audio controls preload="metadata" style="width:100%" src="/blog/voice-stutter/azure_short_realistic.wav"></audio></div>
</div>

<div style="margin: 14px 0; padding: 14px 18px; border-radius: 8px; background: var(--blog-card-neutral-bg); border: 1px solid var(--blog-card-border); border-left: 4px solid var(--blog-card-label-neutral); box-shadow: var(--blog-card-shadow)">
<div style="display: flex; justify-content: space-between; margin-bottom: 10px; align-items: baseline"><strong style="color: var(--blog-card-label-neutral)">Gemini Live · Kore</strong><span style="font-size: 11px; color: var(--blog-card-meta); font-family: ui-monospace, monospace">TTFB 732ms · chunk0→1 58ms · 143ms minor stutter</span></div>
<div style="display: grid; grid-template-columns: 80px 1fr; gap: 10px; align-items: center; margin: 6px 0; padding: 6px 10px; border-radius: 4px; background: var(--blog-card-row-bg)"><span style="font-size: 11px; color: var(--blog-card-meta); font-weight: 600; letter-spacing: 0.04em">CLEAN</span><audio controls preload="metadata" style="width:100%" src="/blog/voice-stutter/gemini_live_short_clean.wav"></audio></div>
<div style="display: grid; grid-template-columns: 80px 1fr; gap: 10px; align-items: center; margin: 6px 0; padding: 6px 10px; border-radius: 4px; background: var(--blog-card-row-bg)"><span style="font-size: 11px; color: var(--blog-card-meta); font-weight: 600; letter-spacing: 0.04em">REALISTIC</span><audio controls preload="metadata" style="width:100%" src="/blog/voice-stutter/gemini_live_short_realistic.wav"></audio></div>
</div>

<div style="margin: 14px 0; padding: 14px 18px; border-radius: 8px; background: var(--blog-card-good-bg); border: 1px solid var(--blog-card-border); border-left: 4px solid var(--blog-card-label-good); box-shadow: var(--blog-card-shadow)">
<div style="display: flex; justify-content: space-between; margin-bottom: 10px; align-items: baseline"><strong style="color: var(--blog-card-label-good)">xAI WebSocket · eve</strong><span style="font-size: 11px; color: var(--blog-card-meta); font-family: ui-monospace, monospace">TTFB 444ms · chunk0→1 0ms · no stutter</span></div>
<div style="display: grid; grid-template-columns: 80px 1fr; gap: 10px; align-items: center; margin: 6px 0; padding: 6px 10px; border-radius: 4px; background: var(--blog-card-row-bg)"><span style="font-size: 11px; color: var(--blog-card-meta); font-weight: 600; letter-spacing: 0.04em">CLEAN</span><audio controls preload="metadata" style="width:100%" src="/blog/voice-stutter/xai_ws_short_clean.wav"></audio></div>
<div style="display: grid; grid-template-columns: 80px 1fr; gap: 10px; align-items: center; margin: 6px 0; padding: 6px 10px; border-radius: 4px; background: var(--blog-card-row-bg)"><span style="font-size: 11px; color: var(--blog-card-meta); font-weight: 600; letter-spacing: 0.04em">REALISTIC</span><audio controls preload="metadata" style="width:100%" src="/blog/voice-stutter/xai_ws_short_realistic.wav"></audio></div>
</div>

</div>

The reconstruction pipeline is two files: `--save-audio <dir>` on the voicebench CLI persists per-batch PCM + timing JSON during the trial, then `scripts/simulate_playback.py` reads the dir and writes the two WAVs per trial. Stdlib only, no audio libraries needed.

---

If you build voice agents, the takeaway from all of this is one sentence. **Make your TTS provider an interface, not an import.** Whatever you're shipping today, there's a non-zero probability that swapping providers — once you can measure it — closes an entire class of bugs at once.

The diagnostic analyzer (`sm audit tts-timing` in [smartchats-sessions](https://github.com/sheunaluko/smartchats)) and the benchmark harness ([voicebench](https://github.com/sheunaluko/voicebench)) are both open source. If you find a bug, want to add a provider, or have a faster TTS recommendation, send a PR.

---

*Built at [SmartChats](https://smartchats.ai). Questions or improvements? `@sheunaluko` on [GitHub](https://github.com/sheunaluko).*
