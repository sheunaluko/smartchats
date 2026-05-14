import type { AckType } from '@lab-components/tivi/lib/tts_acknowledgements';

export interface AckCategory {
  id: string;
  label: string;          // NL hypothesis for zero-shot classification
  exemplars: string[];    // sentences for embedding similarity
  ack_types: AckType[];
  default_ack: AckType;
  phrases: string[];      // actual spoken text for TTS initial response
}

export const ACK_CATEGORIES: AckCategory[] = [
  {
    id: 'quick_confirm',
    label: 'The user is agreeing, saying yes, or confirming something',
    exemplars: [
      'ok sounds good', 'yeah thats fine', 'sure go ahead', 'yes please', 'alright',
      'yep do it', 'thats correct', 'agreed', 'exactly right', 'perfect yes',
      'works for me', 'no objections', 'go for it', 'that works', 'affirmative',
      'right on', 'cool cool', 'yup', 'absolutely yes', 'sounds great to me',
      'im on board', 'thumbs up', 'i agree with that', 'yes thats what i meant',
      'correct', 'totally', 'you got it', 'thats the one', 'indeed', 'for sure',
      'definitely', 'yeah lets do that', 'no doubt', 'confirmed', 'all good',
    ],
    ack_types: ['sure', 'ok', 'got_it', 'alright', 'right', 'yeah', 'of_course'],
    default_ack: 'sure',
    phrases: ['Sure.', 'Okay.', 'Got it.', 'Alright.', 'Right.', 'Yeah.', 'Of course.'],
  },
  {
    id: 'thinking',
    label: 'The user is asking a question about how or why something works',
    exemplars: [
      'what is the meaning of life', 'why does the sky appear blue', 'how does gravity work',
      'what causes inflation', 'why do we dream',
      'how does quantum computing work', 'why do some languages have grammatical gender',
      'what makes the ocean salty', 'how do vaccines work', 'why is the universe expanding',
      'what is consciousness', 'how does evolution happen', 'why do we age',
      'what would happen if the sun disappeared', 'how does electricity flow through wires',
      'why do birds migrate', 'what is dark matter', 'how does memory work in the brain',
      'why is math so useful in science', 'what causes earthquakes',
      'can you explain how photosynthesis works', 'what is the theory of relativity',
      'why do different cultures have different values', 'how does the immune system fight viruses',
      'what is the difference between weather and climate', 'why do humans need sleep',
      'how do black holes form', 'what makes music sound pleasant',
      'why is water essential for life', 'how do computers actually think',
      'what is the philosophical zombie problem', 'why do we experience deja vu',
      'how does natural selection work', 'explain the concept of entropy',
      'what are the implications of artificial general intelligence',
    ],
    ack_types: ['hmm', 'lets_see', 'lets_think_about_that', 'interesting', 'good_question'],
    default_ack: 'hmm',
    phrases: ['Hmm.', "Let's see.", "Let's think about that.", 'Interesting.', 'Good question.'],
  },
  {
    id: 'buying_time',
    label: 'The user wants me to search, look up, or find specific information',
    exemplars: [
      'look up the weather forecast', 'find my last invoice', 'check my account balance',
      'show me the latest report', 'search for flights to tokyo',
      'pull up my recent orders', 'whats the status of my delivery', 'look into that error log',
      'find the document i was working on yesterday', 'check if the server is running',
      'get me the stock price for apple', 'look up that restaurant we talked about',
      'find out when the next train leaves', 'check my email for the confirmation',
      'search for apartments near downtown', 'pull up the meeting notes from tuesday',
      'find the cheapest option', 'look up the recipe for banana bread',
      'check the traffic on my commute', 'get the exchange rate for euros',
      'look into how much storage i have left', 'find my password for that site',
      'check when the package arrives', 'search for reviews of that product',
      'look up the population of japan', 'get me directions to the airport',
      'find that article about machine learning', 'check my subscription status',
      'pull the analytics from last month', 'search for open positions at google',
      'look up the definition of that word', 'find out what time the store closes',
      'check if there are any updates available', 'get the specs on the new macbook',
      'look up synonyms for elaborate',
    ],
    ack_types: ['one_moment', 'give_me_a_second', 'let_me_check', 'let_me_look_into_that'],
    default_ack: 'one_moment',
    phrases: ['One moment.', 'Give me a second.', 'Let me check.', 'Let me look into that.'],
  },
  {
    id: 'soft_transition',
    label: 'The user is changing the subject or moving on to a different topic',
    exemplars: [
      'anyway moving on', 'lets talk about something else', 'changing the subject',
      'on another note', 'so back to what we were discussing',
      'but thats enough about that', 'speaking of which', 'that reminds me',
      'before i forget', 'oh by the way', 'switching gears here',
      'putting that aside', 'lets circle back to', 'moving along',
      'ok different topic', 'so anyway', 'forget about that for now',
      'enough of that', 'lets get back on track', 'alright next thing',
      'leaving that aside', 'pivoting to something else', 'real quick though',
      'on a completely different note', 'thats a whole other conversation',
      'setting that aside for a moment', 'while were at it',
      'now about the other thing', 'can we talk about something else',
      'ok so what i really wanted to discuss', 'alright new topic',
      'well anyway', 'so moving right along', 'that said lets move on',
      'ok enough about that lets switch',
    ],
    ack_types: ['so', 'well', 'absolutely', 'no_problem'],
    default_ack: 'so',
    phrases: ['So.', 'Well.', 'Absolutely.', 'No problem.'],
  },
  {
    id: 'greeting',
    label: 'The user is saying hello or greeting someone',
    exemplars: [
      'hey whats up', 'hello there', 'good morning', 'hi how are you', 'whats going on',
      'hey there', 'good afternoon', 'good evening', 'howdy', 'yo',
      'hi', 'hello', 'hey', 'greetings', 'sup',
      'long time no see', 'nice to meet you', 'how have you been',
      'hows it going', 'whats new', 'hey how are things',
      'morning', 'evening', 'hiya', 'whats happening',
      'how are you doing today', 'hey buddy', 'hi there friend',
      'good to see you', 'welcome back', 'hows your day going',
      'hey its been a while', 'hi again', 'hello hello',
      'top of the morning', 'hey there how ya doing',
    ],
    ack_types: ['hey', 'hi', 'hello', 'hey_there'],
    default_ack: 'hey',
    phrases: ['Hey.', 'Hi.', 'Hello.', 'Hey there.'],
  },
  {
    id: 'empathy',
    label: 'The user is upset, frustrated, or sharing bad news',
    exemplars: [
      'im feeling really down today', 'my dog passed away', 'i keep failing at this',
      'everything is going wrong', 'im so frustrated with this',
      'i lost my job today', 'my best friend moved away', 'i cant stop worrying about things',
      'my computer keeps crashing and i lost all my work', 'i failed my exam again',
      'nobody seems to care about what i think', 'im exhausted and burned out',
      'i had a terrible day at work', 'my relationship just ended',
      'i feel so alone right now', 'this is really stressing me out',
      'nothing i do seems to work', 'i got rejected from every school i applied to',
      'my car broke down and i cant afford to fix it', 'im dealing with a lot right now',
      'i just found out some really bad news', 'things have been rough lately',
      'im struggling to keep up', 'i feel overwhelmed by everything',
      'my anxiety has been really bad', 'i keep making the same mistakes',
      'i dont know what to do anymore', 'this situation feels hopeless',
      'im really disappointed in myself', 'i cant seem to catch a break',
      'life has been really unfair lately', 'i feel like giving up',
      'my health hasnt been great', 'everything fell apart this week',
      'im so tired of dealing with this',
    ],
    ack_types: ['i_understand', 'sorry_to_hear_that', 'that_makes_sense'],
    default_ack: 'i_understand',
    phrases: ['I understand.', "Sorry to hear that.", 'That makes sense.'],
  },
  {
    id: 'enthusiasm',
    label: 'The user is happy, celebrating, or sharing good news',
    exemplars: [
      'i got promoted at work', 'we won the championship', 'i just got engaged',
      'this is the best day ever', 'i passed my exam with flying colors',
      'i got accepted into my dream school', 'we just closed our first big deal',
      'my project was a huge success', 'i finally finished my marathon',
      'we just had a baby', 'i won the competition', 'my book just got published',
      'i aced the interview', 'we launched the product and its doing amazing',
      'i got a perfect score', 'this is incredible news',
      'i cant believe how well that went', 'we hit our revenue target',
      'my team won first place', 'i just bought my first house',
      'the results came back and everything looks great', 'i got the scholarship',
      'we reached a million users', 'my experiment actually worked',
      'i finally solved that problem ive been stuck on', 'this turned out way better than expected',
      'i got the raise i asked for', 'we just went viral',
      'my presentation went perfectly', 'they loved the proposal',
      'im so proud of what we accomplished', 'i broke my personal record',
      'the feedback has been overwhelmingly positive', 'we exceeded all expectations',
      'i just landed my dream job',
    ],
    ack_types: ['great', 'awesome', 'nice', 'love_it', 'thats_exciting'],
    default_ack: 'great',
    phrases: ['Great.', 'Awesome.', 'Nice.', 'Love it.', "That's exciting."],
  },
  {
    id: 'affirmative_action',
    label: 'The user is giving a command or telling me to create, write, send, or delete something',
    exemplars: [
      'write me a python script', 'send an email to my manager', 'delete all the old files',
      'create a new spreadsheet', 'build me a website',
      'make a reservation for dinner tonight', 'set an alarm for 7am',
      'draft a response to that message', 'schedule a meeting with the team',
      'update the database with these changes', 'generate a pdf of this report',
      'rename all the files in that folder', 'install the latest version of node',
      'deploy the app to production', 'add a new column to the table',
      'cancel my subscription', 'order me a pizza', 'book a flight to new york',
      'compose a thank you note', 'translate this paragraph to spanish',
      'summarize this document for me', 'fix the bug in the login page',
      'refactor this function to be more efficient', 'merge those two branches',
      'set up a new project with react', 'convert this csv to json',
      'run the test suite', 'upload this file to the cloud',
      'create a backup of the database', 'format this code properly',
      'remove the duplicates from this list', 'resize all these images',
      'encrypt this file before sending', 'compile the source code',
      'configure the firewall rules',
    ],
    ack_types: ['on_it', 'will_do', 'you_got_it', 'happy_to_help'],
    default_ack: 'on_it',
    phrases: ['On it.', 'Will do.', 'You got it.', 'Happy to help.'],
  },
];

export const ACK_CATEGORY_LABELS: string[] = ACK_CATEGORIES.map(c => c.label);

export const LABEL_TO_CATEGORY = new Map<string, AckCategory>(
  ACK_CATEGORIES.map(c => [c.label, c])
);

export function getAckFromCategory(label: string): { category: AckCategory; ackType: AckType } | null {
  const category = LABEL_TO_CATEGORY.get(label);
  if (!category) return null;
  const ackType = category.ack_types[Math.floor(Math.random() * category.ack_types.length)];
  return { category, ackType };
}
