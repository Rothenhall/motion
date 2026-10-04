/** Starter hook library. [Bracketed] parts are placeholders to swap for your own topic. */
export const HOOK_SEEDS: { text: string; category: string; platform?: string }[] = [
  // Curiosity
  { text: 'Nobody talks about this part of [topic].', category: 'CURIOSITY' },
  { text: 'I wish someone had told me this before I started [activity].', category: 'CURIOSITY' },
  { text: 'This one change made [result] almost overnight.', category: 'CURIOSITY' },
  { text: 'Here is what [number] years of [activity] taught me in one minute.', category: 'CURIOSITY', platform: 'instagram' },
  { text: 'The reason your [thing] is not working has nothing to do with [obvious cause].', category: 'CURIOSITY' },
  // Contrarian
  { text: 'Unpopular opinion: [common advice] is holding you back.', category: 'CONTRARIAN' },
  { text: 'Stop [common habit]. Do this instead.', category: 'CONTRARIAN' },
  { text: '[Popular tactic] is overrated. Here is what actually works.', category: 'CONTRARIAN' },
  { text: 'Everyone says [belief]. The data says otherwise.', category: 'CONTRARIAN', platform: 'threads' },
  { text: 'You do not need [expensive thing] to [result].', category: 'CONTRARIAN' },
  // Story
  { text: '[Time] ago I [low point]. Today I [high point]. Here is what changed.', category: 'STORY' },
  { text: 'A customer sent me this message last week and I have not stopped thinking about it.', category: 'STORY' },
  { text: 'The day I almost quit [thing].', category: 'STORY' },
  { text: 'I tried [challenge] for [time]. Here is what happened.', category: 'STORY', platform: 'instagram' },
  // Listicle
  { text: '[Number] [topic] mistakes I see every single week.', category: 'LISTICLE' },
  { text: '[Number] tools I use every day to [result].', category: 'LISTICLE' },
  { text: 'Save this: [number] ways to [result] without [pain].', category: 'LISTICLE', platform: 'instagram' },
  { text: 'The only [number] [things] you need to [result].', category: 'LISTICLE' },
  // Question
  { text: 'Be honest: are you still [outdated habit]?', category: 'QUESTION', platform: 'threads' },
  { text: 'What would you do with [resource] if [constraint]?', category: 'QUESTION' },
  { text: 'Why does nobody [obvious solution]?', category: 'QUESTION' },
  { text: 'Which one are you: [type A] or [type B]?', category: 'QUESTION', platform: 'facebook' },
  // Proof
  { text: 'How we went from [before] to [after] in [time].', category: 'PROOF' },
  { text: 'This [post / product / offer] made [result]. Here is the breakdown.', category: 'PROOF' },
  { text: 'Real numbers from [project]: what worked and what flopped.', category: 'PROOF' },
  // Pain
  { text: 'If you are tired of [frustration], watch this.', category: 'PAIN', platform: 'instagram' },
  { text: 'Struggling with [problem]? It is probably this.', category: 'PAIN' },
  { text: 'The [problem] nobody warns you about when you start [activity].', category: 'PAIN' },
  // How to
  { text: 'How to [result] in [short time], step by step.', category: 'HOW_TO' },
  { text: 'The simplest way to [result], even if you are a beginner.', category: 'HOW_TO' },
  { text: 'Steal my exact [process / template] for [result].', category: 'HOW_TO' },
  { text: 'Do this before you [action], not after.', category: 'HOW_TO' },
];
