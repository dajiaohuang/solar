import { useState } from 'react'
import { useI18n } from '../../i18n/context'
import type { StoryCheckpoint as StoryCheckpointData } from '../../content/stories/types'

export function StoryCheckpoint({ checkpoint, compact = false }: { checkpoint: StoryCheckpointData; compact?: boolean }) {
  const { language, t } = useI18n()
  const [answer, setAnswer] = useState<number | null>(null)
  const correct = answer !== null && checkpoint.choices[answer]?.correct

  return <section className={`story-checkpoint ${compact ? 'compact' : ''}`}>
    <span className="section-kicker">{t('storyCheckpoint')}</span>
    <p>{checkpoint.question[language]}</p>
    <div role="group" aria-label={checkpoint.question[language]}>
      {checkpoint.choices.map((choice, index) => <button
        className={answer === index ? (choice.correct ? 'correct' : 'incorrect') : ''}
        key={choice.text.en}
        onClick={() => setAnswer(index)}
      >{choice.text[language]}</button>)}
    </div>
    {answer !== null && <p className="checkpoint-feedback" role="status"><strong>{correct ? t('storyCorrect') : t('storyTryAgain')}</strong> {checkpoint.explanation[language]}</p>}
  </section>
}
