// The prompt page: the brief that started the project, verbatim, and a button that copies it as
// it was typed (paragraphs separated by a blank line, line breaks kept).

import './prompt.css'

import { startAnalytics } from './analytics'

startAnalytics()

const prompt = document.querySelector<HTMLElement>('[data-prompt]')!
const button = document.querySelector<HTMLButtonElement>('[data-copy]')!
const label = button.querySelector<HTMLElement>('[data-label]')!
const mac = /Mac|iPhone|iPad/.test(navigator.userAgent)

const text = () =>
  [...prompt.querySelectorAll('p')].map((p) => p.innerText.trim()).join('\n\n')

let reset = 0
const show = (state: 'idle' | 'copied' | 'select') => {
  button.dataset.state = state
  label.textContent =
    state === 'copied'
      ? 'Copied'
      : state === 'select'
        ? `Press ${mac ? '⌘C' : 'Ctrl+C'}`
        : 'Copy prompt'
  clearTimeout(reset)
  if (state !== 'idle') reset = window.setTimeout(() => show('idle'), 2500)
}

button.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(text())
    show('copied')
  } catch {
    // no clipboard access here: select the prompt so a keyboard copy takes it
    const range = document.createRange()
    range.selectNodeContents(prompt)
    getSelection()?.removeAllRanges()
    getSelection()?.addRange(range)
    show('select')
  }
})
