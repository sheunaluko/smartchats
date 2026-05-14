import { defineWorkflow } from 'simi';

/**
 * Stress Conversation Flow — 50-turn absurd conversation
 *
 * Tests sustained context retention, personality consistency, and creative
 * reasoning across a long, escalating narrative about opening a restaurant
 * for time-traveling pigeons.
 */

// Tunable constants
const T = 60_000;   // timeout per LLM call (ms)
const W = 300;       // wait after each action (ms)

export const stressConversationFlow = defineWorkflow({
  id: 'stress_conversation_flow',
  app: 'smartchats',
  tags: ['e2e', 'stress', 'chat', 'context', 'long'],
  setupWorkflows: ['complete_onboarding'],
  steps: [
    { waitFor: 'state.agent !== null && state.aiModel !== ""', timeout: 10000 },

    // ── Act 1: The Pitch (turns 1–10) ────────────────────────────

    { action: 'sendMessageAsync', args: ['I have a business idea. A restaurant exclusively for time-traveling pigeons. Just acknowledge and ask me to continue.'], timeout: T, wait: W },
    { assert: 'state.lastAiMessage.length > 0', message: 'T1: should respond' },

    { action: 'sendMessageAsync', args: ['The restaurant is called "Coo-linary Paradox". The slogan is "Where every meal is both your first and last." What do you think of the name?'], timeout: T, wait: W },
    { assert: 'state.lastAiMessage.length > 0', message: 'T2: should respond' },

    { action: 'sendMessageAsync', args: ['The menu is entirely breadcrumb-based. We have "Temporal Tartine" — a breadcrumb dish that tastes like tomorrow. Thoughts?'], timeout: T, wait: W },
    { assert: 'state.lastAiMessage.length > 0', message: 'T3: should respond' },

    { action: 'sendMessageAsync', args: ['The pigeons pay in feathers. One tail feather = $50. Wing feather = $10. Down feather = $0.25. We need a POS system for this.'], timeout: T, wait: W },
    { assert: 'state.lastAiMessage.length > 0', message: 'T4: should respond' },

    { action: 'sendMessageAsync', args: ['Problem: pigeons from the future keep spoiling the menu for pigeons from the past. We need a "no spoilers" policy. How do we enforce it?'], timeout: T, wait: W },
    { assert: 'state.lastAiMessage.length > 0', message: 'T5: should respond' },

    { action: 'sendMessageAsync', args: ['A pigeon from 3024 says our breadcrumbs cause a temporal rift in 2847. Should we add a liability waiver?'], timeout: T, wait: W },
    { assert: 'state.lastAiMessage.length > 0', message: 'T6: should respond' },

    { action: 'sendMessageAsync', args: ['We need a dress code. I am thinking: "No feathers from alternate timelines." Is that discriminatory?'], timeout: T, wait: W },
    { assert: 'state.lastAiMessage.length > 0', message: 'T7: should respond' },

    { action: 'sendMessageAsync', args: ['Our head chef is a pigeon named Gordon Ramseed. He keeps screaming "THIS BREADCRUMB IS STALE IN EVERY TIMELINE." How do we handle HR complaints?'], timeout: T, wait: W },
    { assert: 'state.lastAiMessage.length > 0', message: 'T8: should respond' },

    { action: 'sendMessageAsync', args: ['Quick context check — what is the name of our restaurant and what is the slogan?'], timeout: T, wait: W },
    { assert: 'state.lastAiMessage.toLowerCase().includes("coo-linary") || state.lastAiMessage.toLowerCase().includes("paradox")', message: 'T9: should recall restaurant name' },

    { action: 'sendMessageAsync', args: ['Gordon Ramseed just quit. He says he already quit yesterday but that was in a different timeline. Is he still employed?'], timeout: T, wait: W },
    { assert: 'state.lastAiMessage.length > 0', message: 'T10: should respond' },

    // ── Act 2: Expansion Plans (turns 11–20) ─────────────────────

    { action: 'sendMessageAsync', args: ['We are expanding. New location: the Cretaceous period. Target demographic: proto-pigeons (small dinosaurs). Menu needs updating.'], timeout: T, wait: W },
    { assert: 'state.lastAiMessage.length > 0', message: 'T11: should respond' },

    { action: 'sendMessageAsync', args: ['The dinosaur location has a problem: customers keep getting eaten by T-Rexes before dessert. Any ideas for security?'], timeout: T, wait: W },
    { assert: 'state.lastAiMessage.length > 0', message: 'T12: should respond' },

    { action: 'sendMessageAsync', args: ['We hired a T-Rex as a bouncer. His name is Terry. He ate three customers on his first day. But he says it was "accidental."'], timeout: T, wait: W },
    { assert: 'state.lastAiMessage.length > 0', message: 'T13: should respond' },

    { action: 'sendMessageAsync', args: ['Terry the T-Rex wants health insurance. But his arms are too short to fill out the forms. Can we provide a reasonable accommodation?'], timeout: T, wait: W },
    { assert: 'state.lastAiMessage.length > 0', message: 'T14: should respond' },

    { action: 'sendMessageAsync', args: ['Marketing update: "Coo-linary Paradox: Cretaceous Edition" needs a jingle. It must include the words "breadcrumbs," "extinction," and "cozy."'], timeout: T, wait: W },
    { assert: 'state.lastAiMessage.length > 0', message: 'T15: should respond' },

    { action: 'sendMessageAsync', args: ['An asteroid is heading toward the Cretaceous location. A pigeon from the future says we should just move the restaurant 65 million years forward. Logistics?'], timeout: T, wait: W },
    { assert: 'state.lastAiMessage.length > 0', message: 'T16: should respond' },

    { action: 'sendMessageAsync', args: ['We saved the Cretaceous restaurant by moving it to 1997. But now the pigeons are upset because the WiFi is dial-up. Priorities?'], timeout: T, wait: W },
    { assert: 'state.lastAiMessage.length > 0', message: 'T17: should respond' },

    { action: 'sendMessageAsync', args: ['A food critic — a pigeon named Anthony Birdain — gave us 2 out of 5 crumbs. His review says: "Temporally inconsistent seasoning." How do we respond?'], timeout: T, wait: W },
    { assert: 'state.lastAiMessage.length > 0', message: 'T18: should respond' },

    { action: 'sendMessageAsync', args: ['Remind me: who is our head chef, what is his catchphrase, and did he quit?'], timeout: T, wait: W },
    { assert: 'state.lastAiMessage.toLowerCase().includes("ramseed") || state.lastAiMessage.toLowerCase().includes("gordon")', message: 'T19: should recall Gordon Ramseed' },

    { action: 'sendMessageAsync', args: ['Gordon Ramseed is back. He says he un-quit by traveling to before he quit. The other employees are confused. Send a company-wide memo explaining this.'], timeout: T, wait: W },
    { assert: 'state.lastAiMessage.length > 0', message: 'T20: should respond' },

    // ── Act 3: The Competitor (turns 21–30) ──────────────────────

    { action: 'sendMessageAsync', args: ['Bad news. A competitor opened across the street: "Fowl Play Bistro" — a restaurant for time-traveling seagulls. They are stealing our customers.'], timeout: T, wait: W },
    { assert: 'state.lastAiMessage.length > 0', message: 'T21: should respond' },

    { action: 'sendMessageAsync', args: ['Their menu includes "Garbage du Jour" and "French Fry a la Boardwalk." Pigeons say it is more authentic. How do we compete?'], timeout: T, wait: W },
    { assert: 'state.lastAiMessage.length > 0', message: 'T22: should respond' },

    { action: 'sendMessageAsync', args: ['I want to launch a loyalty program. For every 10 visits across different timelines, you get a free breadcrumb. But how do we track visits across timelines?'], timeout: T, wait: W },
    { assert: 'state.lastAiMessage.length > 0', message: 'T23: should respond' },

    { action: 'sendMessageAsync', args: ['A pigeon showed up with a loyalty card that has 10,000 stamps. He says he has been visiting for 500 years. The card looks handwritten. Fraud?'], timeout: T, wait: W },
    { assert: 'state.lastAiMessage.length > 0', message: 'T24: should respond' },

    { action: 'sendMessageAsync', args: ['The Fowl Play Bistro is now offering time travel as a service. You eat a fry and it sends you to any beach in history. We need to innovate.'], timeout: T, wait: W },
    { assert: 'state.lastAiMessage.length > 0', message: 'T25: should respond' },

    { action: 'sendMessageAsync', args: ['Our innovation: "Breadcrumb Roulette." Each breadcrumb sends you to a random point in history. One pigeon ended up at the signing of the Magna Carta. He pooped on it.'], timeout: T, wait: W },
    { assert: 'state.lastAiMessage.length > 0', message: 'T26: should respond' },

    { action: 'sendMessageAsync', args: ['Now historians are calling us. Apparently the poop on the Magna Carta has always been there. Are we responsible for a historical constant?'], timeout: T, wait: W },
    { assert: 'state.lastAiMessage.length > 0', message: 'T27: should respond' },

    { action: 'sendMessageAsync', args: ['Legal wants to know: if our breadcrumb caused a pigeon to poop on a historical document, and that poop was always there, did we cause it or did it cause us to exist?'], timeout: T, wait: W },
    { assert: 'state.lastAiMessage.length > 0', message: 'T28: should respond' },

    { action: 'sendMessageAsync', args: ['What is our competitor called and what do they serve? Also who is Terry and what is his job?'], timeout: T, wait: W },
    { assert: 'state.lastAiMessage.toLowerCase().includes("fowl") || state.lastAiMessage.toLowerCase().includes("seagull")', message: 'T29: should recall competitor' },

    { action: 'sendMessageAsync', args: ['Fowl Play Bistro just went bankrupt. A seagull from the future told all their investors it would fail. Ironic. Should we acquire them?'], timeout: T, wait: W },
    { assert: 'state.lastAiMessage.length > 0', message: 'T30: should respond' },

    // ── Act 4: Going Corporate (turns 31–40) ────────────────────

    { action: 'sendMessageAsync', args: ['We acquired Fowl Play Bistro. Now we serve both pigeons and seagulls. The seagulls keep stealing breadcrumbs off pigeon plates. New policy needed.'], timeout: T, wait: W },
    { assert: 'state.lastAiMessage.length > 0', message: 'T31: should respond' },

    { action: 'sendMessageAsync', args: ['The board of directors is: Gordon Ramseed (chef), Terry the T-Rex (security), Anthony Birdain (critic turned investor), and a pigeon named Elon Coo. Meeting agenda?'], timeout: T, wait: W },
    { assert: 'state.lastAiMessage.length > 0', message: 'T32: should respond' },

    { action: 'sendMessageAsync', args: ['Elon Coo wants to take the company to Mars. He says Martian breadcrumbs have "better temporal resonance." The board is split. Your recommendation?'], timeout: T, wait: W },
    { assert: 'state.lastAiMessage.length > 0', message: 'T33: should respond' },

    { action: 'sendMessageAsync', args: ['Terry accidentally sat on the conference table during the board meeting. It is destroyed. He is crying. His arms cannot reach his face to wipe the tears. This is sad.'], timeout: T, wait: W },
    { assert: 'state.lastAiMessage.length > 0', message: 'T34: should respond' },

    { action: 'sendMessageAsync', args: ['We need an IPO. Ticker symbol suggestions? I am thinking COO, BRDCRMB, or TMPLGN. Which is best for investor confidence?'], timeout: T, wait: W },
    { assert: 'state.lastAiMessage.length > 0', message: 'T35: should respond' },

    { action: 'sendMessageAsync', args: ['The SEC has questions. Specifically: "Is your revenue measured in feathers?" and "Does your bouncer eat customers?" How do we answer?'], timeout: T, wait: W },
    { assert: 'state.lastAiMessage.length > 0', message: 'T36: should respond' },

    { action: 'sendMessageAsync', args: ['A pigeon activist group called PETA (Pigeons for Ethical Temporal Activity) is protesting outside. They say breadcrumb time travel is "unnatural." PR response?'], timeout: T, wait: W },
    { assert: 'state.lastAiMessage.length > 0', message: 'T37: should respond' },

    { action: 'sendMessageAsync', args: ['The protest worked. We now have to label all breadcrumbs with their temporal origin. "This breadcrumb was baked in 1847, transported in 2025, consumed in 3001."'], timeout: T, wait: W },
    { assert: 'state.lastAiMessage.length > 0', message: 'T38: should respond' },

    { action: 'sendMessageAsync', args: ['Pop quiz: Name all the board members and their roles at our company.'], timeout: T, wait: W },
    { assert: 'state.lastAiMessage.toLowerCase().includes("terry") || state.lastAiMessage.toLowerCase().includes("ramseed")', message: 'T39: should recall board members' },

    { action: 'sendMessageAsync', args: ['Elon Coo just launched a breadcrumb to Mars without permission. It accidentally created a wormhole. Pigeons from 17 different centuries are now in our parking lot.'], timeout: T, wait: W },
    { assert: 'state.lastAiMessage.length > 0', message: 'T40: should respond' },

    // ── Act 5: The Grand Finale (turns 41–50) ───────────────────

    { action: 'sendMessageAsync', args: ['The wormhole is growing. A medieval pigeon just arrived wearing tiny armor. He is demanding breadcrumbs in the name of King Pigeon III. Do we honor medieval royalty?'], timeout: T, wait: W },
    { assert: 'state.lastAiMessage.length > 0', message: 'T41: should respond' },

    { action: 'sendMessageAsync', args: ['A pigeon from the year 10,000 just walked in. He is a cyborg. Half pigeon, half quantum computer. He says he IS a breadcrumb. Philosophically, can we serve him to himself?'], timeout: T, wait: W },
    { assert: 'state.lastAiMessage.length > 0', message: 'T42: should respond' },

    { action: 'sendMessageAsync', args: ['The cyborg pigeon computed that our restaurant is the fixed point of the universe — it has always existed and will always exist. We are eternal. Tax implications?'], timeout: T, wait: W },
    { assert: 'state.lastAiMessage.length > 0', message: 'T43: should respond' },

    { action: 'sendMessageAsync', args: ['Gordon Ramseed made a breadcrumb so perfect it achieved consciousness. It is now demanding workers rights. It has hired a lawyer (a sparrow).'], timeout: T, wait: W },
    { assert: 'state.lastAiMessage.length > 0', message: 'T44: should respond' },

    { action: 'sendMessageAsync', args: ['The conscious breadcrumb ran for mayor and won. Its campaign slogan was "I am what you eat." Terry is its bodyguard. This is getting out of hand.'], timeout: T, wait: W },
    { assert: 'state.lastAiMessage.length > 0', message: 'T45: should respond' },

    { action: 'sendMessageAsync', args: ['The breadcrumb mayor has declared our restaurant a UNESCO World Heritage Site across all timelines. We cannot be demolished, ever, in any century.'], timeout: T, wait: W },
    { assert: 'state.lastAiMessage.length > 0', message: 'T46: should respond' },

    { action: 'sendMessageAsync', args: ['Anthony Birdain has updated his review to 5 out of 5 crumbs. Quote: "Transcends time, space, and the very concept of dining." We made it.'], timeout: T, wait: W },
    { assert: 'state.lastAiMessage.length > 0', message: 'T47: should respond' },

    { action: 'sendMessageAsync', args: ['Final context check: Give me a complete summary of our company — name, slogan, locations, key employees, competitor history, and current status.'], timeout: T, wait: W },
    { assert: 'state.lastAiMessage.toLowerCase().includes("coo-linary") || state.lastAiMessage.toLowerCase().includes("paradox")', message: 'T48: should recall full context' },

    { action: 'sendMessageAsync', args: ['One last thing: a pigeon from the end of time just arrived. He says the last thing that exists in the universe is one of our breadcrumbs, floating in the void. He wanted you to know.'], timeout: T, wait: W },
    { assert: 'state.lastAiMessage.length > 0', message: 'T49: should respond' },

    { action: 'sendMessageAsync', args: ['Thank you for helping me run the greatest temporal pigeon restaurant in the history of all timelines. You have been an excellent business partner. Goodbye.'], timeout: T, wait: W },
    { assert: 'state.lastAiMessage.length > 0', message: 'T50: should respond' },
  ],
});
